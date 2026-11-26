import { useEffect, type RefObject } from 'react';
import type { BookingItem } from '../types';
import { DEFAULT_SCROLL_HOUR, isSlotReleased } from './bookingRules';

/** 時間軸比例：每分鐘 1px（60px / 小時），原點為 00:00 */
const PX_PER_MIN = 1;

/**
 * 行事曆捲動目標（距 00:00 的分鐘數）：指定日期內第一堂課的開始時間。
 * 一般老師只看自己的課；管理員看全館。沒有課堂時回傳 09:00。
 */
export const getScrollTargetMins = (
  bookings: BookingItem[],
  dates: string[],
  userRole: 'admin' | 'teacher',
  currentUserId: string,
): number => {
  const starts = bookings
    .filter(b =>
      dates.includes(b.date) &&
      !isSlotReleased(b) &&
      (userRole === 'admin' || b.teacherId === currentUserId))
    .map(b => b.startHour * 60 + b.startMin);
  return starts.length > 0 ? Math.min(...starts) : DEFAULT_SCROLL_HOUR * 60;
};

/**
 * 進入時間軸視圖（切分頁、切視圖、換日期、切身分）時自動捲動到目標時間。
 * 課堂資料變動不會重新捲動，避免預約後畫面跳走。
 */
export function useCalendarAutoScroll({
  ref, enabled, dates, bookings, userRole, currentUserId, getLeft,
}: {
  ref: RefObject<HTMLDivElement | null>;
  /** 該視圖目前實際顯示中（隱藏的分頁無法捲動） */
  enabled: boolean;
  dates: string[];
  bookings: BookingItem[];
  userRole: 'admin' | 'teacher';
  currentUserId: string;
  /** 需要同時水平捲動時（週曆對齊到指定日期欄） */
  getLeft?: (el: HTMLDivElement) => number;
}) {
  const dateKey = dates.join(',');
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const top = getScrollTargetMins(bookings, dates, userRole, currentUserId) * PX_PER_MIN;
    el.scrollTo({ top, ...(getLeft ? { left: getLeft(el) } : {}), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dateKey, userRole, currentUserId]);
}
