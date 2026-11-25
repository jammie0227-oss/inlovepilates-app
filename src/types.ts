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
  /** special_pending 的來源：after_hours = 非營業時間預約待審（仍佔額度）；late_change = 24H 內異動/取消待審（不佔額度） */
  pendingKind?: 'after_hours' | 'late_change';
  /** 取消原因標記（例：after_hours_rejected = 非營業時間預約被駁回，不計入正常取消統計） */
  cancelReason?: string;
  /** 【僅執行期衍生，不寫入資料庫】改教室審核中：原課堂保留在原教室，並同時卡住目標教室 */
  roomChangePending?: { from: 'large' | 'small'; to: 'large' | 'small' };
  /** 【僅執行期衍生】改室審核期間在目標教室產生的佔位（非真實預約，不佔額度、不可操作） */
  isHold?: boolean;
  /** 佔位所屬的原預約 ID */
  holdOf?: string;
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
  reviewType?: 'cancel' | 'reschedule' | 'after_hours' | 'settlement_undo' | 'room_change' | 'sign' | 'late_sign';
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
  suggestedRoomSwaps?: {
    date: string;
    time: string;
    targetRoom: 'large' | 'small';
    reason: string;
  }[];
}

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
