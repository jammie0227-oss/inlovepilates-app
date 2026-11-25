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
  status: 'confirmed' | 'cancelled_normal' | 'special_pending' | 'special_approved' | 'special_rejected';
  signed: boolean;
  signatureData?: string;
  signedAt?: string;
  teacherNote?: string;
  isSystemSigned?: boolean;
  systemSignedAt?: string;
  isSettlementLocked?: boolean;
  settlementType?: 'system_deducted' | 'unattended_no_credit_deducted';
  overdueReason?: string;
  /** 改期計罰次數（審核裁決計罰時 +1，撤銷時 -1） */
  penaltyCount?: number;
  isLateSigned?: boolean;
  isAuto?: boolean;
  type?: string;
  /** special_pending 的來源：after_hours = 非營業時間預約待審、non_priority = 他人優先時段申請待審（兩者皆卡位、佔額度）；late_change = 24H 內異動/取消待審（不卡位、不佔額度） */
  pendingKind?: 'after_hours' | 'non_priority' | 'late_change';
  /** 取消原因標記（after_hours_rejected / non_priority_rejected = 送審預約被駁回，不計入正常取消統計） */
  cancelReason?: string;
  /** 【僅執行期衍生，不寫入資料庫】改教室審核中：檢視上課堂佔用新教室 (to)，原教室 (from) 視同釋出 */
  roomChangePending?: { from: 'large' | 'small'; to: 'large' | 'small' };
  /** 【僅執行期衍生】改室審核期間原教室的「原時段已釋出」虛線提示（非真實預約：不佔教室、不佔額度、不可操作） */
  isReleasedGhost?: boolean;
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
  reviewType?: 'cancel' | 'reschedule' | 'after_hours' | 'settlement_undo' | 'room_change' | 'non_priority' | 'sign' | 'late_sign';
  /** 送審時間（YYYY/MM/DD HH:mm，建立審核單時精準記錄） */
  submittedAt?: string;
  reqDate?: string;
  reqHour?: number;
  reqMin?: number;
  reqRoom?: 'large' | 'small';
  reqLessonType?: '1v1' | '1v2';
  undoReason?: string;
  resolvedAt?: string;
  resolvedNote?: string;
  /** 系統自動結案（非管理員裁決）：不可撤銷 */
  autoClosed?: boolean;
  /** 同一堂課的逾時異動經過（時間順序，含本單事件）；併單或後續異動時寫入 */
  history?: string[];
  /** 批次審核（自動排課非營業時間）：本審核單涵蓋的所有課堂 ID，核准 / 駁回一次套用 */
  batchBookingIds?: string[];
  /** 批次審核前各課堂快照（供撤銷還原） */
  bookingSnapshots?: BookingItem[];
  /** 審核前課堂快照（供撤銷真正還原） */
  bookingSnapshot?: BookingItem;
  /** 審核後課堂狀態（供撤銷時偵測後續變動） */
  bookingAfter?: BookingItem;
  /** 審核時對學員堂數的異動量（撤銷時反向還原） */
  creditDelta?: number;
  creditStudentId?: string;
  /** 審核時連帶結案的其他審核單 ID（撤銷時一併還原為待審） */
  cascadedReviewIds?: string[];
  /** 結算更正核准時被作廢的原取消審核單（不佔用免費取消次數） */
  voided?: boolean;
  /** 作廢前的審核狀態（撤銷時還原） */
  voidedFrom?: 'pending' | 'approved' | 'rejected';
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
  read: boolean;
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
  /** 本次因非營業時間而以 special_pending（待審）排入的堂數（管理員為 0） */
  afterHoursCount?: number;
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

// 單日營業時間設定
export interface DayHoursConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

// 動態營業時間設定（Tab 5 管理員編輯）
export interface BusinessHoursConfig {
  weekday: DayHoursConfig;  // 週一至週五
  saturday: DayHoursConfig;
  sunday: DayHoursConfig;
}
