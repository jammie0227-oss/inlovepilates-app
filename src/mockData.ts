// ==========================================
// 1. 型別定義 (Types & Interfaces)
// ==========================================

export interface TeacherProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  color: string;
  bgLight: string;
  text: string;
  border?: string;
  isActive: boolean;
  notes?: string;
  monthlyQuota?: number;
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
  reviewType?: 'cancel' | 'reschedule' | 'room_change';
  reqDate?: string;
  reqHour?: number;
  reqMin?: number;
  reqRoom?: 'large' | 'small';
  reqLessonType?: '1v1' | '1v2';
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
  category: 'red' | 'yellow' | 'normal';
  read: boolean;
  teacherId?: string;
  reviewId?: string;
  remainingCredits?: number;
}

export interface ScheduleEngineResult {
  success: boolean;
  message: string;
  copyText: string;
  newRecords: BookingItem[];
  removedBookingIds: string[];
}

// ==========================================
// 2. 輔助函式 (Helper Functions)
// ==========================================

export const getExactTimestamp = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export const formatTimeStr = (hour: number, min: number) => {
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

export const getDayOfWeek = (dateStr: string): string => {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return ['日', '一', '二', '三', '四', '五', '六'][day];
};

export const formatDateWithDay = (dateStr: string): string => {
  if (!dateStr) return '';
  if (dateStr.includes('(') && dateStr.includes(')')) return dateStr;

  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    return `${m}/${d}(${getDayOfWeek(dateStr)})`;
  }
  return dateStr;
};

// 全域衝堂防呆檢測引擎
export const checkGlobalConflict = ({
  dateStr,
  startHour,
  startMin,
  durationMins = 50,
  roomType,
  teacherId,
  studentId,
  existingBookings,
  teachersMap,
  studentsMap,
  excludeBookingId
}: {
  dateStr: string;
  startHour: number;
  startMin: number;
  durationMins?: number;
  roomType: 'large' | 'small';
  teacherId: string;
  studentId?: string;
  existingBookings: BookingItem[];
  teachersMap: Record<string, TeacherProfile>;
  studentsMap: Record<string, StudentItem>;
  excludeBookingId?: string;
}): { hasConflict: boolean; reason?: string } => {
  const reqStart = startHour * 60 + startMin;
  const reqEnd = reqStart + durationMins;

  for (const b of existingBookings) {
    if (b.status === 'cancelled_normal') continue;
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (b.date !== dateStr) continue;

    const bStart = b.startHour * 60 + b.startMin;
    const bEnd = bStart + (b.durationMins || 50);

    const isOverlapping = !(reqEnd <= bStart || reqStart >= bEnd);
    if (!isOverlapping) continue;

    const tObj = teachersMap[b.teacherId];
    const sObj = b.studentId ? studentsMap[b.studentId] : null;
    const teacherLabel = tObj?.name || '其他老師';
    const studentLabel = sObj?.name || b.studentName || '學員';
    const roomLabel = b.roomType === 'large' ? '大教室' : '小教室';

    if (b.roomType === roomType) {
      return {
        hasConflict: true,
        reason: `${roomLabel}在該時段已有 ${teacherLabel} 老師排定課程 (${studentLabel})`
      };
    }

    if (b.teacherId === teacherId) {
      return {
        hasConflict: true,
        reason: `${teacherLabel} 老師在該時段已在${roomLabel}有排課 (${studentLabel})`
      };
    }

    if (studentId && b.studentId === studentId) {
      return {
        hasConflict: true,
        reason: `學員 ${studentLabel} 在該時段已在${roomLabel}預約了其他課堂`
      };
    }
  }

  return { hasConflict: false };
};

// ==========================================
// 3. 自動排課引擎 (Schedule Engine)
// ==========================================

export class ScheduleEngine {
  private bookings: BookingItem[];
  private teachersMap: Record<string, TeacherProfile>;
  private studentsMap: Record<string, StudentItem>;

  constructor(
    bookings: BookingItem[],
    teachersMap: Record<string, TeacherProfile>,
    studentsMap: Record<string, StudentItem>
  ) {
    this.bookings = [...bookings];
    this.teachersMap = teachersMap;
    this.studentsMap = studentsMap;
  }

