'use client';
import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { BookingItem, SettlementAction } from '../types';
import { formatTimeStr, formatDateWithDay } from '../mockData';
import { canSettleBooking } from '../utils/bookingRules';
import { systemConfirm } from '../utils/systemAlert';
import BookingRecordCard from './BookingRecordCard';

interface OverdueSettlementListProps {
  /** classifyBookingLifecycle 判定為 overdue 的課堂 */
  bookings: BookingItem[];
  now: Date;
  userRole: 'admin' | 'teacher';
  currentUserId: string;
  /** 學員詳情頁：隱藏重複的學生姓名 */
  hideStudentName?: boolean;
  /** 可收合（個人課表）；未開啟時清單一律展開 */
  collapsible?: boolean;
  /** 可收合時的預設展開狀態 */
  defaultExpanded?: boolean;
  /** 此值或逾期清單變動時，展開狀態回到預設 */
  resetKey?: string;
  /** 琥珀色強調 */
  emphasize?: boolean;
  /** 清單超過高度時內部捲動 */
  scrollable?: boolean;
  /** 單堂系統代簽（本元件完成二次確認後呼叫） */
  onSettle: (bookingIds: string[], action: SettlementAction) => void;
  onSign: (booking: BookingItem) => void;
  onEdit: (booking: BookingItem) => void;
  onUpdateNote: (bookingId: string, note: string) => void;
  onClickBooking?: (booking: BookingItem) => void;
  className?: string;
}

/** 全站共用逾期處理區塊（個人課表、學員詳情頁）：逐堂系統代簽、變更（含取消）、簽名 / 補簽 */
export default function OverdueSettlementList({
  bookings,
  now,
  userRole,
  currentUserId,
  hideStudentName = false,
  collapsible = false,
  defaultExpanded = false,
  resetKey = '',
  emphasize = false,
  scrollable = false,
  onSettle,
  onSign,
  onEdit,
  onUpdateNote,
  onClickBooking,
  className = '',
}: OverdueSettlementListProps) {
  // 手動展開 / 收合只在清單內容與 resetKey 不變時有效（儲存筆記不影響）
  const stateKey = `${resetKey}|${bookings.map(b => b.id).join('|')}`;
  const [manual, setManual] = useState<{ key: string; open: boolean } | null>(null);
  const isOpen = !collapsible || (manual?.key === stateKey ? manual.open : defaultExpanded);

  if (bookings.length === 0) return null;

  const handleSystemSign = async (b: BookingItem) => {
    const ok = await systemConfirm(
      `${b.studentName}　${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)} ${b.lessonType}\n` +
      '系統代簽將扣除學員 1 堂，送出後僅管理員可撤銷，確定代簽嗎？',
      '確認系統代簽',
    );
    if (ok) onSettle([b.id], 'system_sign');
  };

  return (
    <div className={`p-3 rounded-2xl border shadow-2xs space-y-2 transition-all ${
      emphasize ? 'bg-amber-50/90 border-amber-300 ring-1 ring-amber-200' : 'bg-white border-slate-200'
    } ${className}`}>
      <div
        className={`flex justify-between items-center ${collapsible ? 'cursor-pointer' : ''}`}
        onClick={collapsible ? () => setManual({ key: stateKey, open: !isOpen }) : undefined}
      >
        <div className="flex items-center text-amber-900 font-black text-xs gap-1.5">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <span>⏰ 逾期未處理 ({bookings.length})</span>
        </div>
        {collapsible && <span className="text-slate-400 font-bold p-1">{isOpen ? '▲' : '▼'}</span>}
      </div>

      {isOpen && (
        <div className="space-y-2 pt-2 border-t border-amber-200/50">
          <div className={`space-y-1.5 ${scrollable ? 'max-h-[40vh] overflow-y-auto' : ''}`}>
            {bookings.map(b => (
              <BookingRecordCard
                key={b.id}
                booking={b}
                now={now}
                showStudentName={!hideStudentName}
                onClick={onClickBooking ? () => onClickBooking(b) : undefined}
                onUpdateNote={onUpdateNote}
                onSystemSign={canSettleBooking(b, userRole, currentUserId) ? handleSystemSign : undefined}
                onEdit={onEdit}
                onSign={onSign}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
