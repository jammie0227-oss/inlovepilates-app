import { genId } from './id';
// ==========================================
// bookingRules.ts — 共用預約規則 (Single Source of Truth)
// 對應 REFACTOR_SPEC.md 第二、三節
// ==========================================
import type {
  AuditLogItem,
  ReviewItem,
  BookingItem,
  BusinessHoursConfig,
  PriorityGrid,
  StudentItem,
  TeacherProfile,
} from '../types';
import { checkGlobalConflict, isCancelledSlot, isHoldingPendingKind } from './conflict';

type RoomType = 'large' | 'small';
type LessonType = '1v1' | '1v2';
type UserRole = 'admin' | 'teacher';
export type { PriorityGrid };

/** 分鐘選項（每 10 分鐘一格） */
export const BUSINESS_MINUTES: string[] = ['00', '10', '20', '30', '40', '50'];

/** 單堂預設時長（分鐘） */
export const DEFAULT_DURATION_MINS = 50;

/** 預設營業時間：平日 09-22、週六 11-18、週日公休（可由管理員開啟） */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  weekday: { enabled: true, startHour: 9, endHour: 22 },
  saturday: { enabled: true, startHour: 11, endHour: 18 },
  sunday: { enabled: false, startHour: 9, endHour: 18 },
};

/** 動態時間軸：預設 8–21，並依營業時間往前/往後延伸 */
export const getDisplayHours = (bh: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS): number[] => {
  const start = Math.min(8, bh.weekday.startHour, bh.saturday.startHour, bh.sunday.startHour);
  const end = Math.max(21, bh.weekday.endHour - 1, bh.saturday.endHour - 1, bh.sunday.endHour - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

/**
 * 日曆時間軸：只依「有營業的日子」計算範圍（不強制從 8 點），
 * 並擴充涵蓋既有預約（例如非營業時間核准的課堂），避免課被藏起來。
 */
export const getCalendarHours = (
  bh: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
  bookings: { startHour: number }[] = [],
): number[] => {
  const days = [bh.weekday, bh.saturday, bh.sunday].filter(d => d.enabled);
  let start = days.length ? Math.min(...days.map(d => d.startHour)) : 8;
  let end = days.length ? Math.max(...days.map(d => d.endHour - 1)) : 21;
  for (const b of bookings) {
    start = Math.min(start, b.startHour);
    end = Math.max(end, b.startHour);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  !(aEnd <= bStart || aStart >= bEnd);

// ------------------------------------------
// 預設值 / 狀態判斷
// ------------------------------------------

/**
 * 新增預約的預設課程類別與教室。
 * 1v1 → small；1v2 → large；管理員一律優先 large。
 */
export const getStudentBookingPreset = (
  student?: (Partial<Pick<StudentItem, 'defaultLessonType' | 'lessonType'>> & { rules?: any[] }) | null,
  userRole: UserRole = 'teacher',
): { lessonType: LessonType; roomType: RoomType } => {
  // 規則含 1v2 優先 1v2
  const has1v2Rule = !!student?.rules?.some((r: any) => r.lessonType === '1v2');
  const lessonType: LessonType =
    has1v2Rule || student?.defaultLessonType === '1v2' || student?.lessonType === '1v2' ? '1v2' : '1v1';
  const roomType: RoomType =
    userRole === 'admin' ? 'large' : lessonType === '1v2' ? 'large' : 'small';
  return { lessonType, roomType };
};

/** 預約日期是否早於系統基準日（逾期 / 過去）。嚴格小於：基準日當天不算逾期。 */
export const isBookingOverdue = (bookingDate: string, systemBaseDate: string): boolean =>
  bookingDate < systemBaseDate;

/** 統一「現在」：系統基準日 + 真實時分。所有時間差計算皆應使用此基準。 */
export const getNow = (systemBaseDate: string, realNow: Date = new Date()): Date => {
  const base = parseDate(systemBaseDate);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), realNow.getHours(), realNow.getMinutes());
};

/** 距離開課的小時數（可為負數：已開課）。 */
export const hoursUntilLesson = (
  dateStr: string,
  startHour: number,
  startMin: number,
  systemBaseDate: string,
): number => {
  const d = parseDate(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour, startMin);
  return (start.getTime() - getNow(systemBaseDate).getTime()) / 3600000;
};

/** 是否在開課前 24 小時內（含已開課）。精確計算小時差，不以日期粗估。 */
export const isWithin24Hours = (
  dateStr: string,
  startHour: number,
  startMin: number,
  systemBaseDate: string,
): boolean => hoursUntilLesson(dateStr, startHour, startMin, systemBaseDate) < 24;

/** 課堂尚未開始（開課時間晚於現在）。 */
export const isFutureLesson = (
  dateStr: string,
  startHour: number,
  startMin: number,
  systemBaseDate: string,
): boolean => hoursUntilLesson(dateStr, startHour, startMin, systemBaseDate) > 0;

/**
 * 佔用學員堂數額度（全站唯一口徑）：confirmed，或「送審中的新預約（非營業時間 / 非優先申請）」，且尚未簽到。
 * 取消（含 24H 內送審取消）與學員堂數完全脫鉤：special_pending 的 late_change 不佔額度。
 * 注意：此函式只回答「額度」；是否可簽到 / 改期 / 結算請用 isActionableBooking。
 */
export const occupiesQuota = (b: Pick<BookingItem, 'status' | 'signed' | 'pendingKind' | 'isReleasedGhost'>): boolean =>
  !b.isReleasedGhost && (b.status === 'confirmed' || isPendingApproval(b)) && !b.signed;

/** 送審中的新預約（非營業時間 / 非優先申請）：卡住時段、佔學員額度，核准前不可操作 */
export const isPendingApproval = (b: Pick<BookingItem, 'status' | 'pendingKind'>): boolean =>
  b.status === 'special_pending' && isHoldingPendingKind(b.pendingKind);

/** 可被老師操作的有效課堂：confirmed、未簽、未結算鎖定（簽到 / 改期 / 取消 / 結算的狀態防護）。 */
export const isActionableBooking = (
  b: Pick<BookingItem, 'status' | 'signed' | 'isSettlementLocked'>,
): boolean => b.status === 'confirmed' && !b.signed && !b.isSettlementLocked;

/**
 * 可簽到 / 取消的課堂：有效課堂，或尚在審核中的新預約（非營業 / 非優先），且未簽、未結算鎖定。
 * 改期 / 改室仍須用 isActionableBooking，並另外排除改室審核中的課堂。
 */
export const isSignableBooking = (
  b: Pick<BookingItem, 'status' | 'signed' | 'isSettlementLocked' | 'pendingKind'>,
): boolean => !b.signed && !b.isSettlementLocked && (b.status === 'confirmed' || isPendingApproval(b));

/** 已實際授課：有效預約且已簽到（含補簽、系統代簽）。 */
export const isTaughtBooking = (b: Pick<BookingItem, 'status' | 'signed'>): boolean =>
  b.status === 'confirmed' && !!b.signed;

/** 逾期待處理：confirmed、未簽、未鎖定，且日期嚴格早於基準日。 */
export const isOverdueUnsettled = (
  b: Pick<BookingItem, 'status' | 'signed' | 'isSettlementLocked' | 'date'>,
  systemBaseDate: string,
): boolean => isActionableBooking(b) && isBookingOverdue(b.date, systemBaseDate);

/** 學員比對：有 studentId 時嚴格只比 ID，否則才退回姓名。 */
export const matchesStudent = (
  s: { id: string; name: string },
  studentId?: string,
  studentName?: string,
): boolean => (studentId ? s.id === studentId : !!studentName && s.name === studentName);

/**
 * 是否已釋出空位：一般取消、免罰、計罰，以及 24H 內異動/取消待審（special_pending / late_change）。
 * 例外：送審中的新預約（非營業時間 / 非優先申請）會卡住時段，駁回後才釋出。
 */
export const isCancelledBooking = (status: string, pendingKind?: string): boolean =>
  isCancelledSlot(status, pendingKind);

/** 以整筆課堂判斷是否已釋出空位（日曆渲染與衝堂檢測共用）；改室審核的原教室提示一律視為空位 */
export const isSlotReleased = (b: Pick<BookingItem, 'status' | 'pendingKind' | 'isReleasedGhost'>): boolean =>
  !!b.isReleasedGhost || isCancelledSlot(b.status, b.pendingKind);

// ------------------------------------------
// 審核期間的卡位 (after_hours / non_priority 預約、room_change 改室)
// ------------------------------------------

/** 改室審核期間，原教室格子上的提示文字 */
export const RELEASED_SLOT_LABEL = '原時段釋出';

/** 審核狀態短標籤（全站唯一來源，一律 5 字以內） */
export const REVIEW_TAG = {
  room_change: '改室審核',
  after_hours: '非營業審核',
  non_priority: '非優先審核',
} as const;

/**
 * 依「待審的改教室申請 (room_change)」衍生檢視資料：
 *  - 課堂改為佔用「目標新教室」並標記 roomChangePending（禁止他人預約 / 排課撞進去）
 *  - 「原教室」視同已釋出：僅產生一筆提示用的 isReleasedGhost（不佔教室、不佔額度、不可操作）
 * 核准（原課堂寫入新教室）、駁回（維持原教室）後，因審核單不再是 pending，衍生資料自然消失。
 * 回傳值供「衝堂檢測 / 排課引擎 / 日曆顯示」使用，不可寫回課堂資料。
 */
export const applyPendingHolds = (
  bookings: BookingItem[],
  reviews: { id: string; bookingId?: string; status: string; reviewType?: string; reqRoom?: 'large' | 'small' }[],
): BookingItem[] => {
  const pending = reviews.filter(
    r => r.status === 'pending' && r.reviewType === 'room_change' && r.bookingId && r.reqRoom,
  );
  if (pending.length === 0) return bookings;
  const byBooking = new Map(pending.map(r => [r.bookingId as string, r]));
  const result: BookingItem[] = [];
  const ghosts: BookingItem[] = [];
  for (const b of bookings) {
    const rev = byBooking.get(b.id);
    if (rev?.reqRoom && !isSlotReleased(b) && rev.reqRoom !== b.roomType) {
      const marker = { from: b.roomType, to: rev.reqRoom };
      result.push({ ...b, roomType: rev.reqRoom, roomChangePending: marker });
      ghosts.push({ ...b, id: `ghost-${rev.id}`, isReleasedGhost: true, roomChangePending: marker });
    } else {
      result.push(b);
    }
  }
  return [...result, ...ghosts];
};

/** 審核卡位標籤（日曆卡片顯示用）；無審核卡位時回傳 null */
export const getReviewHoldLabel = (b: BookingItem): string | null => {
  if (b.isReleasedGhost) return RELEASED_SLOT_LABEL;
  if (b.roomChangePending) return REVIEW_TAG.room_change;
  if (isPendingApproval(b)) return b.pendingKind === 'non_priority' ? REVIEW_TAG.non_priority : REVIEW_TAG.after_hours;
  return null;
};

// ------------------------------------------
// 教室分配 (情境 A / B + 大教室自動讓位；1v2 絕不排小教室)
// ------------------------------------------

/** 被系統自動從大教室調度到小教室的既有 1v1 課堂 */
export interface AutoSwapItem {
  bookingId: string;
  toRoom: 'small';
  /** 被移課的原老師（調度通知對象） */
  teacherId: string;
  studentName: string;
  date: string;
  startHour: number;
  startMin: number;
  notice: string;
}

export interface RoomAssignmentResult {
  /** 最終教室 */
  roomType: RoomType;
  /** 需自動移至小教室的既有 1v1 課堂（canAutoSwap，可能多筆） */
  autoSwaps?: AutoSwapItem[];
  /** 情境 A：此 1v1 佔用大教室，具備可讓位權 */
  canYield?: boolean;
  /** 系統調整教室時的提示訊息 */
  notice?: string;
  /** 1v2 空間不足（大教室無法讓位）→ 呼叫端必須阻擋預約 */
  blocked?: boolean;
  /** 最終教室於該時段仍無法容納（需由呼叫端再走衝堂檢測） */
  roomFull?: boolean;
}

const timeLabel = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** 時段內仍有效（未釋出）的課堂 */
const liveBookings = (existing: BookingItem[], excludeBookingId?: string) =>
  existing.filter(b => !isSlotReleased(b) && (!excludeBookingId || b.id !== excludeBookingId));

/**
 * 被移動的舊 1v1 能否安全搬進小教室：以「它自己完整的 50 分鐘區間」檢查
 * 小教室無衝突，且任課老師、學員在該區間沒有其他課堂。
 */
export const canRelocateToSmall = (
  moved: BookingItem,
  existingBookings: BookingItem[],
  excludeBookingId?: string,
): boolean => {
  const mStart = moved.startHour * 60 + moved.startMin;
  const mEnd = mStart + (moved.durationMins || DEFAULT_DURATION_MINS);
  return !liveBookings(existingBookings, excludeBookingId).some(b => {
    if (b.id === moved.id || b.date !== moved.date) return false;
    const s = b.startHour * 60 + b.startMin;
    if (!overlaps(mStart, mEnd, s, s + (b.durationMins || DEFAULT_DURATION_MINS))) return false;
    const sameStudent = moved.studentId ? b.studentId === moved.studentId : b.studentName === moved.studentName;
    return b.roomType === 'small' || b.teacherId === moved.teacherId || sameStudent;
  });
};

/** 套用大教室讓位結果：被移課堂改為小教室（供衝堂檢測與寫入使用） */
export const applyAutoSwaps = (bookings: BookingItem[], swaps: AutoSwapItem[]): BookingItem[] => {
  if (swaps.length === 0) return bookings;
  const ids = new Set(swaps.map(s => s.bookingId));
  return bookings.map(b => (ids.has(b.id) ? { ...b, roomType: 'small' as const } : b));
};

export const resolveRoomAssignment = ({
  dateStr,
  startHour,
  startMin,
  durationMins = DEFAULT_DURATION_MINS,
  lessonType,
  requestedRoom,
  existingBookings,
  excludeBookingId,
}: {
  dateStr: string;
  startHour: number;
  startMin: number;
  durationMins?: number;
  lessonType: LessonType;
  requestedRoom: RoomType;
  userRole?: UserRole;
  existingBookings: BookingItem[];
  excludeBookingId?: string;
}): RoomAssignmentResult => {
  const reqStart = startHour * 60 + startMin;
  const reqEnd = reqStart + durationMins;

  const occupants = (room: RoomType) =>
    liveBookings(existingBookings, excludeBookingId).filter(b => {
      if (b.date !== dateStr || b.roomType !== room) return false;
      const s = b.startHour * 60 + b.startMin;
      return overlaps(reqStart, reqEnd, s, s + (b.durationMins || DEFAULT_DURATION_MINS));
    });

  const largeBusy = occupants('large');
  const smallBusy = occupants('small');
  const largeFree = largeBusy.length === 0;
  const smallFree = smallBusy.length === 0;

  if (lessonType === '1v1') {
    if (requestedRoom === 'small') return { roomType: 'small', roomFull: !smallFree };
    // 情境 A：大教室空閒 → 成立並標記可讓位
    if (largeFree) return { roomType: 'large', canYield: true };
    // 情境 B：大教室已滿 → 導回小教室
    return {
      roomType: 'small',
      notice: '大教室該時段已滿，系統已自動為您改排至小教室',
      roomFull: !smallFree,
    };
  }

  // ---- 1v2 ----
  const prefix = requestedRoom === 'small' ? '1v2 課程應使用大教室，' : '';
  if (largeFree) {
    return {
      roomType: 'large',
      notice: requestedRoom === 'small' ? '1v2 課程已由系統導回大教室' : undefined,
    };
  }

  // 大教室智慧讓位：所有重疊課堂都是「有效、未簽」的 1v1，且每一堂都能以自己完整 50 分鐘區間
  // 搬進小教室（小教室、任課老師、學員皆無衝堂）。任何一堂不行就整體放棄讓位（不可局部移動）。
  // 改室審核中：「大 ➔ 小」的 1v1 在檢視資料上已位於小教室（大教室視同釋出，不需讓位）；
  // 「小 ➔ 大」在大教室是新教室保留佔位，不可被移走。
  const yieldable =
    largeBusy.every(
      b => b.lessonType === '1v1' && b.status === 'confirmed' && !b.signed && !b.roomChangePending,
    ) &&
    largeBusy.every(b => canRelocateToSmall(b, existingBookings, excludeBookingId));
  if (yieldable) {
    const autoSwaps: AutoSwapItem[] = largeBusy.map(moved => ({
      bookingId: moved.id,
      toRoom: 'small',
      teacherId: moved.teacherId,
      studentName: moved.studentName,
      date: moved.date,
      startHour: moved.startHour,
      startMin: moved.startMin,
      notice: `${moved.date} ${timeLabel(moved.startHour, moved.startMin)} 的 1v1 課堂（${moved.studentName}）已因 1v2 預約自動調度至小教室`,
    }));
    return {
      roomType: 'large',
      autoSwaps,
      notice: `${prefix}原大教室 ${autoSwaps.length} 堂 1v1 已自動移至小教室`,
    };
  }

  // 1v2 絕對不可排入小教室：大教室被 1v2 佔用，或 1v1 無法讓位（小教室該 1v1 完整區間衝突等）→ 阻擋
  return {
    roomType: 'large',
    blocked: true,
    notice: '大教室該時段已滿且無法調度，空間不足，無法預約 1v2',
  };
};

// ------------------------------------------
// 預約時間邊界 / 優先權防護
// ------------------------------------------

export type TimeConstraintCode =
  | 'ok'
  | 'past'
  | 'deadline'
  | 'too_far'
  | 'non_priority'
  | 'after_hours';

/** 送審類型：他人優先時段優先於非營業時間（兩者同時成立時送 non_priority） */
export type BookingReviewKind = 'after_hours' | 'non_priority';

export interface TimeConstraintResult {
  /** 管理員於開課前 10 分鐘內（含已開課 / 過去時段）預約：允許，但須提醒「將直接寫入課表」 */
  urgent?: boolean;
  /** 是否可繼續（after_hours / non_priority 對老師為 true 但需送審） */
  allowed: boolean;
  /** 一般老師需建立 special_pending 並送審（類型見 reviewKind） */
  requiresReview: boolean;
  reviewKind?: BookingReviewKind;
  /** 落在非營業時間（一般老師須填事由） */
  offHours?: boolean;
  code: TimeConstraintCode;
  reason?: string;
  /** 他人優先時段的老師；未達送審條件時（14 天內或管理員操作）呼叫端應提醒確認 */
  priorityOwnerId?: string;
}

/** 取得該日期適用的營業時間設定 */
const getDayConfig = (dateStr: string, hours: BusinessHoursConfig) => {
  const dow = parseDate(dateStr).getDay();
  if (dow === 0) return hours.sunday;
  if (dow === 6) return hours.saturday;
  return hours.weekday;
};

/** 是否位於營業時間內（含整堂課結束時間）。供行事曆畫底色使用。 */
export const isWithinBusinessHours = (
  dateStr: string,
  startHour: number,
  startMin: number,
  businessHours: BusinessHoursConfig,
  durationMins: number = DEFAULT_DURATION_MINS,
): boolean => {
  const cfg = getDayConfig(dateStr, businessHours);
  if (!cfg.enabled) return false;
  const s = startHour * 60 + startMin;
  return s >= cfg.startHour * 60 && s + durationMins <= cfg.endHour * 60;
};

/** 固定排課規則（星期 + 時間）是否落在非營業時間或公休日。 */
export const isRuleOffHours = (
  rule: { freq?: string; day: string; time: string },
  businessHours: BusinessHoursConfig,
  durationMins: number = DEFAULT_DURATION_MINS,
): boolean => {
  if (!rule || rule.freq === '不固定') return false;
  const cfg = rule.day === '日' ? businessHours.sunday : rule.day === '六' ? businessHours.saturday : businessHours.weekday;
  if (!cfg.enabled) return true;
  const [h, m] = (rule.time || '10:00').split(':').map(Number);
  const s = h * 60 + (m || 0);
  return !(s >= cfg.startHour * 60 && s + durationMins <= cfg.endHour * 60);
};

/** 兩個 'YYYY-MM-DD' 相差天數（a - b） */
export const diffDays = (a: string, b: string): number =>
  Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 86400000);

/**
 * 該堂課「完整區間」(start ~ start+duration) 涵蓋的每個整點格，
 * 逐格比對 priorityGrid，回傳不是 teacherId 的優先老師（無則 undefined）。
 * 例：10:30 開始的 50 分鐘課涵蓋 10 點與 11 點兩格。
 */
export const findOtherPriorityOwner = ({
  dateStr,
  startHour,
  startMin,
  durationMins = DEFAULT_DURATION_MINS,
  roomType,
  teacherId,
  priorityGrid,
}: {
  dateStr: string;
  startHour: number;
  startMin: number;
  durationMins?: number;
  roomType?: RoomType;
  teacherId: string;
  priorityGrid: PriorityGrid;
}): string | undefined => {
  const dayName = ['日', '一', '二', '三', '四', '五', '六'][parseDate(dateStr).getDay()];
  const s = startHour * 60 + startMin;
  const firstHour = Math.floor(s / 60);
  const lastHour = Math.floor((s + durationMins - 1) / 60);
  for (let h = firstHour; h <= lastHour; h++) {
    const slot = priorityGrid[`${dayName}-${h}`] || {};
    // 「不限教室」(all) 同時涵蓋大、小教室
    const owners = roomType ? [slot.all, slot[roomType]] : [slot.all, slot.large, slot.small];
    const other = owners.find(o => o && o !== teacherId);
    if (other) return other;
  }
  return undefined;
};

/** 一般老師預約他人優先時段且距上課超過 14 天 → 需送審 */
export const needsPriorityReview = ({
  dateStr,
  systemBaseDate,
  userRole,
  priorityOwnerId,
}: {
  dateStr: string;
  systemBaseDate: string;
  userRole: UserRole;
  priorityOwnerId?: string;
}): boolean => userRole !== 'admin' && !!priorityOwnerId && diffDays(dateStr, systemBaseDate) > 14;

export const checkBookingTimeConstraints = ({
  dateStr,
  startHour,
  startMin,
  durationMins = DEFAULT_DURATION_MINS,
  roomType,
  teacherId,
  userRole,
  systemBaseDate,
  now,
  businessHours = DEFAULT_BUSINESS_HOURS,
  priorityGrid = {},
}: {
  dateStr: string;
  startHour: number;
  startMin: number;
  durationMins?: number;
  roomType?: RoomType;
  teacherId: string;
  userRole: UserRole;
  /** 全局基準日 'YYYY-MM-DD' */
  systemBaseDate: string;
  /** 目前時間；未提供時以 systemBaseDate 搭配當下時分作為現在 */
  now?: Date;
  businessHours?: BusinessHoursConfig;
  priorityGrid?: PriorityGrid;
}): TimeConstraintResult => {
  const isAdmin = userRole === 'admin';
  const current = now ?? getNow(systemBaseDate);
  const lessonDay = parseDate(dateStr);
  const lessonStart = new Date(
    lessonDay.getFullYear(),
    lessonDay.getMonth(),
    lessonDay.getDate(),
    startHour,
    startMin,
  );
  const minsUntil = Math.floor((lessonStart.getTime() - current.getTime()) / 60000);
  const isPastDay = dateStr < systemBaseDate;

  // 0. 一般老師不可排過去日期（管理員可補排，需由呼叫端二次確認）
  if (!isAdmin && isPastDay) {
    return {
      allowed: false,
      requiresReview: false,
      code: 'past',
      reason: '一般老師不可預約過去的日期，如需補排請聯絡管理員',
    };
  }

  // 1. 臨時預約截止：一般老師嚴格限開課前 60 分鐘；
  //    管理員不阻擋，但開課前 10 分鐘內 / 已開課 / 過去時段回傳 urgent，由呼叫端顯示紅字提醒。
  if (!isAdmin && minsUntil < 60) {
    return {
      allowed: false,
      requiresReview: false,
      code: 'deadline',
      reason: '已超過開課前 1 小時，無法新增預約，請聯絡管理員',
    };
  }
  const urgent = isAdmin && minsUntil < 10;

  // 距離上課天數（以日期計）
  const daysAhead = diffDays(dateStr, systemBaseDate);

  // 2. 一般老師最多預約未來 90 天
  if (!isAdmin && daysAhead > 90) {
    return {
      allowed: false,
      requiresReview: false,
      code: 'too_far',
      reason: '一般老師最多只能預約未來 3 個月（90 天）內的時段',
    };
  }

  // 3. 優先時段：以完整區間逐格比對。距上課 > 14 天，其他一般老師可預約但需送審（non_priority）；
  //    14 天內開放直接預約，但回傳 priorityOwnerId 供呼叫端提醒。
  const priorityOwnerId = findOtherPriorityOwner({
    dateStr, startHour, startMin, durationMins, roomType, teacherId, priorityGrid,
  });
  // 4. 營業時間（含公休日）；管理員不受限
  const offHours = !isAdmin && !isWithinBusinessHours(dateStr, startHour, startMin, businessHours, durationMins);

  if (needsPriorityReview({ dateStr, systemBaseDate, userRole, priorityOwnerId })) {
    return {
      allowed: true,
      requiresReview: true,
      reviewKind: 'non_priority',
      offHours,
      code: 'non_priority',
      reason: offHours
        ? '此時段為其他老師的優先時段且為非營業時間，需填寫事由並送管理員審核'
        : '此時段為其他老師的優先時段，送出後需經管理員審核',
      priorityOwnerId,
    };
  }

  if (offHours) {
    return {
      allowed: true,
      requiresReview: true,
      reviewKind: 'after_hours',
      offHours,
      code: 'after_hours',
      reason: '此時段為非營業時間，需填寫事由並送管理員審核',
      priorityOwnerId,
    };
  }

  return { allowed: true, requiresReview: false, code: 'ok', priorityOwnerId, urgent };
};

// ------------------------------------------
// 統一預約入口：validateAndBuildBooking
// ------------------------------------------

export interface BookingRequestInput {
  date: string;
  startHour: number;
  startMin: number;
  durationMins?: number;
  teacherId: string;
  studentId: string;
  studentName: string;
  roomType: RoomType;
  lessonType: LessonType;
}

export interface QuotaInfo {
  credits: number;
  /** 已佔用額度（occupiesQuota，不含本次） */
  occupied: number;
  /** 加上本次後是否超出剩餘堂數 */
  exceeds: boolean;
  found: boolean;
}

export interface ValidateBookingResult {
  ok: boolean;
  /** 阻擋原因（ok=false 時） */
  error?: string;
  /** 阻擋類別：room = 1v2 大教室無法讓位；time = 時間規則；conflict = 衝堂 */
  errorKind?: 'room' | 'time' | 'conflict';
  /** 管理員於開課前 10 分鐘內 / 已開課 / 過去時段預約，確認後直接寫入課表 */
  urgent?: boolean;
  /** 已套用最終教室、狀態的預約（ok=true 時） */
  booking?: BookingItem;
  /** 需送審：booking.status 已為 special_pending */
  requiresReview: boolean;
  reviewKind?: BookingReviewKind;
  /** 落在非營業時間：呼叫端須取得事由 */
  offHours?: boolean;
  reviewReason?: string;
  /** 教室調度提示（導正教室 / 讓位） */
  notices: string[];
  /** 需同步從大教室移到小教室的既有 1v1 */
  autoSwaps: AutoSwapItem[];
  /** 他人優先時段提醒 */
  priorityOwnerId?: string;
  /** 管理員補排過去日期：呼叫端應二次確認 */
  isPastBackfill: boolean;
  quota: QuotaInfo;
}

const newBookingId = () => genId('b');

/**
 * 全站唯一的預約驗證 / 建構入口：
 *   時間限制 → 教室調度（含讓位檢查）→ 全局衝堂 → 額度試算
 * 全域預約彈窗、學員快速預約、新生排課、改期（BookingEditModal）全部走這裡。
 */
export const validateAndBuildBooking = ({
  input,
  userRole,
  systemBaseDate,
  businessHours = DEFAULT_BUSINESS_HOURS,
  priorityGrid = {},
  bookings,
  teachers,
  students,
  studentOverride,
  excludeBookingId,
  mode = 'create',
  skipTimeConstraints = false,
  skipQuota = false,
  now,
}: {
  input: BookingRequestInput;
  userRole: UserRole;
  systemBaseDate: string;
  businessHours?: BusinessHoursConfig;
  priorityGrid?: PriorityGrid;
  bookings: BookingItem[];
  teachers: Record<string, TeacherProfile>;
  students: StudentItem[];
  /** 尚未寫入名單的新學員（新生排課） */
  studentOverride?: Pick<StudentItem, 'id' | 'name' | 'credits'>;
  /** 改期時排除自己 */
  excludeBookingId?: string;
  /** reschedule：非營業時間 / 他人優先時段不可送審（直接阻擋）；額度不變 */
  mode?: 'create' | 'reschedule';
  /** 僅改教室（時間未變）時略過時間限制 */
  skipTimeConstraints?: boolean;
  skipQuota?: boolean;
  now?: Date;
}): ValidateBookingResult => {
  const duration = input.durationMins || DEFAULT_DURATION_MINS;
  const blank: ValidateBookingResult = {
    ok: false,
    requiresReview: false,
    notices: [],
    autoSwaps: [],
    isPastBackfill: false,
    quota: { credits: 0, occupied: 0, exceeds: false, found: false },
  };
  const fail = (
    error: string,
    errorKind: ValidateBookingResult['errorKind'],
    extra: Partial<ValidateBookingResult> = {},
  ): ValidateBookingResult => ({
    ...blank,
    ...extra,
    ok: false,
    error,
    errorKind,
  });

  // 1. 教室調度（先決定最終教室，優先時段才能以最終教室比對）
  const assignment = resolveRoomAssignment({
    dateStr: input.date,
    startHour: input.startHour,
    startMin: input.startMin,
    durationMins: duration,
    lessonType: input.lessonType,
    requestedRoom: input.roomType,
    userRole,
    existingBookings: bookings,
    excludeBookingId,
  });
  if (assignment.blocked) return fail(assignment.notice || '大教室空間不足，無法預約 1v2', 'room');
  const finalRoom = assignment.roomType;
  const autoSwaps = assignment.autoSwaps ?? [];
  const notices = assignment.notice ? [assignment.notice] : [];

  // 2. 時間限制
  let requiresReview = false;
  let reviewReason: string | undefined;
  let reviewKind: BookingReviewKind | undefined;
  let offHours = false;
  let priorityOwnerId: string | undefined;
  let urgent = false;
  if (!skipTimeConstraints) {
    const tc = checkBookingTimeConstraints({
      dateStr: input.date,
      startHour: input.startHour,
      startMin: input.startMin,
      durationMins: duration,
      roomType: finalRoom,
      teacherId: input.teacherId,
      userRole,
      systemBaseDate,
      now,
      businessHours,
      priorityGrid,
    });
    if (!tc.allowed) return fail(tc.reason || '不符合預約時間規定', 'time');
    if (tc.requiresReview && mode === 'reschedule') {
      const target = tc.reviewKind === 'non_priority' ? '他人優先時段' : '非營業時間';
      return fail(`改期至${target}需由管理員處理，請聯絡管理員或另行新增預約送審`, 'time');
    }
    urgent = !!tc.urgent;
    requiresReview = tc.requiresReview;
    reviewReason = tc.reason;
    reviewKind = tc.reviewKind;
    offHours = !!tc.offHours;
    priorityOwnerId = tc.priorityOwnerId;
  } else {
    // 僅改教室：不可藉由換教室繞過他人優先時段送審（24H 內改室本身即送審，且不會超過 14 天）
    const original = bookings.find(b => b.id === excludeBookingId);
    const owner = original && original.roomType !== finalRoom
      ? findOtherPriorityOwner({
          dateStr: input.date, startHour: input.startHour, startMin: input.startMin,
          durationMins: duration, roomType: finalRoom, teacherId: input.teacherId, priorityGrid,
        })
      : undefined;
    if (needsPriorityReview({ dateStr: input.date, systemBaseDate, userRole, priorityOwnerId: owner })) {
      return fail('改至他人優先時段的教室需由管理員處理，請聯絡管理員或另行新增預約送審', 'time');
    }
  }

  // 3. 全局衝堂（讓位成功時，被移課堂視為已在小教室）
  const effective = applyAutoSwaps(bookings, autoSwaps);
  const studentsMap: Record<string, StudentItem> = Object.fromEntries(students.map(s => [s.id, s]));
  const conflict = checkGlobalConflict({
    dateStr: input.date,
    startHour: input.startHour,
    startMin: input.startMin,
    durationMins: duration,
    roomType: finalRoom,
    lessonType: input.lessonType,
    teacherId: input.teacherId,
    studentId: input.studentId,
    studentName: input.studentName,
    userRole,
    existingBookings: effective,
    teachersMap: teachers,
    studentsMap,
    excludeBookingId,
  });
  if (conflict.hasConflict) {
    return fail(conflict.reason || '該時段已有預約', 'conflict', { notices, autoSwaps });
  }

  // 4. 額度（統一以 occupiesQuota 計算）
  const student =
    studentOverride ??
    students.find(s => matchesStudent(s, input.studentId, input.studentName));
  let quota: QuotaInfo = { credits: 0, occupied: 0, exceeds: false, found: false };
  if (student && !skipQuota) {
    const occupied = bookings.filter(
      b => b.id !== excludeBookingId && matchesStudent(student, b.studentId, b.studentName) && occupiesQuota(b),
    ).length;
    const credits = student.credits ?? 0;
    quota = { credits, occupied, exceeds: occupied + 1 > credits, found: true };
  }

  const booking: BookingItem = {
    id: newBookingId(),
    date: input.date,
    startHour: input.startHour,
    startMin: input.startMin,
    durationMins: duration,
    teacherId: input.teacherId,
    studentName: input.studentName,
    studentId: input.studentId,
    roomType: finalRoom,
    lessonType: input.lessonType,
    status: requiresReview ? 'special_pending' : 'confirmed',
    pendingKind: reviewKind,
    signed: false,
  };

  return {
    ok: true,
    booking,
    urgent,
    requiresReview,
    reviewKind,
    offHours,
    reviewReason,
    notices,
    autoSwaps,
    priorityOwnerId,
    isPastBackfill: userRole === 'admin' && input.date < systemBaseDate,
    quota,
  };
};

/**
 * 加課替換：只能刪除「最遠一堂」自動預排，且該堂必須是「confirmed、未簽、isAuto === true」、日期不早於基準日。
 * 手動預約、審核中（special_pending，含非營業時間待審）、已鎖定者一律不可被靜默替換：
 * 若最遠一堂自動預排屬於審核中（含改室審核），不得改刪較近的課堂，直接回傳 undefined 交由呼叫端跳出提示。
 */
export const findReplaceableAutoBooking = (
  bookings: BookingItem[],
  student: { id: string; name: string },
  systemBaseDate: string,
): BookingItem | undefined => {
  const farthest = bookings
    .filter(
      b =>
        matchesStudent(student, b.studentId, b.studentName) &&
        b.isAuto === true &&
        !b.isReleasedGhost &&
        !b.signed &&
        !b.isSettlementLocked &&
        b.date >= systemBaseDate &&
        (b.status === 'confirmed' || isPendingApproval(b)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour * 60 + a.startMin - (b.startHour * 60 + b.startMin))
    .pop();
  return farthest && farthest.status === 'confirmed' && !farthest.roomChangePending ? farthest : undefined;
};

// ------------------------------------------
// 自動排課額度明細
// ------------------------------------------

export interface ScheduleQuota {
  /** 學生剩餘堂數（簽到當下已扣堂） */
  totalRemaining: number;
  /** 歷史簽到：僅供參考，不參與扣減 */
  signedCount: number;
  /** 逾期紀錄：日期早於基準日、未簽到且仍佔額度 */
  overdueCount: number;
  /** 待審核預約：未來未簽到的待審課堂（非營業時間 / 非優先申請，及改室審核中） */
  pendingCount: number;
  /** 已經預排：未來 confirmed（不含改室審核中） */
  confirmedFutureCount: number;
  /** 剩餘可排 = max(0, 剩餘 - (逾期 + 待審 + 已預排)) */
  availableToSchedule: number;
  /** 重排總堂數 = max(0, 剩餘 - (逾期 + 待審)) */
  replaceTotal: number;
}

/**
 * 逾期 / 待審 / 已預排三者互斥，合計等於 occupiesQuota 的佔用堂數。
 * bookings 需傳入含改室審核衍生資料（applyPendingHolds）的清單。
 * 24H 內取消待審 (late_change) 不佔額度，不列入待審核預約。
 */
export const getScheduleQuota = (
  bookings: BookingItem[],
  student: { id: string; name: string; credits: number },
  systemBaseDate: string,
): ScheduleQuota => {
  const own = bookings.filter(b => !b.isReleasedGhost && matchesStudent(student, b.studentId, b.studentName));
  const occupied = own.filter(occupiesQuota);
  const upcoming = occupied.filter(b => !isBookingOverdue(b.date, systemBaseDate));
  const overdueCount = occupied.length - upcoming.length;
  const pendingCount = upcoming.filter(b => isPendingApproval(b) || !!b.roomChangePending).length;
  const confirmedFutureCount = upcoming.length - pendingCount;
  const totalRemaining = student.credits;
  return {
    totalRemaining,
    signedCount: own.filter(isTaughtBooking).length,
    overdueCount,
    pendingCount,
    confirmedFutureCount,
    availableToSchedule: Math.max(0, totalRemaining - (overdueCount + pendingCount + confirmedFutureCount)),
    replaceTotal: Math.max(0, totalRemaining - (overdueCount + pendingCount)),
  };
};

// ------------------------------------------
// 簽名時間窗：開課前後各 1 小時
// ------------------------------------------

export type SignatureWindowStatus = 'too_early' | 'open' | 'late_over_1h';

/**
 * 簽名時間窗（以課堂開始 startTime 與結束 startTime + 50 分鐘計算）：
 *  - too_early：距開課超過 1 小時 → 尚未開放簽到，禁止開啟簽名板
 *  - late_over_1h：已超過課堂結束時間 1 小時以上 → 允許逾期補簽，但需顯示紅字提醒
 *  - open：其餘（開課前 1 小時 ~ 結束後 1 小時）
 */
export const getSignatureWindowStatus = (
  b: Pick<BookingItem, 'date' | 'startHour' | 'startMin' | 'durationMins'>,
  systemBaseDate: string,
  realNow: Date = new Date(),
): SignatureWindowStatus => {
  const d = parseDate(b.date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), b.startHour, b.startMin).getTime();
  const end = start + (b.durationMins || DEFAULT_DURATION_MINS) * 60000;
  const now = getNow(systemBaseDate, realNow).getTime();
  if (start - now > 60 * 60000) return 'too_early';
  if (now - end > 60 * 60000) return 'late_over_1h';
  return 'open';
};

// ------------------------------------------
// 免費特殊取消額度
// ------------------------------------------

/**
 * 依老師當月已上堂數計算免費特殊取消額度：
 * 未滿 20 堂 0 次；20 堂 1 次；21–40 堂 2 次；41–60 堂 3 次（每加 20 堂 +1 次）。
 */
export const calculateFreeCancelQuota = (monthlyCompletedLessons: number): number => {
  if (!monthlyCompletedLessons || monthlyCompletedLessons < 20) return 0;
  return Math.ceil(monthlyCompletedLessons / 20);
};

// ------------------------------------------
// 顯示輔助
// ------------------------------------------

/** 格式化多重排課規則 (包含個別時段獨立的類別標示) */
export const formatRules = (rules?: any[]): string => {
  if (!rules || rules.length === 0) return '未設定';
  if (rules.every(r => r.freq === '不固定')) return '不固定排課';
  const dayMap: Record<string, string> = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '日': '7' };
  return rules
    .filter(r => r.freq !== '不固定')
    .map(r => {
      const f = r.freq === '每週' || r.freq === 'W' ? 'W' : r.freq === '隔週' ? 'EOW' : '';
      const typeLabel = r.lessonType ? `(${r.lessonType})` : '';
      return `${f}${dayMap[r.day] || r.day} ${r.time}${typeLabel}`;
    })
    .join(' / ');
};

