'use client';
import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { formatTimeStr, formatDateWithDay } from '../mockData';
import type { BookingItem, StudentItem } from '../types';
import {
  ROOM_NAME,
  canPostponeOnCancel,
  isWithin24Hours,
  matchesStudent,
  shouldAutoReschedule,
} from '../utils/bookingRules';
import { RoomDot } from './RoomDot';

interface CancelBookingModalProps {
  booking: BookingItem;
  /** 顯示的學員名稱；未提供時取 booking.studentName */
  studentName?: string;
  students: StudentItem[];
  userRole: 'admin' | 'teacher';
  currentUserId: string;
  /** 離開：不執行取消 */
  onClose: () => void;
  /** 寫入失敗時回傳錯誤訊息（顯示於彈窗內、彈窗保持開啟） */
  onConfirm: (postpone: boolean) => string | undefined;
}

/** 全站唯一的取消課堂確認彈窗 */
export default function CancelBookingModal({
  booking,
  studentName,
  students,
  userRole,
  currentUserId,
  onClose,
  onConfirm,
}: CancelBookingModalProps) {
  const [error, setError] = useState<string | null>(null);

  const student = students.find(s => matchesStudent(s, booking.studentId, booking.studentName));
  const canPostpone = !!student && canPostponeOnCancel(student);
  const preferPostpone = !!student && shouldAutoReschedule(student);
  const isAdminOverride = userRole === 'admin' && booking.teacherId !== currentUserId;
  const isLateWindow = isWithin24Hours(booking.date, booking.startHour, booking.startMin);

  const handleConfirm = (postpone: boolean) => setError(onConfirm(postpone) ?? null);

  const primaryCls = 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600';
  const secondaryCls = 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200';
  const options = [
    {
      postpone: false,
      label: '確定取消',
      hint: canPostpone ? '僅取消這堂課，不扣學員堂數、不順延補排' : '取消這堂課，不扣學員堂數',
      primary: !preferPostpone,
    },
    ...(canPostpone
      ? [{
          postpone: true,
          label: '取消＋順延排課',
          hint: '取消這堂課，不扣學員堂數，依固定時段往後順延補排 1 堂',
          primary: preferPostpone,
        }]
      : []),
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[60] p-4">
      <div role="dialog" aria-modal="true" aria-label="取消課堂確認" className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-3.5 animate-in zoom-in-95 border border-slate-100 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-sm font-black text-slate-800">取消課堂確認</h3>
          <button type="button" onClick={onClose} aria-label="離開" title="離開（不取消課堂）" className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-1">
          <p className="text-base font-black text-slate-900 break-words">{studentName || booking.studentName}</p>
          <p className="text-xs font-bold text-slate-700 flex items-center justify-center gap-1 flex-wrap">
            <RoomDot room={booking.roomType} />
            <span className="font-mono">{formatDateWithDay(booking.date)} {formatTimeStr(booking.startHour, booking.startMin)}</span>
            <span className="text-slate-500">{ROOM_NAME[booking.roomType]}</span>
          </p>
        </div>

        {!canPostpone && (
          <p className="text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-xl p-2">
            此學員無固定排課時段（或已封存），無法自動順延
          </p>
        )}
        {isAdminOverride && (
          <p className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2">
            將發送重要通知給授課老師
          </p>
        )}
        {isLateWindow && (
          <div className="flex items-start gap-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 font-bold text-[11px] leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>距開課小於 24 小時：取消直接生效（不扣學員堂數），紀錄標註「超時取消（24H 內）」。</span>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-black text-rose-700 leading-relaxed whitespace-pre-line">
            ⛔ {error.replace(/^【[^】]+】\n?/, '')}
          </div>
        )}

        <div className="space-y-2 pt-1 border-t border-slate-100">
          {options.map(o => (
            <button
              key={o.label}
              type="button"
              onClick={() => handleConfirm(o.postpone)}
              className={`w-full py-2.5 px-3 rounded-xl border font-black transition shadow-xs ${o.primary ? primaryCls : secondaryCls}`}
            >
              <span className="block text-xs">{o.label}</span>
              <span className="block text-[10px] font-normal opacity-80">{o.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
