import { genId } from './id';
// ==========================================
// bookingRules.ts — 共用預約規則 (Single Source of Truth)
// 對應 REFACTOR_SPEC.md 第二、三節
// ==========================================
import type {
  AuditLogItem,
  BookingItem,
  PriorityGrid,
  StudentItem,
  TeacherProfile,
} from '../types';
import { checkGlobalConflict, isCancelledSlot, slotsOverlap } from './conflict';

type RoomType = 'large' | 'small';
type LessonType = '1v1' | '1v2';
type UserRole = 'admin' | 'teacher';
export type { PriorityGrid };

/** 分鐘選項（每 10 分鐘一格） */
export const BUSINESS_MINUTES: string[] = ['00', '10', '20', '30', '40', '50'];

/** 單堂預設時長（分鐘） */
export const DEFAULT_DURATION_MINS = 50;

/** 全館 24 小時開放：時間軸與時段選單一律 00:00 – 23:00 */
export const DAY_HOURS: number[] = Array.from({ length: 24 }, (_, i) => i);

/** 行事曆自動捲動：沒有課堂時的預設小時 */
export const DEFAULT_SCROLL_HOUR = 9;

const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

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

/** 距離開課的小時數（可為負數：已開課）。 */
export const hoursUntilLesson = (
  dateStr: string,
  startHour: number,
  startMin: number,
  now: Date = new Date(),
): number => {
  const d = parseDate(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour, startMin);
  return (start.getTime() - now.getTime()) / 3600000;
};

/** 是否在開課前 24 小時內（含已開課）。精確計算小時差，不以日期粗估。 */
export const isWithin24Hours = (
  dateStr: string,
  startHour: number,
  startMin: number,
): boolean => hoursUntilLesson(dateStr, startHour, startMin) < 24;

/** 課堂尚未開始（開課時間晚於現在）。 */
export const isFutureLesson = (
  dateStr: string,
  startHour: number,
  startMin: number,
  now: Date = new Date(),
): boolean => hoursUntilLesson(dateStr, startHour, startMin, now) > 0;

/** 非優先審核中的預約：卡住時段、佔學員額度；審核完成前可簽到、取消，不可變更 */
export const isPendingApproval = (b: Pick<BookingItem, 'status'>): boolean => b.status === 'special_pending';

/**
 * 佔用學員堂數額度（全站唯一口徑）：confirmed 或非優先審核中，且尚未簽到。
 * 注意：此函式只回答「額度」；是否可簽到 / 改期請用 isSignableBooking / isActionableBooking。
 */
export const occupiesQuota = (b: Pick<BookingItem, 'status' | 'signed'>): boolean =>
  (b.status === 'confirmed' || isPendingApproval(b)) && !b.signed;

/** 可變更的有效課堂：confirmed、未簽。 */
export const isActionableBooking = (b: Pick<BookingItem, 'status' | 'signed'>): boolean =>
  b.status === 'confirmed' && !b.signed;

/** 可簽到 / 取消的課堂：有效課堂或非優先審核中，且未簽。 */
export const isSignableBooking = (b: Pick<BookingItem, 'status' | 'signed'>): boolean => occupiesQuota(b);

/** 已實際授課：有效預約且已簽到（含補簽、系統代簽）。 */
export const isTaughtBooking = (b: Pick<BookingItem, 'status' | 'signed'>): boolean =>
  b.status === 'confirmed' && !!b.signed;

/**
 * 逾期未處理（未結）—— 全站唯一口徑：開課時間（date + startTime）<= 現在，且尚未簽到、未取消。
 * 當天已開課未簽到也算逾期。注意：不可直接當作 filter callback（第二個參數是現在時間）。
 */
export const isOverdueUnsettled = (
  b: Pick<BookingItem, 'status' | 'signed' | 'date' | 'startHour' | 'startMin'>,
  now: Date = new Date(),
): boolean => occupiesQuota(b) && !isFutureLesson(b.date, b.startHour, b.startMin, now);

/** 已封存學員不可再被排課（下拉選單與自動順延一律排除） */
export const isArchivedStudent = (s: Pick<StudentItem, 'status'>): boolean => s.status === 'archived';

/** 學員仍有效的預排堂數（尚未開課、佔額度；與學員詳情頁「預排課程」同一口徑） */
export const countScheduledLessons = (
  bookings: BookingItem[],
  student: { id: string; name: string },
  now: Date = new Date(),
): number =>
  bookings.filter(
    b => matchesStudent(student, b.studentId, b.studentName) && occupiesQuota(b) && !isOverdueUnsettled(b, now),
  ).length;

