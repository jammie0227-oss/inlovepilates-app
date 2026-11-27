import React from 'react';
import type { TeacherProfile } from '../types';
import { priorityReviewHint, type ValidateBookingResult } from '../utils/bookingRules';

const ERROR_CLS = 'rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-black text-rose-700 leading-relaxed whitespace-pre-line';
const INFO_CLS = 'rounded-2xl border border-amber-300 bg-amber-50 p-3 font-bold text-amber-800 leading-relaxed';

/** 預約彈窗內的即時檢測提示：衝堂、教室調度、優先時段一律直接顯示在彈窗中 */
export default function BookingCheckCard({
  result,
  userRole,
  teachers,
}: {
  result: ValidateBookingResult | null;
  userRole: 'admin' | 'teacher';
  teachers: Record<string, TeacherProfile>;
}) {
  if (!result) return null;
  const ownerName = result.priorityOwnerId
    ? (teachers[result.priorityOwnerId]?.name || '其他老師').replace(/ 老師|老師/g, '').trim()
    : '';

  return (
    <div className="space-y-2 text-xs">
      {!result.ok && (
        <div role="alert" className={ERROR_CLS}>
          {result.errorKind === 'conflict' ? '⛔ ' : '⚠️ '}
          {(result.error || '此時段無法預約').replace(/^【[^】]+】/, '')}
        </div>
      )}
      {result.ok && result.isPastSlot && (
        <div className={ERROR_CLS}>⚠️ 此時段已超過開課時間，確認後將直接寫入課表</div>
      )}
      {result.ok && result.requiresReview && ownerName && (
        <div className={ERROR_CLS}>{priorityReviewHint(ownerName)}</div>
      )}
      {result.ok && !result.requiresReview && userRole !== 'admin' && ownerName && (
        <div className={INFO_CLS}>ℹ️ 此為 {ownerName} 優先時段（14 天內），預約直接生效並通知該老師</div>
      )}
      {result.ok && result.autoSwaps.length > 0 ? (
        <div className={INFO_CLS}>
          ℹ️ 教室調度：確認後原大教室 {result.autoSwaps.length} 堂 1v1 將自動移至小教室，並通知原任課老師
        </div>
      ) : result.ok && result.notices.length > 0 ? (
        <div className={INFO_CLS}>ℹ️ 教室調度：{result.notices[0]}</div>
      ) : null}
    </div>
  );
}
