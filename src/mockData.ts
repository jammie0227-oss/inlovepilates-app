// ==========================================
// 1. 型別定義 (Types & Interfaces)
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
  suggestedRoomSwaps?: {
    date: string;
    time: string;
    targetRoom: 'large' | 'small';
    reason: string;
  }[];
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

// 智慧日期格式化：同一年只顯示 M/D(週)，若跨年（例如到 2027 年）才顯示年份
export const formatDateWithDay = (dateStr: string, baseYear: number = 2026): string => {
  if (!dateStr) return '';
  if (dateStr.includes('(') && dateStr.includes(')')) return dateStr;

  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    const day = getDayOfWeek(dateStr);
    
    // 若為跨年份的課堂（非當前系統年份），才顯式帶出年份，例如 2027/1/5(二)
    if (y && y !== baseYear) {
      return `${y}/${m}/${d}(${day})`;
    }
    return `${m}/${d}(${day})`;
  }
  return dateStr;
};

// 安全解析本地日期（防止跨時區日期偏差）
export const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const formatLocalDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 判定是否為已取消釋出的課堂（一般取消、免罰取消、計罰取消皆已釋出空間）
export const isCancelledSlot = (status: string) => {
  return status === 'cancelled_normal' || status === 'special_approved' || status === 'special_rejected';
};

// 全域衝堂防呆檢測引擎（含角色權限隱私遮罩與換室建議）
export const checkGlobalConflict = ({
  dateStr,
  startHour,
  startMin,
  durationMins = 50,
  roomType,
  lessonType = '1v1',
  teacherId,
  studentId,
  studentName,
  userRole = 'teacher',
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
  lessonType?: '1v1' | '1v2';
  teacherId: string;
  studentId?: string;
  studentName?: string;
  userRole?: 'admin' | 'teacher';
  existingBookings: BookingItem[];
  teachersMap: Record<string, TeacherProfile>;
  studentsMap: Record<string, StudentItem>;
  excludeBookingId?: string;
}): ConflictCheckResult => {
  const reqStart = startHour * 60 + startMin;
  const reqEnd = reqStart + durationMins;

  // 1. 檢查同教室是否有預約佔用
  for (const b of existingBookings) {
    if (isCancelledSlot(b.status)) continue; // 已取消的課堂空間全空，不計入衝堂
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (b.date !== dateStr) continue;

    const bStart = b.startHour * 60 + b.startMin;
    const bEnd = bStart + (b.durationMins || 50);

    const isOverlapping = !(reqEnd <= bStart || reqStart >= bEnd);
    if (!isOverlapping) continue;

    const tObj = teachersMap[b.teacherId];
    const teacherLabel = tObj?.name || '老師';
    const studentLabel = b.studentName || '學員';
    const roomLabel = b.roomType === 'large' ? '大教室' : '小教室';
    const timeRangeStr = `${formatTimeStr(b.startHour, b.startMin)} ~ ${formatTimeStr(Math.floor(bEnd / 60), bEnd % 60)}`;

    // 教室空間衝突
    if (b.roomType === roomType) {
      // 檢查另一間教室是否為空（狀況 E 換室建議）
      const otherRoom: 'large' | 'small' = roomType === 'large' ? 'small' : 'large';
      const isOtherRoomFree = !existingBookings.some(ob => {
        if (isCancelledSlot(ob.status)) return false;
        if (excludeBookingId && ob.id === excludeBookingId) return false;
        if (ob.date !== dateStr || ob.roomType !== otherRoom) return false;
        const obStart = ob.startHour * 60 + ob.startMin;
        const obEnd = obStart + (ob.durationMins || 50);
        return !(reqEnd <= obStart || reqStart >= obEnd);
      });

      // 1v2 課程絕對不能排入小教室
      const canSuggestSwap = isOtherRoomFree && !(lessonType === '1v2' && otherRoom === 'small');

      // 依照身分提供遮罩訊息
      const reasonMsg = userRole === 'admin'
        ? `衝堂提醒：${roomLabel}（${timeRangeStr}）${teacherLabel} 老師 ${studentLabel} ${b.lessonType}`
        : b.teacherId === teacherId
          ? `衝堂提醒：您在該時段已有預約（${roomLabel} ${timeRangeStr} ${studentLabel} ${b.lessonType}）`
          : `衝堂提醒：${roomLabel}（${timeRangeStr}）${b.lessonType} 已有預約`;

      return {
        hasConflict: true,
        reason: reasonMsg,
        suggestAlternateRoom: canSuggestSwap ? otherRoom : undefined,
        alternateRoomReason: canSuggestSwap 
          ? `${dateStr} ${timeRangeStr} ${roomLabel}已有預約，${otherRoom === 'large' ? '大教室' : '小教室'}尚有空檔，是否改排？` 
          : undefined
      };
    }

    // 老師分身衝堂
    if (b.teacherId === teacherId) {
      return {
        hasConflict: true,
        reason: userRole === 'admin'
          ? `衝堂提醒：${teacherLabel} 老師在該時段已在${roomLabel}授課 (${studentLabel})`
          : `衝堂提醒：您在該時段已在${roomLabel}有排課`
      };
    }

    // 學員分身衝堂
    const isSameStudent = (studentId && b.studentId === studentId) || (studentName && b.studentName === studentName);
    if (isSameStudent) {
      return {
        hasConflict: true,
        reason: userRole === 'admin'
          ? `衝堂提醒：學員 ${studentLabel} 在該時段已在${roomLabel}預約了其他課堂`
          : `衝堂提醒：學員 ${studentLabel} 在該時段已有其他預約`
      };
    }
  }

  return { hasConflict: false };
};

