import { genId } from './id';
// ==========================================
// bookingRules.ts — 共用預約規則 (Single Source of Truth)
// 對應 REFACTOR_SPEC.md 第二、三節
// ==========================================
import type {
  BookingItem,
  BusinessHoursConfig,
  StudentItem,
  TeacherProfile,
} from '../types';
import { checkGlobalConflict, isCancelledSlot } from './conflict';

type RoomType = 'large' | 'small';
type LessonType = '1v1' | '1v2';
type UserRole = 'admin' | 'teacher';
export type PriorityGrid = Record<string, { large?: string; small?: string }>;

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
 * 佔用學員堂數額度（全站唯一口徑）：confirmed，或「非營業時間預約待審」，且尚未簽到。
 * 取消（含 24H 內送審取消）與學員堂數完全脫鉤：special_pending 的 late_change 不佔額度。
 * 注意：此函式只回答「額度」；是否可簽到 / 改期 / 結算請用 isActionableBooking。
 */
export const occupiesQuota = (b: Pick<BookingItem, 'status' | 'signed' | 'pendingKind'>): boolean =>
  (b.status === 'confirmed' || (b.status === 'special_pending' && b.pendingKind === 'after_hours')) && !b.signed;

/** 可被老師操作的有效課堂：confirmed、未簽、未結算鎖定（簽到 / 改期 / 取消 / 結算的狀態防護）。 */
export const isActionableBooking = (
  b: Pick<BookingItem, 'status' | 'signed' | 'isSettlementLocked'>,
): boolean => b.status === 'confirmed' && !b.signed && !b.isSettlementLocked;

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
 * 是否已釋出空位：一般取消、免罰、計罰，以及 special_pending（審核中絕不卡時段）。
 */
export const isCancelledBooking = (status: string): boolean => isCancelledSlot(status);

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
  existing.filter(b => !isCancelledBooking(b.status) && (!excludeBookingId || b.id !== excludeBookingId));

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
  const yieldable =
    largeBusy.every(b => b.lessonType === '1v1' && b.status === 'confirmed' && !b.signed) &&
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
  | 'priority_locked'
  | 'after_hours';

