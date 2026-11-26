// ==========================================
// conflict.ts — 衝堂檢測 (無外部相依，避免與 bookingRules / mockData 循環引用)
// ==========================================
import type {
  BookingItem,
  TeacherProfile,
  StudentItem,
  ConflictCheckResult,
} from '../types';

const fmtTime = (hour: number, min: number) =>
  `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

// 判定是否為已釋出空位的課堂：僅「已取消」釋出；非優先審核中的預約仍卡住時段
export const isCancelledSlot = (status: string) => status === 'cancelled_normal';

type SlotLike = Pick<BookingItem, 'date' | 'startHour' | 'startMin'> & { durationMins?: number };

const slotRange = (b: SlotLike): [number, number] => {
  const [y, m, d] = b.date.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) / 60000 + b.startHour * 60 + b.startMin;
  return [start, start + (b.durationMins || 50)];
};

/** 兩堂課時間是否重疊；以絕對分鐘比較，跨午夜的課會延伸到隔日 */
export const slotsOverlap = (a: SlotLike, b: SlotLike): boolean => {
  const [aStart, aEnd] = slotRange(a);
  const [bStart, bEnd] = slotRange(b);
  return aStart < bEnd && bStart < aEnd;
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
  const request: SlotLike = { date: dateStr, startHour, startMin, durationMins };

  // 1. 檢查同教室是否有預約佔用
  for (const b of existingBookings) {
    if (isCancelledSlot(b.status)) continue; // 已取消的課堂空間全空，不計入衝堂
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (!slotsOverlap(request, b)) continue;

    const bStart = b.startHour * 60 + b.startMin;
    const bEnd = bStart + (b.durationMins || 50);
    const endHour = Math.floor(bEnd / 60) % 24;

    const tObj = teachersMap[b.teacherId];
    const teacherLabel = tObj?.name || '老師';
    const studentLabel = b.studentName || '學員';
    const roomLabel = b.roomType === 'large' ? '大教室' : '小教室';
    const timeRangeStr = `${fmtTime(b.startHour, b.startMin)} ~ ${fmtTime(endHour, bEnd % 60)}`;

    // 教室空間衝突
    if (b.roomType === roomType) {
      // 檢查另一間教室是否為空（狀況 E 換室建議）
      const otherRoom: 'large' | 'small' = roomType === 'large' ? 'small' : 'large';
      const isOtherRoomFree = !existingBookings.some(ob => {
        if (isCancelledSlot(ob.status)) return false;
        if (excludeBookingId && ob.id === excludeBookingId) return false;
        return ob.roomType === otherRoom && slotsOverlap(request, ob);
      });

      // 1v2 課程絕對不能排入小教室
      const canSuggestSwap = isOtherRoomFree && !(lessonType === '1v2' && otherRoom === 'small');

      // 依照身分提供遮罩訊息
      const exactRange = `${fmtTime(b.startHour, b.startMin)}–${fmtTime(endHour, bEnd % 60)}`;
      const reasonMsg = userRole === 'admin'
        ? `【無法預約】衝堂提醒：${teacherLabel} 老師 ${exactRange} ${studentLabel} (${b.lessonType}) 在${roomLabel}已有預約`
        : b.teacherId === teacherId
          ? `【無法預約】衝堂提醒：您在該時段 ${exactRange} 已有預約（${roomLabel} ${studentLabel} ${b.lessonType}）`
          : `【無法預約】衝堂提醒：該時段 ${exactRange} (${b.lessonType}) 在${roomLabel}已有預約`;

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