// ------------------------------------------
// 老師月統計（Tab 4 老師與管理員共用）
// ------------------------------------------

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export const monthKeyOf = (dateStr: string): string => (dateStr || '').slice(0, 7);

/** 由 bookings 動態推導月份清單（新到舊），一定包含基準日當月。 */
export const deriveMonthKeys = (bookings: Pick<BookingItem, 'date'>[], systemBaseDate: string): string[] => {
  const set = new Set<string>([monthKeyOf(systemBaseDate)]);
  bookings.forEach(b => b.date && set.add(monthKeyOf(b.date)));
  return Array.from(set).filter(Boolean).sort().reverse();
};

/** 'YYYY-MM' → '2026 年 10 月' */
export const formatMonthKey = (key: string): string => {
  const [y, m] = key.split('-');
  return `${y} 年 ${m} 月`;
};

export interface TeacherMonthStats {
  count1v1: number;
  count1v2: number;
  total: number;
  /** 正常取消（送出即累計；不含送審預約被駁回） */
  normalCancel: number;
  /** 超時取消（24H 內取消，送出即累計，不等管理員審核；審核結果不影響此欄） */
  lateCancel: number;
  /** 計罰次數：僅審核裁決 / 系統結算的結果（逾期取消 / 逾期改期 / 月底未到課），一堂課最多 1 次 */
  penalty: number;
}