// ==========================================
// 3. 自動排課引擎 (Schedule Engine)
// ==========================================

// ==========================================
// 3. 自動排課引擎 (Schedule Engine - 完整落實 A~E 規則)
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

  /**
   * 核心自動預排函式
   */
  public generateSchedule({
    sid,
    sName,
    teacherId,
    credits,
    slots,
    startFromDate,
    userRole = 'teacher',
    mode = 'replace_future', // 'append_remaining' (接續排課) 或 'replace_future' (重整未來)
    maxWeeksLimit = 16
  }: {
    sid: string;
    sName: string;
    teacherId: string;
    credits: number;
    slots: StudentRule[];
    startFromDate: string;
    userRole?: 'admin' | 'teacher';
    mode?: 'append_remaining' | 'replace_future';
    maxWeeksLimit?: number;
  }): ScheduleEngineResult {
    // 1. 底線防護：嚴禁預排過去日期（基準日若小於今天，強制校正為今天）
    const todayStr = '2026-10-24'; // 系統當前基準日
    const effectiveStartDate = startFromDate < todayStr ? todayStr : startFromDate;

    if (credits <= 0) {
      return {
        success: false,
        message: '剩餘堂數不足，無法預排',
        copyText: '',
        newRecords: [],
        removedBookingIds: [],
        skippedReasons: []
      };
    }

    const validSlots = slots.filter(s => s.freq !== '不固定');
    if (validSlots.length === 0) {
      return {
        success: false,
        message: '學員為不固定排課，未設定固定時段規則',
        copyText: '',
        newRecords: [],
        removedBookingIds: [],
        skippedReasons: []
      };
    }

    // 2. 嚴格不可篡改保護區 (防洗單鐵律)：
    // 只有「>= effectiveStartDate、未簽到、且狀態為純 confirmed」的未來預約才允許被清除重排！
    // 任何歷史紀錄、簽到扣堂、已取消（計罰/免罰）、審核中的課堂，絕對不可刪除！
    const safeFutureBookings = this.bookings.filter(b => 
      (b.studentId === sid || b.studentName === sName) &&
      b.date >= effectiveStartDate &&
      !b.signed &&
      b.status === 'confirmed'
    );

    let removedBookingIds: string[] = [];
    let preservedFutureCount = 0;

    if (mode === 'replace_future') {
      // 重整未來：釋出未來的純預約
      removedBookingIds = safeFutureBookings.map(b => b.id);
    } else {
      // 接續排課：保留未來的純預約
      preservedFutureCount = safeFutureBookings.length;
    }

    // 計算本次實際能新增預排的堂數上限（總堂數永不溢出）
    let remainingToSchedule = credits - preservedFutureCount;
    if (remainingToSchedule <= 0) {
      return {
        success: false,
        message: `既有排課已佔用 ${preservedFutureCount} 堂，已達可用堂數上限 (${credits} 堂)，無需再預排`,
        copyText: '',
        newRecords: [],
        removedBookingIds: [],
        skippedReasons: []
      };
    }

    // 排除被移除的預約後的活躍課表
    const activeBookings = this.bookings.filter(b => !removedBookingIds.includes(b.id));
    const dayNameToNum: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const newRecords: BookingItem[] = [];
    const skippedReasons: string[] = [];
    const suggestedRoomSwaps: any[] = [];

    let currentCursor = parseLocalDate(effectiveStartDate);
    let weeksCount = 0;

    while (remainingToSchedule > 0 && weeksCount < maxWeeksLimit) {
      weeksCount++;
      for (const slot of validSlots) {
        if (remainingToSchedule <= 0) break;

        const targetDayNum = dayNameToNum[slot.day];
        const matchDate = new Date(currentCursor);
        const curDay = matchDate.getDay();
        const diff = (targetDayNum - curDay + 7) % 7;
        matchDate.setDate(matchDate.getDate() + diff);

        const dateStr = formatLocalDate(matchDate);
        if (dateStr < effectiveStartDate) continue;
        if (slot.startDate && dateStr < slot.startDate) continue;

        // 3. 隔週（EOW）精準判算：以 slot.startDate 為基準，隔 14 天排一次
        const isEOW = slot.freq === '隔週' || slot.freq === 'EOW';
        if (isEOW) {
          const baseDate = slot.startDate ? parseLocalDate(slot.startDate) : parseLocalDate(effectiveStartDate);
          const diffDays = Math.round((matchDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));
          const diffWeeks = Math.floor(diffDays / 7);
          if (diffWeeks < 0 || diffWeeks % 2 !== 0) {
            continue; // 奇數週自動跳過
          }
        }

        const [hStr, mStr] = slot.time.split(':');
        const h = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);
        const lType = slot.lessonType || '1v1';
        let rType = slot.roomType || (lType === '1v2' ? 'large' : 'small');

        // 4. 狀況 E 檢驗：被取消的時段已完全釋出，可正常預排
        const conflict = checkGlobalConflict({
          dateStr,
          startHour: h,
          startMin: m,
          durationMins: 50,
          roomType: rType,
          lessonType: lType,
          teacherId,
          studentId: sid,
          studentName: sName,
          userRole,
          existingBookings: [...activeBookings, ...newRecords],
          teachersMap: this.teachersMap,
          studentsMap: this.studentsMap
        });

        if (!conflict.hasConflict) {
          newRecords.push({
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
          });
          remainingToSchedule--;
        } else {
          // 若衝堂但另一間教室有空（且符合 1v1 換室條件）
          if (conflict.suggestAlternateRoom && lType === '1v1') {
            suggestedRoomSwaps.push({
              date: dateStr,
              time: slot.time,
              targetRoom: conflict.suggestAlternateRoom,
              reason: conflict.alternateRoomReason || ''
            });
          }
          skippedReasons.push(`${formatDateWithDay(dateStr)} ${slot.time} (${conflict.reason})`);
        }
      }
      currentCursor.setDate(currentCursor.getDate() + 7);
    }

    // 5. 時序嚴格升序排序（由早到晚）
    newRecords.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin);
    });

    const copyList = newRecords.map(b => {
      const roomDot = b.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
      return `${roomDot} ${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)} (${b.lessonType})`;
    }).join('\n');

    const copyText = `【${sName} 預排課表】\n` + copyList + `\n共排定 ${newRecords.length} 堂課。`;

    return {
      success: true,
      message: `已順利預排 ${newRecords.length} 堂課${skippedReasons.length > 0 ? ` (自動避開 ${skippedReasons.length} 處衝堂)` : ''}`,
      copyText,
      newRecords,
      removedBookingIds,
      skippedReasons,
      suggestedRoomSwaps
    };
  }

  /**
   * 狀況 C：已排滿時手動新增一堂，自動刪除時間最後的一堂純預約
   */
  public handleDropLastBookingOnManualAdd(sid: string, currentBookings: BookingItem[]): { updatedBookings: BookingItem[]; droppedBooking: BookingItem | null } {
    const futureConfirmed = currentBookings
      .filter(b => b.studentId === sid && !b.signed && b.status === 'confirmed')
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin);
      });

    if (futureConfirmed.length === 0) {
      return { updatedBookings: currentBookings, droppedBooking: null };
    }

    const lastBooking = futureConfirmed[futureConfirmed.length - 1];
    const updated = currentBookings.filter(b => b.id !== lastBooking.id);
    return { updatedBookings: updated, droppedBooking: lastBooking };
  }

  /**
   * 狀況 D：學員取消預排，自動順延補排一堂（附帶 3 個月 90 天限制）
   */
  public handleAutoPostponeCancelledBooking({
    sid,
    sName,
    teacherId,
    cancelledDate,
    slots,
    currentBookings
  }: {
    sid: string;
    sName: string;
    teacherId: string;
    cancelledDate: string;
    slots: StudentRule[];
    currentBookings: BookingItem[];
  }): { postponedBooking: BookingItem | null; alertMsg?: string } {
    const baseDate = parseLocalDate(cancelledDate);
    const limitDate = new Date(baseDate);
    limitDate.setDate(limitDate.getDate() + 90); // 3 個月 (90天) 上限

    // 尋找未來的最後一堂預排日作為推算起點
    const futureConfirmed = currentBookings
      .filter(b => b.studentId === sid && !b.signed && b.status === 'confirmed')
      .sort((a, b) => b.date.localeCompare(a.date));

    const searchStartDate = futureConfirmed.length > 0 
      ? parseLocalDate(futureConfirmed[0].date) 
      : parseLocalDate(cancelledDate);
    searchStartDate.setDate(searchStartDate.getDate() + 1);

    const validSlot = slots.find(s => s.freq !== '不固定');
    if (!validSlot) return { postponedBooking: null };

    const dayNameToNum: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    let cursor = new Date(searchStartDate);

    while (cursor <= limitDate) {
      const curDay = cursor.getDay();
      const targetDay = dayNameToNum[validSlot.day];
      if (curDay === targetDay) {
        const dateStr = formatLocalDate(cursor);
        const [h, m] = validSlot.time.split(':').map(Number);
        const lType = validSlot.lessonType || '1v1';
        const rType = validSlot.roomType || (lType === '1v2' ? 'large' : 'small');

        const conflict = checkGlobalConflict({
          dateStr,
          startHour: h,
          startMin: m,
          durationMins: 50,
          roomType: rType,
          lessonType: lType,
          teacherId,
          studentId: sid,
          existingBookings: currentBookings,
          teachersMap: this.teachersMap,
          studentsMap: this.studentsMap
        });

        if (!conflict.hasConflict) {
          return {
            postponedBooking: {
              id: `b-auto-postpone-${Date.now()}`,
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
            }
          };
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      postponedBooking: null,
      alertMsg: `已取消課堂，因延後排程已超過 3 個月（90天）有效預排期限，系統未自動補排，請手動安排！`
    };
  }
}

// ==========================================
// 4. 老師代表色常數 (Preset Colors)
// ==========================================
// 高對比彩虹色票庫（含粉紅、咖啡色，嚴格避開警示紅與管理者黃）
export const PRESET_COLORS: PresetColor[] = [
  // 1. 深粉紅（優雅玫瑰深粉，避開正紅警示）
  { id: 'deep-pink', name: '深粉紅', label: '深粉紅', color: 'bg-pink-600',   bgLight: 'bg-pink-100',   text: 'text-pink-950',   border: 'border-pink-400' },
  // 2. 黃綠色（鮮活萊姆嫩黃綠，清爽明亮）
  { id: 'lime',      name: '黃綠色', label: '黃綠色', color: 'bg-lime-500',   bgLight: 'bg-lime-100',   text: 'text-lime-950',   border: 'border-lime-400' },
  // 3. 翡翠綠（Tanya 經典深翠綠）
  { id: 'emerald',   name: '翡翠綠', label: '翡翠綠', color: 'bg-emerald-500', bgLight: 'bg-emerald-100', text: 'text-emerald-950', border: 'border-emerald-400' },
  // 4. 晴空藍（Abby 經典活力天藍）
  { id: 'sky',       name: '晴空藍', label: '晴空藍', color: 'bg-sky-500',     bgLight: 'bg-sky-100',     text: 'text-sky-950',     border: 'border-sky-400' },
  // 5. 薰衣紫（Cindy 經典純淨薰衣草紫）
  { id: 'purple',    name: '薰衣紫', label: '薰衣紫', color: 'bg-purple-500',  bgLight: 'bg-purple-100',  text: 'text-purple-950',  border: 'border-purple-400' },
  // 6. 深藍色（沉穩大氣的皇家深海藍）
  { id: 'dark-blue', name: '深藍色', label: '深藍色', color: 'bg-blue-700',   bgLight: 'bg-blue-100',    text: 'text-blue-950',    border: 'border-blue-500' },
  // 7. 咖啡色（深焙咖啡深棕，底色採用溫潤淺石色）
  { id: 'coffee',    name: '咖啡色', label: '咖啡色', color: 'bg-amber-900',  bgLight: 'bg-stone-200',   text: 'text-amber-950',   border: 'border-amber-700' },
];
// ==========================================
// 5. 初始資料庫 (Initial Mock Data)
// ==========================================

// ==========================================
// 5. 初始資料庫 (Initial Mock Data - Updated to 10/30)
// ==========================================

export const INITIAL_TEACHERS: Record<string, TeacherProfile> = {
  't-daisy': {
    id: 't-daisy',
    name: 'Daisy',
    phone: '0912-000-001',
    color: 'bg-amber-500',
    bgLight: 'bg-amber-100',
    border: 'border-amber-400',
    text: 'text-amber-900',
    isActive: true,
    monthlyQuota: 3
  },
  't-1': {
    id: 't-1',
    name: 'Abby',
    phone: '0912-345-678',
    color: 'bg-sky-500',
    bgLight: 'bg-sky-100',
    border: 'border-sky-400',
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
    border: 'border-emerald-400',
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
    border: 'border-purple-400',
    text: 'text-purple-900',
    isActive: true,
    monthlyQuota: 3
  }
};

export const INITIAL_STUDENTS: StudentItem[] = [
  // --- Daisy 學員 ---
  {
    id: 's-d-1',
    name: '黃柏翔',
    phone: '0922-333-444',
    teacherId: 't-daisy',
    note: '五十肩復健、高血壓',
    credits: 12,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [{ id: 'r-d-1', freq: '每週', day: '二', time: '10:00', startDate: '2026-10-27', lessonType: '1v1', roomType: 'small' }],
    status: 'active',
    nextLesson: '11/03(二) 10:00',
    purchases: []
  },
  {
    id: 's-d-2',
    name: '趙思宇',
    phone: '0911-222-333',
    teacherId: 't-daisy',
    note: '雙人器械課程',
    credits: 6,
    defaultLessonType: '1v2',
    lessonType: '1v2',
    isTrial: false,
    rules: [{ id: 'r-d-2', freq: '隔週', day: '五', time: '18:00', startDate: '2026-10-30', lessonType: '1v2', roomType: 'large' }],
    status: 'active',
    nextLesson: '10/30(五) 18:00',
    purchases: []
  },
  {
    id: 's-d-3',
    name: '吳佳玲',
    phone: '0988-777-666',
    teacherId: 't-daisy',
    note: '產後骨盆修復',
    credits: 20,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [{ id: 'r-d-3', freq: '每週', day: '三', time: '15:00', startDate: '2026-11-04', lessonType: '1v1', roomType: 'large' }],
    status: 'active',
    nextLesson: '11/04(三) 15:00',
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
    rules: [{ id: 'r-3', freq: '每週', day: '一', time: '14:00', startDate: '2026-11-02', lessonType: '1v1', roomType: 'large' }],
    status: 'active',
    nextLesson: '11/02(一) 14:00',
    purchases: []
  },

  // --- Abby (t-1) 學員 ---
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
    rules: [{ id: 'r-1', freq: '每週', day: '六', time: '09:00', startDate: '2026-10-31', lessonType: '1v1', roomType: 'small' }],
    status: 'active',
    nextLesson: '10/31(六) 09:00',
    purchases: [
      { id: 'p-1', date: '2026-10-01', credits: 10, price: 22000, teacherName: 'Abby', studentName: '王小美', signedAt: '2026/10/01 14:00:00' }
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
    rules: [{ id: 'r-2', freq: '每週', day: '六', time: '10:00', startDate: '2026-10-31', lessonType: '1v2', roomType: 'large' }],
    status: 'active',
    nextLesson: '10/31(六) 10:00',
    purchases: []
  },
  {
    id: 's-a-3',
    name: '許家豪',
    phone: '0932-111-999',
    teacherId: 't-1',
    note: '運動員肌力加強',
    credits: 6,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [{ id: 'r-a-3', freq: '每週', day: '四', time: '15:00', startDate: '2026-10-29', lessonType: '1v1', roomType: 'small' }],
    status: 'active',
    nextLesson: '11/05(四) 15:00',
    purchases: []
  },

  // --- Tanya (t-2) 學員 ---
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
    rules: [{ id: 'r-5', freq: '每週', day: '日', time: '10:00', startDate: '2026-11-01', lessonType: '1v1', roomType: 'small' }],
    status: 'active',
    nextLesson: '11/01(日) 10:00',
    purchases: []
  },
  {
    id: 's-t-2',
    name: '郭冠廷',
    phone: '0919-888-777',
    teacherId: 't-2',
    note: '腰椎術後復健',
    credits: 7,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [{ id: 'r-t-2', freq: '每週', day: '三', time: '11:00', startDate: '2026-10-28', lessonType: '1v1', roomType: 'large' }],
    status: 'active',
    nextLesson: '11/04(三) 11:00',
    purchases: []
  },

  // --- Cindy (t-3) 學員 ---
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
    rules: [{ id: 'r-4', freq: '每週', day: '三', time: '14:00', startDate: '2026-11-04', lessonType: '1v1', roomType: 'small' }],
    status: 'active',
    nextLesson: '11/04(三) 14:00',
    purchases: []
  },
  {
    id: 's-c-2',
    name: '周雅涵',
    phone: '0928-666-555',
    teacherId: 't-3',
    note: '體態雕塑與骨盆前傾',
    credits: 9,
    defaultLessonType: '1v2',
    lessonType: '1v2',
    isTrial: false,
    rules: [{ id: 'r-c-2', freq: '每週', day: '二', time: '19:00', startDate: '2026-10-27', lessonType: '1v2', roomType: 'large' }],
    status: 'active',
    nextLesson: '11/03(二) 19:00',
    purchases: []
  }
];

