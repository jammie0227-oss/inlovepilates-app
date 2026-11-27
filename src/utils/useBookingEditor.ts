import { useState } from 'react';
import type { BookingEditConfirmPayload } from '../components/BookingEditModal';
import type { BookingItem } from '../types';
import { isPendingApproval } from './bookingRules';

/** 與 page.handleExecuteReschedule 相同簽章；回傳錯誤訊息代表未寫入 */
export type ExecuteReschedule = (
  bookingId: string,
  newDate: string,
  newHour: number,
  newMin: number,
  newRoom: 'large' | 'small',
  isCancel?: boolean,
  newLessonType?: '1v1' | '1v2',
  autoSwaps?: BookingEditConfirmPayload['autoSwaps'],
  postpone?: boolean,
) => string | undefined;

/**
 * 變更 / 取消預約的共用開關與寫入流程（排班總覽、個人課表、學員詳情頁）。
 * 回傳的 modalProps 直接展開給 BookingEditModal。
 */
export function useBookingEditor(execute: ExecuteReschedule) {
  const [editing, setEditing] = useState<{ booking: BookingItem; cancelOnly: boolean } | null>(null);
  const close = () => setEditing(null);

  return {
    /** 變更（非優先審核中的課堂僅能取消） */
    openEdit: (booking: BookingItem) => setEditing({ booking, cancelOnly: isPendingApproval(booking) }),
    modalProps: {
      booking: editing?.booking ?? null,
      cancelOnly: !!editing?.cancelOnly,
      onClose: close,
      onConfirm: (p: BookingEditConfirmPayload) => {
        const error = execute(
          p.bookingId, p.date, p.hour, p.min, p.roomType, p.isCancel, p.lessonType, p.autoSwaps, p.postpone,
        );
        if (!error) close();
        return error;
      },
    },
  };
}
