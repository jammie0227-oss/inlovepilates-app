import { genId } from './utils/id';
import type {
  TeacherProfile, PresetColor, StudentRule, PurchaseRecord, StudentItem,
  BookingItem, ReviewItem, AuditLogItem, ConflictCheckResult, ScheduleEngineResult,
  PriorityGrid,
} from './types';
export * from './types';
import { checkGlobalConflict, isCancelledSlot } from './utils/conflict';
import {
  applyAutoSwaps,
  calculateStudentStats,
  diffDays,
  findOtherPriorityOwner,
  formatTimestamp,
  getDefaultRoomForSchedule,
  hoursUntilLesson,
  matchesStudent,
  needsPriorityReview,
  occupiesQuota,
  resolveRoomAssignment,
} from './utils/bookingRules';
import type { AutoSwapItem } from './utils/bookingRules';
export { checkGlobalConflict, isCancelledSlot };

// ==========================================
// 2. 輔助函式 (Helper Functions)
// ==========================================

export const getExactTimestamp = () => formatTimestamp();

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
export const formatDateWithDay = (dateStr: string, baseYear: number = new Date().getFullYear()): string => {
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


// ==========================================
// 3. 自動排課引擎 (Schedule Engine)
// ==========================================

// ==========================================
// 3. 自動排課引擎 (Schedule Engine - 完整落實 A~E 規則)
// ==========================================

/** 隔週時段的非上課週：以起始排課日（缺漏時用 fallbackBase）起算，每 14 天上一次 */
const isOffWeek = (slot: StudentRule, dateStr: string, fallbackBase: string): boolean => {
  if (slot.freq !== '隔週' && slot.freq !== 'EOW') return false;
  const weeks = Math.floor(diffDays(dateStr, slot.startDate || fallbackBase) / 7);
  return weeks < 0 || weeks % 2 !== 0;
};

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

  /** 自動排課只往後排：已開課的時段不由系統自動排入（手動預約不受限） */
  private hasStarted(dateStr: string, h: number, m: number) {
    return hoursUntilLesson(dateStr, h, m) <= 0;
  }

  /**
   * 自動排課共用的跳過判斷：回傳原因字串；可排則回傳 null。
   */
  private getSlotSkipReason(
    dateStr: string,
    h: number,
    m: number,
    todayStr: string,
    userRole: 'admin' | 'teacher',
  ): string | null {
    // 他人優先時段不略過：照常排入，一般老師 14 天前以待審狀態送審
    if (userRole !== 'admin' && diffDays(dateStr, todayStr) > 90) return '超過 90 天預約上限';
    if (this.hasStarted(dateStr, h, m)) return '已超過開課時間';
    return null;
  }

  /**
   * 自動排課與順延補排共用的落位判斷，與手動新增預約同一套規則：
   * 教室調度（含大教室讓位）→ 全局衝堂。1v1 撞教室而另一間有空時直接改排另一間。
   * 可排回傳最終教室與需移至小教室的既有 1v1；不可排回傳原因。
   */
  private placeSlot({
    existingBookings, dateStr, h, m, lessonType, requestedRoom, teacherId, sid, sName, userRole,
  }: {
    existingBookings: BookingItem[];
    dateStr: string;
    h: number;
    m: number;
    lessonType: '1v1' | '1v2';
    requestedRoom: 'large' | 'small';
    teacherId: string;
    sid: string;
    sName: string;
    userRole: 'admin' | 'teacher';
  }):
    | { ok: true; roomType: 'large' | 'small'; autoSwaps: AutoSwapItem[] }
    | { ok: false; reason: string } {
    const assignment = resolveRoomAssignment({
      dateStr, startHour: h, startMin: m, lessonType, requestedRoom, existingBookings,
    });
    if (assignment.blocked) return { ok: false, reason: assignment.notice || '大教室空間不足，無法預約 1v2' };

    const autoSwaps = assignment.autoSwaps ?? [];
    const effective = applyAutoSwaps(existingBookings, autoSwaps);
    const checkRoom = (roomType: 'large' | 'small') => checkGlobalConflict({
      dateStr, startHour: h, startMin: m, durationMins: 50,
      roomType, lessonType, teacherId, studentId: sid, studentName: sName, userRole,
      existingBookings: effective, teachersMap: this.teachersMap, studentsMap: this.studentsMap,
    });

    let roomType = assignment.roomType;
    let conflict = checkRoom(roomType);
    if (conflict.hasConflict && conflict.suggestAlternateRoom && lessonType === '1v1') {
      roomType = conflict.suggestAlternateRoom;
      conflict = checkRoom(roomType);
    }
    return conflict.hasConflict
      ? { ok: false, reason: conflict.reason || '該時段已有預約' }
      : { ok: true, roomType, autoSwaps };
  }

  /** 依「最終教室」決定排入狀態：他人優先時段（>= 14 天）→ 一般老師待審 */
  private getStatus({
    dateStr, h, m, teacherId, userRole, todayStr, priorityGrid, roomType,
  }: {
    dateStr: string;
    h: number;
    m: number;
    teacherId: string;
    userRole: 'admin' | 'teacher';
    todayStr: string;
    priorityGrid: PriorityGrid;
    roomType: 'large' | 'small';
  }): BookingItem['status'] {
    const priorityOwnerId = findOtherPriorityOwner({ dateStr, startHour: h, startMin: m, roomType, teacherId, priorityGrid });
    return needsPriorityReview({ dateStr, today: todayStr, userRole, priorityOwnerId })
      ? 'special_pending'
      : 'confirmed';
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
    todayStr,
    priorityGrid = {},
    userRole = 'teacher',
    mode = 'replace_future', // 'append_remaining' (接續排課) 或 'replace_future' (重整未來)
    maxWeeksLimit = 16,
    targetCount
  }: {
    sid: string;
    sName: string;
    teacherId: string;
    credits: number;
    slots: StudentRule[];
    startFromDate: string;
    /** 今天 'YYYY-MM-DD' */
    todayStr: string;
    priorityGrid?: PriorityGrid;
    userRole?: 'admin' | 'teacher';
    mode?: 'append_remaining' | 'replace_future';
    maxWeeksLimit?: number;
    /** 指定本次要新排的堂數（A/B/C/D/E 算式）；未提供時以 credits - 已佔額度 計算 */
    targetCount?: number;
  }): ScheduleEngineResult {
    // 1. 底線防護：嚴禁預排過去日期（起始日若早於今天，強制校正為今天）
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
    // 任何歷史紀錄、簽到扣堂、已取消、審核中（special_pending）的課堂，絕對不可刪除！
    const isSameStudent = (b: BookingItem) => matchesStudent({ id: sid, name: sName }, b.studentId, b.studentName);
    const safeFutureBookings = this.bookings.filter(b =>
      isSameStudent(b) &&
      b.date >= effectiveStartDate &&
      !b.signed &&
      b.status === 'confirmed'
    );

    let removedBookingIds: string[] = [];
    if (mode === 'replace_future') {
      // 重整未來：僅釋出尚未開課的純 confirmed 預約（審核中與已開課待簽到的課堂受保護）
      removedBookingIds = safeFutureBookings
        .filter(b => !this.hasStarted(b.date, b.startHour, b.startMin))
        .map(b => b.id);
    }

    // 已佔用額度：以共用堂數計算機統一計算（含審核中與逾期未簽），扣除即將被移除者
    const preservedFutureCount = calculateStudentStats(
      this.bookings.filter(b => !removedBookingIds.includes(b.id)),
      { id: sid, name: sName, credits },
    ).occupiedCount;

    // 計算本次實際能新增預排的堂數上限（總堂數永不溢出）
    // targetCount 由 calculateStudentStats 提供，已扣除逾期（含今天已開課未簽）與待審，這裡不可再扣一次
    let remainingToSchedule = targetCount !== undefined
      ? targetCount
      : credits - preservedFutureCount;
    if (remainingToSchedule <= 0) {
      return {
        success: false,
        message: targetCount !== undefined
          ? '剩餘可排堂數為 0，無需再預排'
          : `既有排課已佔用 ${preservedFutureCount} 堂，已達可用堂數上限 (${credits} 堂)，無需再預排`,
        copyText: '',
        newRecords: [],
        removedBookingIds: [],
        skippedReasons: []
      };
    }

    // 排除被移除的預約後的活躍課表；隨排入進度累加新課堂並套用讓位結果
    let activeBookings = this.bookings.filter(b => !removedBookingIds.includes(b.id));
    const autoSwaps: AutoSwapItem[] = [];
    const dayNameToNum: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const newRecords: BookingItem[] = [];
    const skippedReasons: string[] = [];
    const suggestedRoomSwaps: any[] = [];
    let hitHorizonLimit = false;

    let currentCursor = parseLocalDate(effectiveStartDate);
    let weeksCount = 0;

    // 管理員不受 16 週／90 天限制（安全上限 104 週 = 2 年）；一般老師受 90 天規則限制
    const effectiveMaxWeeks = userRole === 'admin' ? Math.max(maxWeeksLimit, 104) : maxWeeksLimit;

    while (remainingToSchedule > 0 && weeksCount < effectiveMaxWeeks) {
      weeksCount++;
      // 本週各時段依實際日期時間由早到晚處理（與規則列的排列順序無關）
      const weekSlots = validSlots
        .map(slot => {
          const matchDate = new Date(currentCursor);
          matchDate.setDate(matchDate.getDate() + (dayNameToNum[slot.day] - matchDate.getDay() + 7) % 7);
          return { slot, dateStr: formatLocalDate(matchDate) };
        })
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.slot.time.localeCompare(b.slot.time));

      for (const { slot, dateStr } of weekSlots) {
        if (remainingToSchedule <= 0) break;
        if (dateStr < effectiveStartDate) continue;
        if (slot.startDate && dateStr < slot.startDate) continue;

        // 3. 隔週（EOW）：非上課週自動跳過
        if (isOffWeek(slot, dateStr, effectiveStartDate)) continue;

        const [hStr, mStr] = slot.time.split(':');
        const h = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);
        const lType = slot.lessonType || '1v1';
        let rType = slot.roomType || getDefaultRoomForSchedule(teacherId, lType);
        if (lType === '1v2') rType = 'large'; // 小教室嚴禁排入 1v2

        // 3.5 自動跳過：超過 90 天（管理員不受限）、已開課；他人優先時段不跳過，改依角色排入或送審
        const statusInput = { dateStr, h, m, teacherId, userRole, todayStr, priorityGrid };
        const skipReason = this.getSlotSkipReason(dateStr, h, m, todayStr, userRole);
        if (skipReason) {
          if (skipReason.startsWith('超過 90 天')) {
            // 日期只會越來越晚，之後的時段一律超限，直接結束排課
            hitHorizonLimit = true;
            skippedReasons.push(`${formatDateWithDay(dateStr)} ${slot.time} (${skipReason})`);
            break;
          }
          skippedReasons.push(`${formatDateWithDay(dateStr)} ${slot.time} (${skipReason})`);
          continue;
        }

        // 4. 教室調度（含大教室讓位）與衝堂檢測；被取消的時段已完全釋出，可正常預排
        const placed = this.placeSlot({
          existingBookings: activeBookings,
          dateStr, h, m, lessonType: lType, requestedRoom: rType, teacherId, sid, sName, userRole,
        });
        if (!placed.ok) {
          skippedReasons.push(`${formatDateWithDay(dateStr)} ${slot.time} (${placed.reason})`);
          continue;
        }

        const record: BookingItem = {
          id: genId('b-auto'),
          date: dateStr,
          startHour: h,
          startMin: m,
          durationMins: 50,
          teacherId,
          studentName: sName,
          studentId: sid,
          roomType: placed.roomType,
          lessonType: lType,
          status: this.getStatus({ ...statusInput, roomType: placed.roomType }),
          signed: false,
          isAuto: true
        };
        newRecords.push(record);
        autoSwaps.push(...placed.autoSwaps);
        activeBookings = [...applyAutoSwaps(activeBookings, placed.autoSwaps), record];
        remainingToSchedule--;

        if (placed.roomType !== rType) {
          const roomName = (r: 'large' | 'small') => (r === 'large' ? '大教室' : '小教室');
          suggestedRoomSwaps.push({
            date: dateStr,
            time: slot.time,
            targetRoom: placed.roomType,
            reason: `${roomName(rType)}已有預約，已自動改排至${roomName(placed.roomType)}`
          });
        }
      }
      if (hitHorizonLimit) break;
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
      scheduledCount: newRecords.length,
      nonPriorityCount: newRecords.filter(b => b.status === 'special_pending').length,
      remainingUnscheduled: remainingToSchedule,
      hitHorizonLimit,
      message: `已順利預排 ${newRecords.length} 堂課${skippedReasons.length > 0 ? ` (自動略過 ${skippedReasons.length} 處不可排時段)` : ''}`,
      copyText,
      newRecords,
      removedBookingIds,
      skippedReasons,
      autoSwaps,
      suggestedRoomSwaps
    };
  }

  /**
   * 狀況 C：已排滿時手動新增一堂，僅能刪除「confirmed、未簽、isAuto === true」中時間最後的一堂
   */
  public handleDropLastBookingOnManualAdd(sid: string, currentBookings: BookingItem[]): { updatedBookings: BookingItem[]; droppedBooking: BookingItem | null } {
    const futureAuto = currentBookings
      .filter(b => b.studentId === sid && !b.signed && b.status === 'confirmed' && b.isAuto === true)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin);
      });

    if (futureAuto.length === 0) {
      return { updatedBookings: currentBookings, droppedBooking: null };
    }

    const lastBooking = futureAuto[futureAuto.length - 1];
    const updated = currentBookings.filter(b => b.id !== lastBooking.id);
    return { updatedBookings: updated, droppedBooking: lastBooking };
  }

  /**
   * 狀況 D：學員取消預排，自動順延補排一堂（附帶 3 個月 90 天限制）。
   * 呼叫端須先確認取消已生效且額度仍有空位。順延起點不會早於今天（todayStr）。
   */
  public handleAutoPostponeCancelledBooking({
    sid,
    sName,
    teacherId,
    cancelledDate,
    todayStr,
    slots,
    currentBookings,
    priorityGrid = {},
    userRole = 'teacher'
  }: {
    sid: string;
    sName: string;
    teacherId: string;
    cancelledDate: string;
    todayStr: string;
    slots: StudentRule[];
    currentBookings: BookingItem[];
    priorityGrid?: PriorityGrid;
    userRole?: 'admin' | 'teacher';
  }): { postponedBooking: BookingItem | null; autoSwaps?: AutoSwapItem[]; alertMsg?: string } {
    // 一般老師：3 個月 (90天) 上限（自今天起算）；管理員不受限（僅設一年搜尋視窗避免無窮迴圈，見下方 searchStartDate）
    const limitDate = parseLocalDate(todayStr);
    limitDate.setDate(limitDate.getDate() + 90);

    // 推算起點：最後一堂佔額度的預排日與被取消課堂日期兩者較晚者的隔天（不可補回剛取消的時段）
    const anchorDate = currentBookings
      .filter(b => matchesStudent({ id: sid, name: sName }, b.studentId, b.studentName) && occupiesQuota(b))
      .reduce((latest, b) => (b.date > latest ? b.date : latest), cancelledDate);

    const searchStartDate = parseLocalDate(anchorDate);
    searchStartDate.setDate(searchStartDate.getDate() + 1);
    // 起點不得早於今天
    const todayDate = parseLocalDate(todayStr);
    if (searchStartDate < todayDate) searchStartDate.setTime(todayDate.getTime());

    if (userRole === 'admin') {
      limitDate.setTime(searchStartDate.getTime());
      limitDate.setDate(limitDate.getDate() + 366);
    }

    // 同一天有多個時段時取較早者
    const validSlots = slots.filter(s => s.freq !== '不固定').sort((a, b) => a.time.localeCompare(b.time));
    if (validSlots.length === 0) return { postponedBooking: null };

    const dayNameToNum: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    let cursor = new Date(searchStartDate);

    while (cursor <= limitDate) {
      const dateStr = formatLocalDate(cursor);
      for (const slot of validSlots) {
        if (cursor.getDay() !== dayNameToNum[slot.day]) continue;
        if (slot.startDate && dateStr < slot.startDate) continue;
        if (isOffWeek(slot, dateStr, cancelledDate)) continue;
        const [h, m] = slot.time.split(':').map(Number);
        const lType = slot.lessonType || '1v1';
        // 小教室嚴禁排入 1v2
        const rType = lType === '1v2' ? 'large' : slot.roomType || getDefaultRoomForSchedule(teacherId, lType);

        // 他人優先時段仍可排入：一般老師 14 天前待審，其餘直接生效
        if (this.getSlotSkipReason(dateStr, h, m, todayStr, userRole)) continue;

        const placed = this.placeSlot({
          existingBookings: currentBookings,
          dateStr, h, m, lessonType: lType, requestedRoom: rType, teacherId, sid, sName, userRole,
        });
        if (!placed.ok) continue;

        return {
          postponedBooking: {
            id: genId('b-auto-postpone'),
            date: dateStr,
            startHour: h,
            startMin: m,
            durationMins: 50,
            teacherId,
            studentName: sName,
            studentId: sid,
            roomType: placed.roomType,
            lessonType: lType,
            status: this.getStatus({
              dateStr, h, m, teacherId, userRole, todayStr, priorityGrid, roomType: placed.roomType,
            }),
            signed: false,
            isAuto: true
          },
          autoSwaps: placed.autoSwaps
        };
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      postponedBooking: null,
      alertMsg: userRole === 'admin' ? undefined : '⚠️ 無法順延排課，因為場租老師預排課程不能超過三個月（管理員無此限制）'
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
    isActive: true
  },
  't-1': {
    id: 't-1',
    name: 'Abby',
    phone: '0912-345-678',
    color: 'bg-sky-500',
    bgLight: 'bg-sky-100',
    border: 'border-sky-400',
    text: 'text-sky-900',
    isActive: true
  },
  't-2': {
    id: 't-2',
    name: 'Tanya',
    phone: '0922-111-222',
    color: 'bg-emerald-500',
    bgLight: 'bg-emerald-100',
    border: 'border-emerald-400',
    text: 'text-emerald-900',
    isActive: true
  },
  't-3': {
    id: 't-3',
    name: 'Cindy',
    phone: '0933-444-555',
    color: 'bg-purple-500',
    bgLight: 'bg-purple-100',
    border: 'border-purple-400',
    text: 'text-purple-900',
    isActive: true
  },
  't-4': {
    id: 't-4',
    name: 'Tata',
    phone: '0955-000-004',
    color: 'bg-pink-600',
    bgLight: 'bg-pink-100',
    border: 'border-pink-400',
    text: 'text-pink-950',
    isActive: true
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
    purchases: [
      { id: 'p-1', date: '2026-10-01', credits: 10, price: 22000, teacherName: 'Abby', studentName: '王小美', signedAt: '2026/10/01 14:00' }
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
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
    autoRescheduleOnCancel: true,
    status: 'active',
    purchases: []
  },

  // --- Tata (t-4) 學員 ---
  {
    id: 's-ta-1',
    name: '蔡依珊',
    phone: '0912-777-001',
    teacherId: 't-4',
    note: '久坐肩頸緊繃',
    credits: 8,
    defaultLessonType: '1v1',
    lessonType: '1v1',
    isTrial: false,
    rules: [{ id: 'r-ta-1', freq: '每週', day: '五', time: '10:00', startDate: '2026-11-27', lessonType: '1v1', roomType: 'small' }],
    autoRescheduleOnCancel: true,
    status: 'active',
    purchases: []
  },
  {
    id: 's-ta-2',
    name: '何冠宇',
    phone: '0912-777-002',
    teacherId: 't-4',
    note: '雙人核心訓練',
    credits: 10,
    defaultLessonType: '1v2',
    lessonType: '1v2',
    isTrial: false,
    rules: [{ id: 'r-ta-2', freq: '每週', day: '五', time: '14:00', startDate: '2026-11-27', lessonType: '1v2', roomType: 'large' }],
    autoRescheduleOnCancel: true,
    status: 'active',
    purchases: []
  }
];

// ==========================================
// 預設優先時段（Daisy 為管理員，不受任何優先時段限制）
// ==========================================
const prioritySlots = (teacherId: string, days: string[], fromHour: number, toHour: number): PriorityGrid =>
  Object.fromEntries(
    days.flatMap(day =>
      Array.from({ length: toHour - fromHour }, (_, i) => [`${day}-${fromHour + i}`, { all: teacherId }]),
    ),
  );

export const INITIAL_PRIORITY_GRID: PriorityGrid = {
  ...prioritySlots('t-1', ['二', '四'], 9, 17),                      // Abby：週二、週四 09:00–17:00
  ...prioritySlots('t-4', ['三', '五'], 9, 17),                      // Tata：週三、週五 09:00–17:00
  ...prioritySlots('t-2', ['一', '二', '三', '四', '五'], 18, 21),    // Tanya：週一至週五 18:00–21:00
};

// ==========================================
// 營運功能測試資料 (2026/11/28 ～ 12/06)
// ==========================================
/** 學員姓名與課程類別一律由 INITIAL_STUDENTS 帶出，避免與學員資料不一致 */
const testBooking = (
  id: string,
  date: string,
  startHour: number,
  teacherId: string,
  studentId: string,
  roomType: BookingItem['roomType'],
  extra: Partial<BookingItem> = {},
): BookingItem => {
  const student = INITIAL_STUDENTS.find(s => s.id === studentId)!;
  return {
    id,
    date,
    startHour,
    startMin: 0,
    durationMins: 50,
    teacherId,
    studentName: student.name,
    studentId,
    roomType,
    lessonType: student.defaultLessonType ?? '1v1',
    status: 'confirmed',
    signed: false,
    ...extra,
  };
};

const TEST_WEEK_BOOKINGS: BookingItem[] = [
  // 11/28（六）— 另有 b-nov-09 (11:00)、b-nov-10 (19:00)
  testBooking('b-test-1128-1', '2026-11-28', 9, 't-1', 's-1', 'small'),
  testBooking('b-test-1128-2', '2026-11-28', 13, 't-daisy', 's-d-2', 'large'),
  // 改期歷程範例：原定 11/29 13:00 大教室
  testBooking('b-test-1128-3', '2026-11-28', 15, 't-4', 's-ta-1', 'small', {
    rescheduledInfo: {
      updatedAt: '2026/11/27 09:30',
      originalDate: '2026-11-29',
      originalStartTime: '13:00',
      originalRoomId: 'large',
    },
  }),
  testBooking('b-test-1128-4', '2026-11-28', 16, 't-daisy', 's-d-3', 'large'),

  // 11/29（日）
  testBooking('b-test-1129-1', '2026-11-29', 10, 't-2', 's-5', 'small'),
  testBooking('b-test-1129-2', '2026-11-29', 11, 't-4', 's-ta-2', 'large'),
  // 大教室讓位測試：14:00 大教室 1v1、小教室空檔
  testBooking('b-test-1129-3', '2026-11-29', 14, 't-2', 's-t-2', 'large'),
  testBooking('b-test-1129-4', '2026-11-29', 16, 't-daisy', 's-d-1', 'small'),

  // 11/30（一）— 另有 b-nov-11 (14:00)、b-nov-12 (19:00)
  testBooking('b-test-1130-1', '2026-11-30', 10, 't-daisy', 's-d-3', 'large'),
  testBooking('b-test-1130-2', '2026-11-30', 16, 't-4', 's-ta-2', 'large'),

  // 12/01（二）
  testBooking('b-test-1201-1', '2026-12-01', 10, 't-daisy', 's-d-1', 'small'),
  testBooking('b-test-1201-2', '2026-12-01', 11, 't-1', 's-2', 'large'),
  testBooking('b-test-1201-3', '2026-12-01', 15, 't-4', 's-ta-1', 'small'),
  testBooking('b-test-1201-4', '2026-12-01', 19, 't-2', 's-5', 'small'),

  // 12/02（三）
  testBooking('b-test-1202-1', '2026-12-02', 11, 't-2', 's-t-2', 'large'),
  testBooking('b-test-1202-2', '2026-12-02', 13, 't-4', 's-ta-2', 'large'),
  // 大教室讓位測試：15:00 大教室 1v1、小教室空檔
  testBooking('b-test-1202-3', '2026-12-02', 15, 't-daisy', 's-d-3', 'large'),
  testBooking('b-test-1202-4', '2026-12-02', 17, 't-1', 's-a-3', 'small'),

  // 12/03（四）
  testBooking('b-test-1203-1', '2026-12-03', 10, 't-1', 's-2', 'large'),
  testBooking('b-test-1203-2', '2026-12-03', 15, 't-1', 's-a-3', 'small'),
  testBooking('b-test-1203-3', '2026-12-03', 16, 't-daisy', 's-d-2', 'large'),
  testBooking('b-test-1203-4', '2026-12-03', 20, 't-2', 's-5', 'small'),

  // 12/04（五）
  testBooking('b-test-1204-1', '2026-12-04', 10, 't-4', 's-ta-1', 'small'),
  testBooking('b-test-1204-2', '2026-12-04', 14, 't-4', 's-ta-2', 'large'),
  testBooking('b-test-1204-3', '2026-12-04', 16, 't-daisy', 's-d-1', 'small'),
  testBooking('b-test-1204-4', '2026-12-04', 19, 't-2', 's-t-2', 'large'),

  // 12/05（六）
  testBooking('b-test-1205-1', '2026-12-05', 9, 't-daisy', 's-d-3', 'small'),
  testBooking('b-test-1205-2', '2026-12-05', 10, 't-1', 's-2', 'large'),
  testBooking('b-test-1205-3', '2026-12-05', 14, 't-2', 's-5', 'small'),
  testBooking('b-test-1205-4', '2026-12-05', 15, 't-4', 's-ta-1', 'large'),

  // 12/06（日）
  testBooking('b-test-1206-1', '2026-12-06', 10, 't-2', 's-5', 'small'),
  testBooking('b-test-1206-2', '2026-12-06', 11, 't-daisy', 's-d-2', 'large'),
  testBooking('b-test-1206-3', '2026-12-06', 14, 't-1', 's-a-3', 'small'),
  testBooking('b-test-1206-4', '2026-12-06', 16, 't-4', 's-ta-2', 'large'),

  // 非優先審核待審單（對應 INITIAL_REVIEWS）
  // 日期須距今 14 天以上，否則載入時會被系統自動核准
  // Tata 預約 Abby 優先時段（週二 10:00）
  testBooking('b-test-pending-1', '2026-12-22', 10, 't-4', 's-ta-1', 'small', { status: 'special_pending' }),
  // Abby 預約 Tanya 優先時段（週三 19:00）
  testBooking('b-test-pending-2', '2026-12-23', 19, 't-1', 's-2', 'large', { status: 'special_pending' }),
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
    signedAt: '2026/10/27 14:55'
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
    signedAt: '2026/10/28 09:50'
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
    status: 'cancelled_normal', // 超時取消（24H 內）
    isLateCancel: true,
    cancelledAt: '2026/11/02 09:15',
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
  },

  // ==========================================
  // 5. 11 月底測試資料 (11/24 ~ 11/30)
  // ==========================================
  // 已過期未簽到
  {
    id: 'b-nov-01',
    date: '2026-11-24',
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
  // 已過期未簽到
  {
    id: 'b-nov-02',
    date: '2026-11-25',
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
    id: 'b-nov-03',
    date: '2026-11-26',
    startHour: 16,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '王小美',
    studentId: 's-1',
    roomType: 'large',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-nov-04',
    date: '2026-11-26',
    startHour: 19,
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
  {
    id: 'b-nov-05',
    date: '2026-11-27',
    startHour: 10,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-4',
    studentName: '蔡依珊',
    studentId: 's-ta-1',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  // 非優先申請待審（Tata 優先時段；11/28 起進入開課前 14 天內，自動核准）
  {
    id: 'b-nov-06',
    date: '2026-12-11',
    startHour: 11,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '許家豪',
    studentId: 's-a-3',
    roomType: 'large',
    lessonType: '1v1',
    status: 'special_pending',
    signed: false
  },
  {
    id: 'b-nov-07',
    date: '2026-11-27',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-4',
    studentName: '何冠宇',
    studentId: 's-ta-2',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-nov-08',
    date: '2026-11-27',
    startHour: 19,
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
    id: 'b-nov-09',
    date: '2026-11-28',
    startHour: 11,
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
  // 週六晚間課堂（全館 24 小時開放）
  {
    id: 'b-nov-10',
    date: '2026-11-28',
    startHour: 19,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '郭冠廷',
    studentId: 's-t-2',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-nov-11',
    date: '2026-11-30',
    startHour: 14,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-1',
    studentName: '許家豪',
    studentId: 's-a-3',
    roomType: 'small',
    lessonType: '1v1',
    status: 'confirmed',
    signed: false
  },
  {
    id: 'b-nov-12',
    date: '2026-11-30',
    startHour: 19,
    startMin: 0,
    durationMins: 50,
    teacherId: 't-2',
    studentName: '林小婷',
    studentId: 's-5',
    roomType: 'large',
    lessonType: '1v2',
    status: 'confirmed',
    signed: false
  },
  ...TEST_WEEK_BOOKINGS
];

export const INITIAL_REVIEWS: ReviewItem[] = [
  // --- 11 月底測試審核單 ---
  // 規定：管理員 Daisy (t-daisy) 的預約一律直接生效，不得建立任何待審課堂或審核單；
  // 全站唯一的審核類型為「非優先審核」，範例只指定給一般老師。
  {
    id: 'rev-np-b-nov-06',
    bookingId: 'b-nov-06',
    teacherId: 't-1',
    teacherName: 'Abby',
    studentName: '許家豪',
    date: '2026-12-11',
    time: '12/11(五) 11:00',
    room: '大教室',
    lessonType: '1v1',
    reason: '非優先時段預約申請',
    status: 'pending',
    reviewType: 'non_priority'
  },
  {
    id: 'rev-np-b-test-pending-1',
    bookingId: 'b-test-pending-1',
    teacherId: 't-4',
    teacherName: 'Tata',
    studentName: '蔡依珊',
    date: '2026-12-22',
    time: '12/22(二) 10:00',
    room: '小教室',
    lessonType: '1v1',
    reason: '非優先時段預約申請',
    status: 'pending',
    reviewType: 'non_priority'
  },
  {
    id: 'rev-np-b-test-pending-2',
    bookingId: 'b-test-pending-2',
    teacherId: 't-1',
    teacherName: 'Abby',
    studentName: '李小花',
    date: '2026-12-23',
    time: '12/23(三) 19:00',
    room: '大教室',
    lessonType: '1v2',
    reason: '非優先時段預約申請',
    status: 'pending',
    reviewType: 'non_priority'
  }
];

export const INITIAL_LOGS: AuditLogItem[] = [
  {
    id: 'l-101',
    time: '2026/10/30 15:12',
    actor: 'Daisy',
    teacherName: 'Cindy',
    studentName: '陳大文',
    title: 'Cindy・陳大文（[[large]] 11/4 14:00 1v1）',
    action: "原定課程：（[[small]] 11/4 14:00 1v1）\n結果：改室完成",
    detail: "原定課程：（[[small]] 11/4 14:00 1v1）\n結果：改室完成",
    typeStr: '改室',
    category: 'normal',
    read: true,
    teacherId: 't-3'
  },
  {
    id: 'l-102',
    time: '2026/10/30 14:40',
    actor: 'Daisy',
    teacherName: 'Tanya',
    studentName: '林小婷',
    title: 'Tanya・林小婷（[[small]] 11/3 14:00 1v1）',
    action: "原定課程：（[[small]] 11/1 10:00 1v1）\n結果：改期完成",
    detail: "原定課程：（[[small]] 11/1 10:00 1v1）\n結果：改期完成",
    typeStr: '改期',
    category: 'yellow',
    read: false,
    teacherId: 't-2'
  },
  {
    id: 'l-104',
    time: '2026/10/27 14:55',
    actor: 'Daisy',
    teacherName: 'Daisy',
    studentName: '黃柏翔',
    title: 'Daisy・黃柏翔（[[small]] 10/27 14:00 1v1）',
    action: '[簽到] -1堂  餘 11 堂',
    detail: '[簽到] -1堂  餘 11 堂',
    typeStr: '簽到',
    category: 'normal',
    read: true,
    teacherId: 't-daisy'
  }
];

