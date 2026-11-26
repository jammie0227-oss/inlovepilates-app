// ==========================================
// 共用型別定義 (Single Source of Truth)
// ==========================================

export interface TeacherProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;       // 支援可選 email
  color: string;
  bgLight: string;
  border?: string;      // 支援可選 border
  text: string;
  isActive: boolean;
  notes?: string;
  monthlyQuota?: number;
}
export interface PresetColor {
  id: string;
  name: string;
  label: string;
  color: string;
  bgLight: string;
  text: string;
  border: string;
}
export interface StudentRule {
  id: string;
  freq: '每週' | '隔週' | '不固定' | 'W' | 'EOW';
  day: '一' | '二' | '三' | '四' | '五' | '六' | '日';
  time: string;
  startDate: string;
  lessonType?: '1v1' | '1v2';
  roomType?: 'large' | 'small';
}

export interface PurchaseRecord {
  id: string;
  date: string;
  credits: number;
  price: number;
  teacherName: string;
  studentName: string;
  studentSign?: string;
  signedAt?: string;
}

export interface StudentItem {
  id: string;
  name: string;
  phone: string;
  teacherId: string;
  note?: string;
  credits: number;
  defaultLessonType?: '1v1' | '1v2';
  lessonType?: '1v1' | '1v2';
  isTrial?: boolean;
  noRegularRule?: boolean;
  rules: StudentRule[];
  status: 'active' | 'archived';
  nextLesson?: string;
  purchases?: PurchaseRecord[];
}

export interface BookingItem {
  id: string;
  date: string;
  startHour: number;
  startMin: number;
  durationMins: number;
  teacherId: string;
  studentName: string;
  studentId: string;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
  /** special_pending = 非優先審核中（他人優先時段、14 天前預約）：卡住時段、佔學員額度、可簽到不可變更 */
  status: 'confirmed' | 'cancelled_normal' | 'special_pending';
  signed: boolean;
  signatureData?: string;
  signedAt?: string;
  teacherNote?: string;
  isSystemSigned?: boolean;
  systemSignedAt?: string;
  settlementType?: 'system_deducted';
  overdueReason?: string;
  isLateSigned?: boolean;
  isAuto?: boolean;
  type?: string;
  /** 取消當下時間 YYYY/MM/DD HH:mm */
  cancelledAt?: string;
  /** 超時取消（開課前 24 小時內取消）：僅供紀錄與統計 */
  isLateCancel?: boolean;
  /** 取消原因標記（non_priority_rejected = 送審預約被駁回，不計入取消統計） */
  cancelReason?: string;
}

export interface ReviewItem {
  id: string;
  bookingId?: string;
  teacherId: string;
  teacherName: string;
  studentName?: string;
  date: string;
  time: string;
  room: string;
  lessonType?: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  phone?: string;
  /** 全站唯一的審核類型：他人優先時段（14 天前）預約 */
  reviewType: 'non_priority';
  resolvedNote?: string;
  /** 系統自動結案（非管理員裁決）：不可撤銷 */
  autoClosed?: boolean;
  /** 批次審核（自動排課）：本審核單涵蓋的所有課堂 ID，核准 / 駁回一次套用 */
  batchBookingIds?: string[];
  /** 批次審核前各課堂快照（供撤銷還原） */
  bookingSnapshots?: BookingItem[];
  /** 審核前課堂快照（供撤銷真正還原） */
  bookingSnapshot?: BookingItem;
  /** 審核後課堂狀態（供撤銷時偵測後續變動） */
  bookingAfter?: BookingItem;
}

export interface AuditLogItem {
  id: string;
  time: string;
  actor: string;
  teacherName?: string;
  studentName: string;
  action: string;
  detail?: string;
  summary?: string;
  typeStr: '簽到' | '預約' | '調度' | '改室' | '改期' | '取消' | '購課' | string;
  /** 舊欄位（相容保留）：normal 等同 gray；新資料請以 severity 為準 */
  category: 'red' | 'yellow' | 'normal';
  /** 通知分級：gray 一般紀錄（不計未讀紅點）/ yellow 提醒注意 / red 重要警示；舊資料缺漏時由 category 推斷 */
  severity?: 'gray' | 'yellow' | 'red';
  /** 舊資料的全員已讀旗標；個別檢視者的已讀記錄在 readBy */
  read: boolean;
  readBy?: string[];
  /** 全館廣播（規範更新）：所有老師可見，各自計算未讀 */
  broadcast?: boolean;
  teacherId?: string;
  reviewId?: string;
  remainingCredits?: number;
}

// 衝突檢測回傳結構 (支援角色隱私遮罩與換室建議)
export interface ConflictCheckResult {
  hasConflict: boolean;
  reason?: string;
  suggestAlternateRoom?: 'large' | 'small';
  alternateRoomReason?: string;
}

export interface ScheduleEngineResult {
  success: boolean;
  message: string;
  copyText: string;
  newRecords: BookingItem[];
  removedBookingIds: string[];
  skippedReasons: string[];
  /** 本次實際排入堂數 */
  scheduledCount?: number;
  /** 本次排完後仍未排入的堂數 */
  remainingUnscheduled?: number;
  /** 是否因場租老師 90 天預約上限而停止 */
  hitHorizonLimit?: boolean;
  /** 本次因他人優先時段而以 special_pending（待審）排入的堂數（管理員為 0） */
  nonPriorityCount?: number;
  suggestedRoomSwaps?: {
    date: string;
    time: string;
    targetRoom: 'large' | 'small';
    reason: string;
  }[];
}

// 優先時段：同一組「星期-小時」只能擇一指派（大教室 / 小教室 / 不限教室）
export interface PrioritySlot {
  large?: string;
  small?: string;
  /** 不限教室（依課程決定）：大、小教室皆為該老師優先 */
  all?: string;
}
/** key 格式：`${星期}-${小時}`，例如 '二-9' */
export type PriorityGrid = Record<string, PrioritySlot>;
