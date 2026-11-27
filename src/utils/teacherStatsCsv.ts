// ==========================================
// teacherStatsCsv.ts — Tab 4 授課統計對帳匯出內容
// 堂數一律取自 calculateTeacherMonthlyStats，明細範圍同 filterMonthBookings
// ==========================================
import type { BookingItem, TeacherProfile } from '../types';
import {
  REVIEW_TAG,
  ROOM_NAME,
  classifyBookingLifecycle,
  compareByStart,
  filterMonthBookings,
  formatMonthKey,
  formatTimestamp,
  getBookingOutcome,
  getProcessedStamp,
  isPendingApproval,
  sumTeacherMonthStats,
} from './bookingRules';
import type { BookingOutcome, TeacherMonthStats } from './bookingRules';
import { toCsv } from './csv';
import type { CsvCell } from './csv';

const OUTCOME_LABEL: Record<BookingOutcome, string> = {
  signed: '已簽到',
  makeup_signed: '補簽',
  system_signed: '系統代簽',
  cancelled: '已取消',
  late_cancelled: '超時取消',
  system_cancelled: '系統取消',
  rejected: '非優先駁回',
};

const statusLabel = (b: BookingItem, now: Date): string => {
  const outcome = getBookingOutcome(b);
  if (outcome) return OUTCOME_LABEL[outcome];
  if (isPendingApproval(b)) return REVIEW_TAG;
  return classifyBookingLifecycle(b, now) === 'upcoming' ? '尚未開始' : '待簽到';
};

const pad = (n: number) => String(n).padStart(2, '0');

export interface TeacherStatsRow {
  /** 管理員為老師名，一般老師為月份 */
  label: string;
  stats: TeacherMonthStats;
}

export const buildTeacherStatsCsv = ({
  isAdmin, monthKey, rows, bookings, teachers, currentUserId, now,
}: {
  isAdmin: boolean;
  /** 查詢月份 'YYYY-MM' */
  monthKey: string;
  /** 與畫面統計表相同的列 */
  rows: TeacherStatsRow[];
  bookings: BookingItem[];
  teachers: Record<string, TeacherProfile>;
  currentUserId: string;
  now: Date;
}): string => {
  // 取消統計僅管理員可見
  const statCells = (s: TeacherMonthStats): CsvCell[] => [
    s.count1v1, s.count1v2, s.total, s.unsettled, s.upcoming,
    ...(isAdmin ? [s.cancelled, s.normalCancel, s.lateCancel] : []),
  ];
  const timeOf = (b: BookingItem, labels: string[]): string => {
    const info = getProcessedStamp(b);
    return info && labels.includes(info.label) ? info.stamp || '—' : '';
  };

  const details = filterMonthBookings(bookings, monthKey, isAdmin ? undefined : currentUserId).sort(compareByStart);

  return toCsv([
    ['查詢月份', formatMonthKey(monthKey)],
    ['匯出範圍', isAdmin ? '全館' : `${teachers[currentUserId]?.name || '老師'}（個人）`],
    ['匯出時間', formatTimestamp(now)],
    [],
    ['月統計總表'],
    [
      isAdmin ? '老師' : '月份', '1v1', '1v2', '總堂數', '未結堂數', '預排堂數',
      ...(isAdmin ? ['取消堂數', '正常取消', '超時取消'] : []),
    ],
    ...rows.map(r => [r.label, ...statCells(r.stats)]),
    ['合計', ...statCells(sumTeacherMonthStats(rows.map(r => r.stats)))],
    [],
    [`${formatMonthKey(monthKey)} 授課明細`],
    ['日期', '開始時間', '老師', '學員', '課程類別', '教室', '狀態', '簽到時間', '代簽時間', '取消時間'],
    ...details.map(b => [
      b.date,
      `${pad(b.startHour)}:${pad(b.startMin)}`,
      teachers[b.teacherId]?.name || '',
      b.studentName,
      b.lessonType,
      ROOM_NAME[b.roomType],
      statusLabel(b, now),
      // 補簽併入簽到時間欄，以狀態欄區分
      timeOf(b, ['簽到時間', '補簽時間']),
      timeOf(b, ['代簽時間']),
      timeOf(b, ['取消時間']),
    ]),
  ]);
};