export const INITIAL_BOOKINGS: BookingItem[] = [
  // ==========================================
  // 1. 逾期未簽到測試區 (10/26 ~ 10/29)
  // ==========================================
  // 【Daisy 逾期未簽】
  {
    id: 'b-overdue-daisy-1',
    date: '2026-10-28',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '黃柏翔',
    studentId: 's-d-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },
  {
    id: 'b-overdue-daisy-2',
    date: '2026-10-29',
    startHour: 16,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '張庭瑋',
    studentId: 's-3',
    roomType: 'large',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },

  // 【Abby 逾期未簽】
  {
    id: 'b-overdue-abby-1',
    date: '2026-10-26',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },
  {
    id: 'b-overdue-abby-2',
    date: '2026-10-29',
    startHour: 15,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '許家豪',
    studentId: 's-a-3',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },

  // 【Tanya 逾期未簽】
  {
    id: 'b-overdue-tanya-1',
    date: '2026-10-27',
    startHour: 11,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '郭冠廷',
    studentId: 's-t-2',
    roomType: 'large',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },
  {
    id: 'b-overdue-tanya-2',
    date: '2026-10-28',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '林小婷',
    studentId: 's-5',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },

  // 【Cindy 逾期未簽】
  {
    id: 'b-overdue-cindy-1',
    date: '2026-10-27',
    startHour: 19,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-3',
    studentName: '周雅涵',
    studentId: 's-c-2',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },
  {
    id: 'b-overdue-cindy-2',
    date: '2026-10-29',
    startHour: 11,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-3',
    studentName: '陳大文',
    studentId: 's-4',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false // ⚠️ 逾期未簽
  },

  // ==========================================
  // 2. 過去已正常簽到課堂 (底線粗細驗證)
  // ==========================================
  {
    id: 'b-signed-past-1',
    date: '2026-10-27',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '黃柏翔',
    studentId: 's-d-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: true,
    signedAt: '2026/10/27 14:55:00'
  },
  {
    id: 'b-signed-past-2',
    date: '2026-10-28',
    startHour: 9,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '李小花',
    studentId: 's-2',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: true,
    signedAt: '2026/10/28 09:50:00'
  },

  // ==========================================
  // 3. 今日課堂 (10/30 週五)
  // ==========================================
  {
    id: 'b-today-abby',
    date: '2026-10-30',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-today-tanya',
    date: '2026-10-30',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '林小婷',
    studentId: 's-5',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-today-cindy',
    date: '2026-10-30',
    startHour: 16,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-3',
    studentName: '陳大文',
    studentId: 's-4',
    roomType: 'large',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-today-daisy',
    date: '2026-10-30',
    startHour: 18,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '趙思宇',
    studentId: 's-d-2',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: false
  },

  // ==========================================
  // 4. 未來預約課堂 (10/31 ~ 11/04)
  // ==========================================
  {
    id: 'b-future-1',
    date: '2026-10-31',
    startHour: 9,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-future-2',
    date: '2026-10-31',
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
    id: 'b-future-3',
    date: '2026-11-01',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '林小婷',
    studentId: 's-5',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-future-4',
    date: '2026-11-02',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '張庭瑋',
    studentId: 's-3',
    roomType: 'large',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-future-5',
    date: '2026-11-02',
    startHour: 16,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'special_pending', // 審核中
    signed: false
  },
  {
    id: 'b-future-6',
    date: '2026-11-03',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '黃柏翔',
    studentId: 's-d-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-future-7',
    date: '2026-11-03',
    startHour: 19,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-3',
    studentName: '周雅涵',
    studentId: 's-c-2',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-future-8',
    date: '2026-11-04',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-3',
    studentName: '陳大文',
    studentId: 's-4',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-future-9',
    date: '2026-11-04',
    startHour: 15,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-daisy',
    studentName: '吳佳玲',
    studentId: 's-d-3',
    roomType: 'large',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  }
];

export const INITIAL_REVIEWS: ReviewItem[] = [
  {
    id: 'rev-sample-1',
    bookingId: 'b-3',
    teacherId: 't-1',
    teacherName: 'Abby',
    studentName: '王小美',
    date: '2026-11-02',
    time: '11/02(一) 16:00',
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
    date: '2026-11-04',
    time: '11/04(三) 14:00',
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
    date: '2026-11-01',
    time: '11/01(日) 10:00',
    room: '小教室',
    lessonType: '1v1',
    reason: '學員週日臨時加班，欲申請改期至下週二下午',
    status: 'pending',
    reviewType: 'reschedule',
    reqDate: '2026-11-03',
    reqHour: 14,
    reqMin: 0,
    reqRoom: 'small',
    reqLessonType: '1v1'
  }
];

export const INITIAL_LOGS: AuditLogItem[] = [
  {
    id: 'l-101',
    time: '10/30 15:12',
    actor: 'Daisy',
    teacherName: 'Cindy',
    studentName: '陳大文',
    action: "原課堂：11/04(三) 14:00 🟢\n改至：🟣\n結果：核准",
    detail: "原課堂：11/04(三) 14:00 🟢\n改至：🟣\n結果：核准",
    typeStr: '改室',
    category: 'normal',
    read: true,
    teacherId: 't-3',
    reviewId: 'rev-sample-2'
  },
  {
    id: 'l-102',
    time: '10/30 14:40',
    actor: 'Daisy',
    teacherName: 'Tanya',
    studentName: '林小婷',
    action: "原課堂：11/01(日) 10:00 🟢\n改至：11/03(二) 14:00 🟢\n結果：免罰改期",
    detail: "原課堂：11/01(日) 10:00 🟢\n改至：11/03(二) 14:00 🟢\n結果：免罰改期",
    typeStr: '改期',
    category: 'red',
    read: false,
    teacherId: 't-2',
    reviewId: 'rev-sample-3'
  },
  {
    id: 'l-104',
    time: '10/27 14:55',
    actor: 'Daisy',
    teacherName: 'Daisy',
    studentName: '黃柏翔',
    action: '10/27(二) 14:00  -1堂  餘 11 堂',
    detail: '10/27(二) 14:00  -1堂  餘 11 堂',
    typeStr: '簽到',
    category: 'normal',
    read: true,
    teacherId: 't-daisy'
  }
];