/** 封存確認提示（學員列表開關與詳情頁按鈕共用） */
export const archiveConfirmMessage = (name: string, scheduledCount: number): string =>
  `確定要封存學員「${name}」嗎？\n封存後不會出現在新增預約選單，可隨時解除封存。\n\n` +
  `此學員目前還有 ${scheduledCount} 堂預排課程` +
  (scheduledCount > 0 ? '，封存不會自動取消，如不上課請另行取消。' : '。');

/** 學員比對：有 studentId 時嚴格只比 ID，否則才退回姓名。 */
export const matchesStudent = (
  s: { id: string; name: string },
  studentId?: string,
  studentName?: string,
): boolean => (studentId ? s.id === studentId : !!studentName && s.name === studentName);

/** 整筆課堂是否已釋出空位（日曆渲染與衝堂檢測共用） */
export const isSlotReleased = (b: Pick<BookingItem, 'status'>): boolean => isCancelledSlot(b.status);

/** 審核狀態短標籤（全站唯一來源，一律 5 字以內） */
export const REVIEW_TAG = '非優先審核';

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
  return !liveBookings(existingBookings, excludeBookingId).some(b => {
    if (b.id === moved.id || !slotsOverlap(moved, b)) return false;
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
  const request = { date: dateStr, startHour, startMin, durationMins };

  const occupants = (room: RoomType) =>
    liveBookings(existingBookings, excludeBookingId).filter(
      b => b.roomType === room && slotsOverlap(request, b),
    );

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
// 全館 24 小時開放，無開課前截止與過去時段限制
// ------------------------------------------

export type TimeConstraintCode = 'ok' | 'too_far' | 'non_priority';

/** 他人優先時段：距上課達此天數（含）以上需管理員審核 */
export const PRIORITY_REVIEW_DAYS = 14;

export interface TimeConstraintResult {
  /** 是否可繼續（non_priority 對一般老師為 true 但需送審） */
  allowed: boolean;
  /** 一般老師需建立 special_pending 並送審（非優先審核） */
  requiresReview: boolean;
  code: TimeConstraintCode;
  reason?: string;
  /** 他人優先時段的老師；14 天內直接生效時呼叫端須發通知提醒該老師 */
  priorityOwnerId?: string;
}

/** 非優先審核自動核准結案註記 */
export const AUTO_APPROVE_NOTE = '已進入 14 天內免審核期，系統自動核准';

/** 距開課未滿 14 天：免審核期（新預約免審；既有待審課堂自動核准） */
export const isInReviewFreeWindow = (dateStr: string, today: string): boolean =>
  diffDays(dateStr, today) < PRIORITY_REVIEW_DAYS;

/** 已進入免審核期、應由系統自動核准的待審課堂 */
export const isDueForAutoApproval = (
  b: Pick<BookingItem, 'status' | 'date'>,
  today: string,
): boolean => isPendingApproval(b) && isInReviewFreeWindow(b.date, today);

/** 非優先送審的即時提示文字（所有預約彈窗共用） */
export const priorityReviewHint = (ownerName: string): string =>
  `⚠️ 此為 ${ownerName} 優先時段（14 天前預約），送出後需經管理員審核`;

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

/** 一般老師預約他人優先時段且距上課 14 天（含）以上 → 需送審 */
export const needsPriorityReview = ({
  dateStr,
  today,
  userRole,
  priorityOwnerId,
}: {
  dateStr: string;
  today: string;
  userRole: UserRole;
  priorityOwnerId?: string;
}): boolean =>
  userRole !== 'admin' && !!priorityOwnerId && !isInReviewFreeWindow(dateStr, today);

export const checkBookingTimeConstraints = ({
  dateStr,
  startHour,
  startMin,
  durationMins = DEFAULT_DURATION_MINS,
  roomType,
  teacherId,
  userRole,
  today,
  priorityGrid = {},
}: {
  dateStr: string;
  startHour: number;
  startMin: number;
  durationMins?: number;
  roomType?: RoomType;
  teacherId: string;
  userRole: UserRole;
  /** 今天 'YYYY-MM-DD' */
  today: string;
  priorityGrid?: PriorityGrid;
}): TimeConstraintResult => {
  // 1. 一般老師最多預約未來 90 天
  if (userRole !== 'admin' && diffDays(dateStr, today) > 90) {
    return {
      allowed: false,
      requiresReview: false,
      code: 'too_far',
      reason: '一般老師最多只能預約未來 3 個月（90 天）內的時段',
    };
  }

  // 2. 優先時段：以完整區間逐格比對。距上課 >= 14 天，其他一般老師可預約但需送審；
  //    14 天內直接生效，回傳 priorityOwnerId 供呼叫端通知該老師。
  const priorityOwnerId = findOtherPriorityOwner({
    dateStr, startHour, startMin, durationMins, roomType, teacherId, priorityGrid,
  });

  if (needsPriorityReview({ dateStr, today, userRole, priorityOwnerId })) {
    return {
      allowed: true,
      requiresReview: true,
      code: 'non_priority',
      reason: '此時段為其他老師的優先時段（14 天前預約），送出後需經管理員審核',
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
  /** 阻擋類別：room = 1v2 大教室無法讓位；time = 時間規則；conflict = 衝堂 */
  errorKind?: 'room' | 'time' | 'conflict';
  /** 已套用最終教室、狀態的預約（ok=true 時） */
  booking?: BookingItem;
  /** 需送審（非優先審核）：booking.status 已為 special_pending */
  requiresReview: boolean;
  /** 教室調度提示（導正教室 / 讓位） */
  notices: string[];
  /** 需同步從大教室移到小教室的既有 1v1 */
  autoSwaps: AutoSwapItem[];
  /** 他人優先時段提醒 */
  priorityOwnerId?: string;
  /** 開課時間已過（過去時段）：直接寫入課表，呼叫端僅作提醒 */
  isPastSlot: boolean;
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
  today,
  priorityGrid = {},
  bookings,
  teachers,
  students,
  studentOverride,
  excludeBookingId,
  mode = 'create',
  skipTimeConstraints = false,
  skipQuota = false,
}: {
  input: BookingRequestInput;
  userRole: UserRole;
  today: string;
  priorityGrid?: PriorityGrid;
  bookings: BookingItem[];
  teachers: Record<string, TeacherProfile>;
  students: StudentItem[];
  /** 尚未寫入名單的新學員（新生排課） */
  studentOverride?: Pick<StudentItem, 'id' | 'name' | 'credits'>;
  /** 改期時排除自己 */
  excludeBookingId?: string;
  /** reschedule：改期免審核；改至他人優先時段且 >= 14 天者直接阻擋；額度不變 */
  mode?: 'create' | 'reschedule';
  /** 僅改教室（時間未變）時略過時間限制 */
  skipTimeConstraints?: boolean;
  skipQuota?: boolean;
}): ValidateBookingResult => {
  const duration = input.durationMins || DEFAULT_DURATION_MINS;
  const blank: ValidateBookingResult = {
    ok: false,
    requiresReview: false,
    notices: [],
    autoSwaps: [],
    isPastSlot: false,
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
      today,
      priorityGrid,
    });
    if (!tc.allowed) return fail(tc.reason || '不符合預約時間規定', 'time');
    if (tc.requiresReview && mode === 'reschedule') {
      return fail('改期至他人優先時段（14 天前）需由管理員處理，請聯絡管理員或另行新增預約送審', 'time');
    }
    requiresReview = tc.requiresReview;
    priorityOwnerId = tc.priorityOwnerId;
  } else {
    // 僅改教室：不可藉由換教室繞過他人優先時段送審
    const original = bookings.find(b => b.id === excludeBookingId);
    const owner = original && original.roomType !== finalRoom
      ? findOtherPriorityOwner({
          dateStr: input.date, startHour: input.startHour, startMin: input.startMin,
          durationMins: duration, roomType: finalRoom, teacherId: input.teacherId, priorityGrid,
        })
      : undefined;
    if (needsPriorityReview({ dateStr: input.date, today, userRole, priorityOwnerId: owner })) {
      return fail('改至他人優先時段（14 天前）的教室需由管理員處理，請聯絡管理員或另行新增預約送審', 'time');
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
    signed: false,
  };

  return {
    ok: true,
    booking,
    requiresReview,
    notices,
    autoSwaps,
    priorityOwnerId,
    isPastSlot: hoursUntilLesson(input.date, input.startHour, input.startMin) <= 0,
    quota,
  };
};

/**
 * 加課替換：只能刪除「最遠一堂」自動預排，且該堂必須是「confirmed、未簽、isAuto === true」、尚未開課。
 * 手動預約與審核中課堂不可被靜默替換：
 * 若最遠一堂自動預排屬於審核中，不得改刪較近的課堂，直接回傳 undefined 交由呼叫端跳出提示。
 */
export const findReplaceableAutoBooking = (
  bookings: BookingItem[],
  student: { id: string; name: string },
  now: Date = new Date(),
): BookingItem | undefined => {
  const farthest = bookings
    .filter(
      b =>
        matchesStudent(student, b.studentId, b.studentName) &&
        b.isAuto === true &&
        occupiesQuota(b) &&
        !isOverdueUnsettled(b, now),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour * 60 + a.startMin - (b.startHour * 60 + b.startMin))
    .pop();
  return farthest && farthest.status === 'confirmed' ? farthest : undefined;
};

// ------------------------------------------
// 自動排課額度明細
// ------------------------------------------

export interface ScheduleQuota {
  /** 學生剩餘堂數（簽到當下已扣堂） */
  totalRemaining: number;
  /** 歷史簽到：僅供參考，不參與扣減 */
  signedCount: number;
  /** 逾期紀錄：已開課、未簽到且仍佔額度（isOverdueUnsettled） */
  overdueCount: number;
  /** 待審核預約：尚未開課的非優先審核課堂 */
  pendingCount: number;
  /** 已經預排：尚未開課的 confirmed */
  confirmedFutureCount: number;
  /** 剩餘可排 = max(0, 剩餘 - (逾期 + 待審 + 已預排)) */
  availableToSchedule: number;
  /** 重排總堂數 = max(0, 剩餘 - (逾期 + 待審)) */
  replaceTotal: number;
}

/**
 * 逾期 / 待審 / 已預排三者互斥，合計等於 occupiesQuota 的佔用堂數。
 */
export const getScheduleQuota = (
  bookings: BookingItem[],
  student: { id: string; name: string; credits: number },
  now: Date = new Date(),
): ScheduleQuota => {
  const own = bookings.filter(b => matchesStudent(student, b.studentId, b.studentName));
  const occupied = own.filter(occupiesQuota);
  const upcoming = occupied.filter(b => !isOverdueUnsettled(b, now));
  const overdueCount = occupied.length - upcoming.length;
  const pendingCount = upcoming.filter(isPendingApproval).length;
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
  now: Date = new Date(),
): SignatureWindowStatus => {
  const d = parseDate(b.date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), b.startHour, b.startMin).getTime();
  const end = start + (b.durationMins || DEFAULT_DURATION_MINS) * 60000;
  if (start - now.getTime() > 60 * 60000) return 'too_early';
  if (now.getTime() - end > 60 * 60000) return 'late_over_1h';
  return 'open';
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

/** 由 bookings 動態推導月份清單（新到舊），一定包含當月。 */
export const deriveMonthKeys = (bookings: Pick<BookingItem, 'date'>[], today: string): string[] => {
  const set = new Set<string>([monthKeyOf(today)]);
  bookings.forEach(b => b.date && set.add(monthKeyOf(b.date)));
  return Array.from(set).filter(Boolean).sort().reverse();
};

/** 一般老師月份統計區間：基準月往前 / 往後的月份數 */
const TEACHER_MONTHS_BACK = 4;
const TEACHER_MONTHS_AHEAD = 1;

/** 'YYYY-MM' 加減月份數（跨年自動進退位） */
const shiftMonthKey = (key: string, delta: number): string => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * 一般老師統計表的月份列（新到舊）：基準月 M（查詢月份 'YYYY-MM'）的 M-4 ～ M+1。
 * M 與 M+1 固定列出；M-4 ～ M-1 僅在該老師有任一堂數（含取消）時列出。
 */
export const deriveTeacherMonthKeys = (
  bookings: BookingItem[],
  baseMonth: string,
  teacherId: string,
): string[] => {
  const keys: string[] = [];
  for (let delta = TEACHER_MONTHS_AHEAD; delta >= -TEACHER_MONTHS_BACK; delta--) {
    const key = shiftMonthKey(baseMonth, delta);
    if (delta >= 0 || Object.values(getTeacherStats(bookings, key, teacherId)).some(n => n > 0)) keys.push(key);
  }
  return keys;
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
  /** 未結堂數：開課時間已過、尚未簽到也未取消（逾期待處理） */
  unsettled: number;
  /** 預排堂數：尚未開課且未簽到的預約（confirmed 與非優先審核中） */
  upcoming: number;
  /** 正常取消（開課 24 小時以前；不含送審預約被駁回） */
  normalCancel: number;
  /** 超時取消（開課前 24 小時內取消） */
  lateCancel: number;
}

/**
 * 老師月統計（全站唯一口徑）。teacherId 省略時統計整個 bookings 清單。
 * 已授課堂數一律以 isTaughtBooking 計算；未結一律以 isOverdueUnsettled 判定，其餘未簽有效課堂為預排。
 */
export const getTeacherStats = (
  bookings: BookingItem[],
  monthKey: string,
  teacherId?: string,
  now: Date = new Date(),
): TeacherMonthStats => {
  const list = bookings.filter(
    b => monthKeyOf(b.date) === monthKey && (!teacherId || b.teacherId === teacherId),
  );
  const count1v1 = list.filter(b => b.lessonType === '1v1' && isTaughtBooking(b)).length;
  const count1v2 = list.filter(b => b.lessonType === '1v2' && isTaughtBooking(b)).length;
  const cancelled = list.filter(b => b.status === 'cancelled_normal' && b.cancelReason !== 'non_priority_rejected');
  const lateCancel = cancelled.filter(b => b.isLateCancel).length;
  const open = list.filter(occupiesQuota);
  const unsettled = open.filter(b => isOverdueUnsettled(b, now)).length;
  return {
    count1v1,
    count1v2,
    total: count1v1 + count1v2,
    unsettled,
    upcoming: open.length - unsettled,
    normalCancel: cancelled.length - lateCancel,
    lateCancel,
  };
};

// ------------------------------------------
// 通知分級 / 操作時間
// ------------------------------------------

export type LogSeverity = 'gray' | 'yellow' | 'red';

/** 通知分級（相容舊資料：沒有 severity 時由 category 推斷，normal → gray） */
export const getLogSeverity = (l: Pick<AuditLogItem, 'category'> & { severity?: LogSeverity }): LogSeverity =>
  l.severity ?? (l.category === 'red' ? 'red' : l.category === 'yellow' ? 'yellow' : 'gray');

// 通知可見範圍與已讀狀態：已讀依「檢視者」各自記錄（read = 舊資料的全員已讀）
type ReadableLog = Pick<AuditLogItem, 'read' | 'readBy' | 'teacherId' | 'broadcast'>;

/** 管理員看全館；一般老師看自己的通知與全館廣播 */
export const isLogVisibleTo = (l: ReadableLog, userRole: UserRole, userId: string): boolean =>
  userRole === 'admin' || !!l.broadcast || l.teacherId === userId;

export const isLogReadBy = (l: ReadableLog, userId: string): boolean =>
  l.read || !!l.readBy?.includes(userId);

/** 切換單一檢視者的已讀狀態，不影響其他人 */
export const setLogReadBy = <T extends ReadableLog>(
  l: T,
  userId: string,
  read: boolean,
  allUserIds: string[],
): T => {
  if (read === isLogReadBy(l, userId)) return l;
  if (read) return { ...l, readBy: [...(l.readBy || []), userId] };
  const others = (l.read ? allUserIds : l.readBy || []).filter(id => id !== userId);
  return { ...l, read: false, readBy: others };
};

/** 管理員代一般老師異動的通知分級（不論距開課時數）：取消、改期為重要；改室為提醒 */
export const getAdminOverrideSeverity = (action: '取消' | '改期' | '改室'): 'red' | 'yellow' =>
  action === '改室' ? 'yellow' : 'red';

/** 全站唯一的操作時間格式：YYYY/MM/DD HH:mm */
export const formatTimestamp = (d: Date = new Date()): string =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 明細列表的簽到時間 MM/DD HH:mm；舊資料沒有簽到時間戳記時改用課堂日期時間 */
export const formatSignedTime = (
  b: Pick<BookingItem, 'date' | 'startHour' | 'startMin' | 'signedAt' | 'systemSignedAt'>,
): string => {
  const stamp = (b.signedAt || b.systemSignedAt || '').match(/(\d{2})\/(\d{2}) (\d{2}:\d{2})/);
  if (stamp) return `${stamp[1]}/${stamp[2]} ${stamp[3]}`;
  return `${b.date.slice(5).replace('-', '/')} ${timeLabel(b.startHour, b.startMin)}`;
};