  public generateSchedule({
    sid,
    sName,
    teacherId,
    credits,
    slots,
    startFromDate,
    maxWeeksLimit = 12
  }: {
    sid: string;
    sName: string;
    teacherId: string;
    credits: number;
    slots: StudentRule[];
    startFromDate: string;
    maxWeeksLimit?: number;
  }): ScheduleEngineResult {
    if (credits <= 0) {
      return {
        success: false,
        message: '剩餘堂數不足，無法預排',
        copyText: '',
        newRecords: [],
        removedBookingIds: []
      };
    }

    const validSlots = slots.filter(s => s.freq !== '不固定');
    if (validSlots.length === 0) {
      return {
        success: false,
        message: '學員為不固定排課，未設定固定時段規則',
        copyText: '',
        newRecords: [],
        removedBookingIds: []
      };
    }

    const removedBookingIds = this.bookings
      .filter(b => (b.studentId === sid || b.studentName === sName) && b.date >= startFromDate && !b.signed && b.status === 'confirmed')
      .map(b => b.id);

    const activeBookings = this.bookings.filter(b => !removedBookingIds.includes(b.id));
    const dayNameToNum: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const newRecords: BookingItem[] = [];
    const skippedReasons: string[] = [];

    let currentCursor = new Date(startFromDate);
    let remaining = credits;
    let weeksCount = 0;

    while (remaining > 0 && weeksCount < maxWeeksLimit) {
      weeksCount++;
      for (const slot of validSlots) {
        if (remaining <= 0) break;

        const targetDayNum = dayNameToNum[slot.day];
        const matchDate = new Date(currentCursor);
        const curDay = matchDate.getDay();
        const diff = (targetDayNum - curDay + 7) % 7;
        matchDate.setDate(matchDate.getDate() + diff);

        const dateStr = `${matchDate.getFullYear()}-${String(matchDate.getMonth() + 1).padStart(2, '0')}-${String(matchDate.getDate()).padStart(2, '0')}`;
        
        if (slot.startDate && dateStr < slot.startDate) continue;

        const [hStr, mStr] = slot.time.split(':');
        const h = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);
        const lType = slot.lessonType || '1v1';
        const rType = slot.roomType || (lType === '1v2' ? 'large' : 'small');

        const conflict = checkGlobalConflict({
          dateStr,
          startHour: h,
          startMin: m,
          durationMins: 50,
          roomType: rType,
          teacherId,
          studentId: sid,
          existingBookings: [...activeBookings, ...newRecords],
          teachersMap: this.teachersMap,
          studentsMap: this.studentsMap
        });

        if (!conflict.hasConflict) {
          const newBooking: BookingItem = {
            id: `b-auto-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            date: dateStr,
            startHour: h,
            startMin: m,
            durationMins: 50,
            teacherId,
            studentName: sName,
            studentId: sid,
            roomType: rType,
            lessonType: lType,
            status: 'confirmed',
            signed: false
          };
          newRecords.push(newBooking);
          remaining--;
        } else {
          skippedReasons.push(`${formatDateWithDay(dateStr)} ${slot.time} (${conflict.reason})`);
        }
      }
      currentCursor.setDate(currentCursor.getDate() + 7);
    }

    const copyList = newRecords.map(b => {
      const roomDot = b.roomType === 'large' ? '🟣' : '🟢';
      return `• ${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)} ${roomDot} (${b.lessonType})`;
    }).join('\n');

    const copyText = `【${sName} 預排課表】\n` + copyList + `\n共排定 ${newRecords.length} 堂課。`;

    return {
      success: true,
      message: `已順利預排 ${newRecords.length} 堂課${skippedReasons.length > 0 ? ` (自動避開 ${skippedReasons.length} 處衝堂)` : ''}`,
      copyText,
      newRecords,
      removedBookingIds
    };
  }
}

// ==========================================
// 4. 老師代表色常數 (Preset Colors)
// ==========================================

export const PRESET_COLORS = [
  { id: 'rose', name: '玫瑰粉', label: '玫瑰粉', color: 'bg-rose-500', bgLight: 'bg-rose-100', text: 'text-rose-900', border: 'border-rose-400' },
  { id: 'sky', name: '天藍', label: '天藍', color: 'bg-sky-500', bgLight: 'bg-sky-100', text: 'text-sky-900', border: 'border-sky-400' },
  { id: 'emerald', name: '翡翠綠', label: '翡翠綠', color: 'bg-emerald-500', bgLight: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-400' },
  { id: 'purple', name: '薰衣紫', label: '薰衣紫', color: 'bg-purple-500', bgLight: 'bg-purple-100', text: 'text-purple-900', border: 'border-purple-400' },
  { id: 'amber', name: '琥珀橘', label: '琥珀橘', color: 'bg-amber-500', bgLight: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-400' },
  { id: 'indigo', name: '青靛藍', label: '青靛藍', color: 'bg-indigo-500', bgLight: 'bg-indigo-100', text: 'text-indigo-900', border: 'border-indigo-400' },
  { id: 'teal', name: '松石綠', label: '松石綠', color: 'bg-teal-500', bgLight: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-400' },
  { id: 'pink', name: '胭脂粉', label: '胭脂粉', color: 'bg-pink-500', bgLight: 'bg-pink-100', text: 'text-pink-900', border: 'border-pink-400' },
  { id: 'cyan', name: '青空藍', label: '青空藍', color: 'bg-cyan-500', bgLight: 'bg-cyan-100', text: 'text-cyan-900', border: 'border-cyan-400' },
  { id: 'orange', name: '陽光橘', label: '陽光橘', color: 'bg-orange-500', bgLight: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-400' }
];

// ==========================================
// 5. 初始資料庫 (Initial Mock Data)
// ==========================================

export const INITIAL_TEACHERS: Record<string, TeacherProfile> = {
  't-daisy': {
    id: 't-daisy',
    name: 'Daisy',
    phone: '0912-000-001',
    color: 'bg-rose-500',
    bgLight: 'bg-rose-100',
    text: 'text-rose-900',
    isActive: true,
    monthlyQuota: 3
  },
  't-1': {
    id: 't-1',
    name: 'Abby',
    phone: '0912-345-678',
    color: 'bg-sky-500',
    bgLight: 'bg-sky-100',
    text: 'text-sky-900',
    isActive: true,
    monthlyQuota: 3
  },
  't-2': {
    id: 't-2',
    name: 'Tanya',
    phone: '0922-111-222',
    color: 'bg-emerald-500',
    bgLight: 'bg-emerald-100',
    text: 'text-emerald-900',
    isActive: true,
    monthlyQuota: 3
  },
  't-3': {
    id: 't-3',
    name: 'Cindy',
    phone: '0933-444-555',
    color: 'bg-purple-500',
    bgLight: 'bg-purple-100',
    text: 'text-purple-900',
    isActive: true,
    monthlyQuota: 3
  }
};

export const INITIAL_STUDENTS: StudentItem[] = [
  {
    id: 's-1',
    name: '王小美',
    phone: '0988-123-456',
    teacherId: 't-1',
    note: '核心無力、右肩偶有不適',
    credits: 5,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [
      { id: 'r-1', freq: '每週', day: '六', time: '09:00', startDate: '2026-10-24', lessonType: '1v1', roomType: 'small' }
    ],
    status: 'active',
    nextLesson: '10/24(六) 09:00',
    purchases: [
      {
        id: 'p-1',
        date: '2026-10-01',
        credits: 10,
        price: 22000,
        teacherName: 'Daisy',
        studentName: '王小美',
        signedAt: '2026/10/01 14:00:00'
      }
    ]
  },
  {
    id: 's-2',
    name: '李小花',
    phone: '0977-654-321',
    teacherId: 't-1',
    note: '懷孕中 (16週)，需溫和伸展',
    credits: 8,
    defaultLessonType: '1v2',
    lessonType: '1v2',
    isTrial: false,
    rules: [
      { id: 'r-2', freq: '每週', day: '六', time: '10:00', startDate: '2026-10-24', lessonType: '1v2', roomType: 'large' }
    ],
    status: 'active',
    nextLesson: '10/24(六) 10:00',
    purchases: []
  },
  {
    id: 's-3',
    name: '張庭瑋',
    phone: '0966-888-999',
    teacherId: 't-daisy',
    note: '脊椎側彎矯正',
    credits: 4,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [
      { id: 'r-3', freq: '每週', day: '一', time: '14:00', startDate: '2026-10-26', lessonType: '1v1', roomType: 'large' }
    ],
    status: 'active',
    nextLesson: '10/26(一) 14:00',
    purchases: []
  },
  {
    id: 's-4',
    name: '陳大文',
    phone: '0955-333-222',
    teacherId: 't-3',
    note: '增肌重訓輔助訓練',
    credits: 7,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [
      { id: 'r-4', freq: '每週', day: '三', time: '14:00', startDate: '2026-10-28', lessonType: '1v1', roomType: 'small' }
    ],
    status: 'active',
    nextLesson: '10/28(三) 14:00',
    purchases: []
  },
  {
    id: 's-5',
    name: '林小婷',
    phone: '0944-777-888',
    teacherId: 't-2',
    note: '足弓扁平改善',
    credits: 10,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [
      { id: 'r-5', freq: '每週', day: '日', time: '10:00', startDate: '2026-10-25', lessonType: '1v1', roomType: 'small' }
    ],
    status: 'active',
    nextLesson: '10/25(日) 10:00',
    purchases: []
  }
];

export const INITIAL_BOOKINGS: BookingItem[] = [
  {
    id: 'b-1',
    date: '2026-10-24',
    startHour: 9,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: true,
    signedAt: '2026/10/24 09:55:00'
  },
  {
    id: 'b-2',
    date: '2026-10-24',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '李小花',
    studentId: 's-2',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-3',
    date: '2026-10-26',
    startHour: 16,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'special_pending',
    signed: false
  },
  {
    id: 'b-4',
    date: '2026-10-28',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-3',
    studentName: '陳大文',
    studentId: 's-4',
    roomType: 'small',
    lessonType: '1v1',
    status: 'special_pending',
    signed: false
  },
  {
    id: 'b-5',
    date: '2026-10-25',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '林小婷',
    studentId: 's-5',
    roomType: 'small',
    lessonType: '1v1',
    status: 'special_pending',
    signed: false
  }
];

// 提供 3 筆待審核紀錄 (包含取消、改室、改期)，方便管理員全面測試
export const INITIAL_REVIEWS: ReviewItem[] = [
  {
    id: 'rev-sample-1',
    bookingId: 'b-3',
    teacherId: 't-1',
    teacherName: 'Abby',
    studentName: '王小美',
    date: '2026-10-26',
    time: '10/26(一) 16:00',
    room: '小教室',
    lessonType: '1v1',
    reason: '學員發燒急診，檢附收據申請免罰取消',
    status: 'pending',
    reviewType: 'cancel'
  },
  {
    id: 'rev-sample-2',
    bookingId: 'b-4',
    teacherId: 't-3',
    teacherName: 'Cindy',
    studentName: '陳大文',
    date: '2026-10-28',
    time: '10/28(三) 14:00',
    room: '小教室',
    lessonType: '1v1',
    reason: '雙人動作器械伸展需求，申請改至大教室',
    status: 'pending',
    reviewType: 'room_change',
    reqRoom: 'large',
    reqLessonType: '1v1'
  },
  {
    id: 'rev-sample-3',
    bookingId: 'b-5',
    teacherId: 't-2',
    teacherName: 'Tanya',
    studentName: '林小婷',
    date: '2026-10-25',
    time: '10/25(日) 10:00',
    room: '小教室',
    lessonType: '1v1',
    reason: '學員週日臨時加班，欲申請改期至下週二下午',
    status: 'pending',
    reviewType: 'reschedule',
    reqDate: '2026-10-27',
    reqHour: 14,
    reqMin: 0,
    reqRoom: 'small',
    reqLessonType: '1v1'
  }
];

// 豐富完整的全館復盤級日誌 (涵蓋簽到、取消、改室、改期、調度、購課、預約)
export const INITIAL_LOGS: AuditLogItem[] = [
  {
    id: 'l-101',
    time: '10/25 15:12',
    actor: 'Daisy',
    teacherName: 'Cindy',
    studentName: '陳大文',
    action: "原課堂：10/28(三) 14:00 🟢\n改至：🟣\n結果：核准",
    detail: "原課堂：10/28(三) 14:00 🟢\n改至：🟣\n結果：核准",
    typeStr: '改室',
    category: 'normal',
    read: true,
    teacherId: 't-3',
    reviewId: 'rev-sample-2'
  },
  {
    id: 'l-102',
    time: '10/25 14:40',
    actor: 'Daisy',
    teacherName: 'Tanya',
    studentName: '林小婷',
    action: "原課堂：10/25(日) 10:00 🟢\n改至：10/27(二) 14:00 🟢\n結果：免罰改期",
    detail: "原課堂：10/25(日) 10:00 🟢\n改至：10/27(二) 14:00 🟢\n結果：免罰改期",
    typeStr: '改期',
    category: 'red',
    read: false,
    teacherId: 't-2',
    reviewId: 'rev-sample-3'
  },
  {
    id: 'l-103',
    time: '10/24 10:30',
    actor: '系統排程',
    teacherName: '系統排程',
    studentName: '',
    action: "時間：10/24(六) 10:00\n原本：🟣 Daisy 王小美 (1v1) 與 🟢 Abby 李小花 (1v2)\n改為：🟢 Daisy 王小美 (1v1) 與 🟣 Abby 李小花 (1v2)",
    detail: "時間：10/24(六) 10:00\n原本：🟣 Daisy 王小美 (1v1) 與 🟢 Abby 李小花 (1v2)\n改為：🟢 Daisy 王小美 (1v1) 與 🟣 Abby 李小花 (1v2)",
    typeStr: '調度',
    category: 'yellow',
    read: false,
    teacherId: 't-1'
  },
  {
    id: 'l-104',
    time: '10/24 09:55',
    actor: 'Abby',
    teacherName: 'Abby',
    studentName: '王小美',
    action: '10/24(六) 09:00  -1堂  餘 5 堂',
    detail: '10/24(六) 09:00  -1堂  餘 5 堂',
    typeStr: '簽到',
    category: 'normal',
    read: true,
    teacherId: 't-1'
  },
  {
    id: 'l-105',
    time: '10/24 09:10',
    actor: 'Daisy',
    teacherName: 'Daisy',
    studentName: '張庭瑋',
    action: '10/26(一) 14:00 🟣 (1v1)',
    detail: '10/26(一) 14:00 🟣 (1v1)',
    typeStr: '預約',
    category: 'normal',
    read: true,
    teacherId: 't-daisy'
  },
  {
    id: 'l-106',
    time: '10/23 16:30',
    actor: 'Daisy',
    teacherName: 'Daisy',
    studentName: '林小婷',
    action: '購買 10 堂 (NT$ 22,000) 餘 10 堂',
    detail: '購買 10 堂 (NT$ 22,000) 餘 10 堂',
    typeStr: '購課',
    category: 'normal',
    read: true,
    teacherId: 't-2'
  },
  {
    id: 'l-107',
    time: '10/23 15:00',
    actor: 'Daisy',
    teacherName: 'Abby',
    studentName: '王小美',
    action: '10/23(五) 15:00 免罰取消',
    detail: '10/23(五) 15:00 免罰取消',
    typeStr: '取消',
    category: 'red',
    read: true,
    teacherId: 't-1',
    reviewId: 'rev-sample-1'
  },
  {
    id: 'l-108',
    time: '10/22 18:20',
    actor: 'Daisy',
    teacherName: 'Abby',
    studentName: '李小花',
    action: '10/22(四) 18:00 計罰取消',
    detail: '10/22(四) 18:00 計罰取消',
    typeStr: '取消',
    category: 'red',
    read: true,
    teacherId: 't-1'
  }
];