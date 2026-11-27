// ==========================================
// 共用型別定義 (Single Source of Truth)
// ==========================================

import type { AutoSwapItem } from './utils/bookingRules';

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
  /** 排課模式：true = 無固定時間（不啟用自動排課）；false / 缺漏 = 固定每週時段 */
  noRegularRule?: boolean;
  rules: StudentRule[];
  /** 取消時自動順延補排 1 堂（固定時段預設開、無固定時間預設關） */
  autoRescheduleOnCancel: boolean;
  status: 'active' | 'archived';
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
  /** 逾期結算：系統取消標記與操作時間 YYYY/MM/DD HH:mm */
  isSystemCancelled?: boolean;
  systemCancelledAt?: string;
  isLateSigned?: boolean;
  isAuto?: boolean;
  type?: string;
  /** 取消當下時間 YYYY/MM/DD HH:mm */
  cancelledAt?: string;
  /** 超時取消（開課前 24 小時內取消）：僅供紀錄與統計 */
  isLateCancel?: boolean;
  /** 取消原因標記（non_priority_rejected = 送審預約被駁回，不計入取消統計） */
  cancelReason?: string;
  /** 最近一次改期（日期或時間變動）紀錄；僅改教室不寫入。簽到 / 取消後仍保留 */
  rescheduledInfo?: RescheduledInfo;
}

export interface RescheduledInfo {
  /** 改期操作時間 YYYY/MM/DD HH:mm */
  updatedAt: string;
  /** 改期前的日期 YYYY-MM-DD */
  originalDate: string;
  /** 改期前的開始時間 HH:mm */
  originalStartTime: string;
  /** 改期前的教室（'large' | 'small'） */
  originalRoomId: string;
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

/** 逾期處理方式：系統代簽（扣 1 堂）/ 系統取消（不扣堂） */
export type SettlementAction = 'system_sign' | 'system_cancel';

/** 逾期處理紀錄：掛在系統代簽 / 系統取消通知上，供管理員撤銷（Undo） */
export interface SettlementRecord {
  action: SettlementAction;
  bookingId: string;
  studentId?: string;
  /** 操作時間，與課堂上的 systemSignedAt / systemCancelledAt 相同 */
  settledAt: string;
  /** 操作前課堂快照（撤銷時還原） */
  snapshot: BookingItem;
  /** 本次扣除的堂數（撤銷時回補） */
  creditsDeducted: number;
  /** 系統取消觸發的自動順延補排課堂（撤銷時移除） */
  postponedBookingId?: string;
  /** 對應的「系統預排」通知（撤銷時一併標記） */
  postponeLogId?: string;
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
  /** 通知標題（單堂課：老師名・學生名（教室色點 M/D HH:mm 類別））；教室色點以 [[large]] / [[small]] 表示 */
  title?: string;
  settlement?: SettlementRecord;
  /** 此通知對應的操作已被撤銷的時間 */
  revokedAt?: string;
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
  /** 為 1v2 讓位而需從大教室移至小教室的既有 1v1（套用排課結果時一併寫入並通知） */
  autoSwaps?: AutoSwapItem[];
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