export interface TimeConstraintResult {
  /** 是否可繼續（after_hours 對老師為 true 但需送審） */
  allowed: boolean;
  /** 非營業時間：一般老師須填事由、建立 special_pending 並送 after_hours 審核單 */
  requiresReview: boolean;
  code: TimeConstraintCode;
  reason?: string;
  /** 他人優先時段（已進入 14 天開放期或管理員操作）：呼叫端應提醒確認 */
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
    const owners = roomType ? [slot[roomType]] : [slot.large, slot.small];
    const other = owners.find(o => o && o !== teacherId);
    if (other) return other;
  }
  return undefined;
};

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

  // 1. 臨時預約截止：一般老師開課前 60 分鐘、管理員 10 分鐘（管理員補排過去日期不受此限）
  const cutoff = isAdmin ? 10 : 60;
  if (!(isAdmin && isPastDay) && minsUntil < cutoff) {
    return {
      allowed: false,
      requiresReview: false,
      code: 'deadline',
      reason: isAdmin
        ? '已超過開課前 10 分鐘，無法新增預約'
        : '已超過開課前 1 小時，無法新增預約，請聯絡管理員',
    };
  }

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

  // 3. 優先時段：以完整區間逐格比對。距上課 > 14 天僅限優先老師本人（或管理員）；
  //    14 天內開放，但回傳 priorityOwnerId 供呼叫端提醒。
  const priorityOwnerId = findOtherPriorityOwner({
    dateStr, startHour, startMin, durationMins, roomType, teacherId, priorityGrid,
  });
  if (!isAdmin && priorityOwnerId && daysAhead > 14) {
    return {
      allowed: false,
      requiresReview: false,
      code: 'priority_locked',
      reason: '此為其他老師的優先時段，開課前 14 天內才開放預約',
      priorityOwnerId,
    };
  }

  // 4. 營業時間（含公休日）；管理員不受限
  if (!isAdmin && !isWithinBusinessHours(dateStr, startHour, startMin, businessHours, durationMins)) {
    return {
      allowed: true,
      requiresReview: true,
      code: 'after_hours',
      reason: '此時段為非營業時間，需填寫事由並送管理員審核',
      priorityOwnerId,
    };
  }

  return { allowed: true, requiresReview: false, code: 'ok', priorityOwnerId };
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
  /** 已套用最終教室、狀態的預約（ok=true 時） */
  booking?: BookingItem;
  /** 非營業時間：呼叫端須取得事由，booking.status 已為 special_pending */
  requiresReview: boolean;
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
  /** reschedule：非營業時間不可送審（直接阻擋）；額度不變 */
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
  const fail = (error: string, extra: Partial<ValidateBookingResult> = {}): ValidateBookingResult => ({
    ...blank,
    ...extra,
    ok: false,
    error,
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
  if (assignment.blocked) return fail(assignment.notice || '大教室空間不足，無法預約 1v2');
  const finalRoom = assignment.roomType;
  const autoSwaps = assignment.autoSwaps ?? [];
  const notices = assignment.notice ? [assignment.notice] : [];

  // 2. 時間限制
  let requiresReview = false;
  let reviewReason: string | undefined;
  let priorityOwnerId: string | undefined;
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
    if (!tc.allowed) return fail(tc.reason || '不符合預約時間規定');
    if (tc.requiresReview && mode === 'reschedule') {
      return fail('改期至非營業時間需由管理員處理，請聯絡管理員或另行新增預約送審');
    }
    requiresReview = tc.requiresReview;
    reviewReason = tc.reason;
    priorityOwnerId = tc.priorityOwnerId;
  }

  // 3. 全局衝堂（讓位成功時，被移課堂視為已在小教室）
  const swapIds = new Set(autoSwaps.map(s => s.bookingId));
  const effective = swapIds.size
    ? bookings.map(b => (swapIds.has(b.id) ? { ...b, roomType: 'small' as const } : b))
    : bookings;
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
    return fail(conflict.reason || '該時段已有預約', { notices, autoSwaps });
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
    pendingKind: requiresReview ? 'after_hours' : undefined,
    signed: false,
  };

  return {
    ok: true,
    booking,
    requiresReview,
    reviewReason,
    notices,
    autoSwaps,
    priorityOwnerId,
    isPastBackfill: userRole === 'admin' && input.date < systemBaseDate,
    quota,
  };
};

/**
 * 加課替換：只能刪除「confirmed、未簽、isAuto === true」且日期不早於基準日的最遠一堂。
 * 手動預約、審核中（special_pending）、已鎖定者一律不可被替換。
 */
export const findReplaceableAutoBooking = (
  bookings: BookingItem[],
  student: { id: string; name: string },
  systemBaseDate: string,
): BookingItem | undefined =>
  bookings
    .filter(
      b =>
        matchesStudent(student, b.studentId, b.studentName) &&
        b.status === 'confirmed' &&
        !b.signed &&
        !b.isSettlementLocked &&
        b.isAuto === true &&
        b.date >= systemBaseDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour * 60 + a.startMin - (b.startHour * 60 + b.startMin))
    .pop();

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
  /** 正常取消（不含非營業時間預約被駁回） */
  normalCancel: number;
  /** 計罰：計罰取消 + 改期計罰次數 */
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
    b => b.status === 'cancelled_normal' && b.cancelReason !== 'after_hours_rejected',
  ).length;
  const penalty = list.reduce(
    (n, b) => n + (b.status === 'special_rejected' ? 1 : 0) + (b.penaltyCount || 0),
    0,
  );
  return { count1v1, count1v2, total: count1v1 + count1v2, normalCancel, penalty };
};