/**
 * 老師月統計（全站唯一口徑）。teacherId 省略時統計整個 bookings 清單。
 * 已授課堂數一律以 isTaughtBooking 計算。
 */
export const getTeacherStats = (
  bookings: BookingItem[],
  monthKey: string,
  teacherId?: string,
): TeacherMonthStats => {
  const list = bookings.filter(
    b => monthKeyOf(b.date) === monthKey && (!teacherId || b.teacherId === teacherId),
  );
  const count1v1 = list.filter(b => b.lessonType === '1v1' && isTaughtBooking(b)).length;
  const count1v2 = list.filter(b => b.lessonType === '1v2' && isTaughtBooking(b)).length;
  const normalCancel = list.filter(
    b => b.status === 'cancelled_normal' &&
      b.cancelReason !== 'after_hours_rejected' && b.cancelReason !== 'non_priority_rejected',
  ).length;
  // 超時取消：24H 內取消送出即計（待審 / 免罰 / 計罰皆算）；月底系統強制結算者並非老師送出的取消，不列入
  const lateCancel = list.filter(
    b =>
      (b.status === 'special_pending' && b.pendingKind === 'late_change') ||
      b.status === 'special_approved' ||
      (b.status === 'special_rejected' && b.settlementType !== 'unattended_no_credit_deducted'),
  ).length;
  // 一堂課最多計罰一次（逾期改期、逾期取消、月底強制結算不累加）
  const penalty = list.filter(b => b.status === 'special_rejected' || (b.penaltyCount || 0) > 0).length;
  return { count1v1, count1v2, total: count1v1 + count1v2, normalCancel, lateCancel, penalty };
};

// ------------------------------------------
// 通知分級 / 審核卡片標籤 / 送審時間
// ------------------------------------------

export type LogSeverity = 'gray' | 'yellow' | 'red';

/** 通知分級（相容舊資料：沒有 severity 時由 category 推斷，normal → gray） */
export const getLogSeverity = (l: Pick<AuditLogItem, 'category'> & { severity?: LogSeverity }): LogSeverity =>
  l.severity ?? (l.category === 'red' ? 'red' : l.category === 'yellow' ? 'yellow' : 'gray');

/** 審核卡片業務類型標籤 */
export const getReviewTypeLabel = (r: Pick<ReviewItem, 'reviewType'>): string => {
  switch (r.reviewType) {
    case 'room_change': return REVIEW_TAG.room_change;
    case 'reschedule': return '逾期改期';
    case 'after_hours': return REVIEW_TAG.after_hours;
    case 'non_priority': return REVIEW_TAG.non_priority;
    case 'settlement_undo': return '結算更正';
    case 'sign': return '簽到';
    case 'late_sign': return '補簽';
    default: return '逾期取消';
  }
};

/** 目前時間，格式 YYYY/MM/DD HH:mm（審核單送審時間） */
export const formatSubmittedAt = (d: Date = new Date()): string =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
