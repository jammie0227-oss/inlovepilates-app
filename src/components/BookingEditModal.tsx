'use client';
import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { formatTimeStr, formatDateWithDay } from '../mockData';
import type { StudentItem, TeacherProfile } from '../types';
import {
  BUSINESS_MINUTES,
  DAY_HOURS,
  isWithin24Hours as isWithin24HoursRule,
  validateAndBuildBooking,
} from '../utils/bookingRules';
import type { AutoSwapItem, PriorityGrid } from '../utils/bookingRules';
import BookingCheckCard from './BookingCheckCard';

export interface BookingEditConfirmPayload {
  bookingId: string;
  date: string;
  hour: number;
  min: number;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
  isCancel: boolean;
  /** 需同步自動移至小教室的既有 1v1 課堂（改期搶大教室時的讓位） */
  autoSwaps?: AutoSwapItem[];
}

interface BookingEditModalProps {
  /** 正在編輯的預約；為 null 時不渲染 */
  booking: any | null;
  userRole: 'admin' | 'teacher';
  /** 今天 'YYYY-MM-DD' */
  today: string;
  /** 全部預約（供教室自動連動計算衝突） */
  bookings?: any[];
  /** 標題顯示的學員名稱；未提供時取 booking.studentName */
  studentName?: string;
  /** 非優先審核中的課堂：僅能取消，不顯示改期 / 改室欄位 */
  cancelOnly?: boolean;
  /** 以下供共用驗證 validateAndBuildBooking 使用 */
  priorityGrid?: PriorityGrid;
  teachers?: Record<string, TeacherProfile>;
  students?: StudentItem[];
  onClose: () => void;
  /** 寫入失敗時回傳錯誤訊息（顯示於彈窗內、彈窗保持開啟） */
  onConfirm: (payload: BookingEditConfirmPayload) => string | undefined;
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** 每次開啟新的課堂即以該課堂內容重建表單 */
export default function BookingEditModal({ booking, ...rest }: BookingEditModalProps) {
  if (!booking) return null;
  return <BookingEditDialog key={booking.id} booking={booking} {...rest} />;
}

function BookingEditDialog({
  booking,
  userRole,
  today,
  bookings = [],
  studentName,
  cancelOnly = false,
  priorityGrid = {},
  teachers = {},
  students = [],
  onClose,
  onConfirm,
}: BookingEditModalProps) {
  const [date, setDate] = useState<string>(booking.date);
  const [hour, setHour] = useState(pad(booking.startHour));
  const [min, setMin] = useState(pad(booking.startMin));
  const [room, setRoom] = useState<'large' | 'small'>(booking.roomType || 'small');
  const [lessonType, setLessonType] = useState<'1v1' | '1v2'>(booking.lessonType || '1v1');
  // 寫入時才發現的錯誤；表單內容一變動即失效
  const [submitError, setSubmitError] = useState<{ form: string; message: string } | null>(null);
  const formKey = [date, hour, min, room, lessonType].join('|');

  const newHour = parseInt(hour, 10);
  const newMin = parseInt(min, 10);
  const isUnchanged =
    date === booking.date &&
    newHour === booking.startHour &&
    newMin === booking.startMin &&
    room === (booking.roomType || 'small') &&
    lessonType === (booking.lessonType || '1v1');
  // 僅改教室（日期時間不變）時略過時間限制；其餘一律走共用驗證
  const timeUnchanged =
    date === booking.date && newHour === booking.startHour && newMin === booking.startMin;

  // 即時檢測：結果直接顯示於彈窗內
  const check = cancelOnly || isUnchanged
    ? null
    : validateAndBuildBooking({
        input: {
          date,
          startHour: newHour,
          startMin: newMin,
          durationMins: booking.durationMins,
          teacherId: booking.teacherId,
          studentId: booking.studentId,
          studentName: booking.studentName,
          roomType: room,
          lessonType,
        },
        userRole,
        today,
        priorityGrid,
        bookings,
        teachers,
        students,
        excludeBookingId: booking.id,
        mode: 'reschedule',
        skipTimeConstraints: timeUnchanged,
        skipQuota: true,
      });
  // 系統把教室導回原值後與原課堂完全相同：不視為異動
  const hasNoEffect =
    !!check?.booking && timeUnchanged &&
    check.booking.roomType === booking.roomType && lessonType === booking.lessonType;
  const canChange = !!check?.ok && !hasNoEffect;

  // 僅供提示：24 小時內取消仍直接生效，只標註超時取消
  const isLateWindow = isWithin24HoursRule(booking.date, booking.startHour, booking.startMin);

  // 教室自動連動：切換課程類別時帶入預設教室（1v2 → 大、1v1 → 小）
  const handleLessonTypeChange = (next: '1v1' | '1v2') => {
    setLessonType(next);
    setRoom(next === '1v2' ? 'large' : 'small');
  };

  const handleConfirm = (isCancel: boolean) => {
    if (!isCancel && !canChange) return;
    const error = onConfirm({
      bookingId: booking.id,
      date,
      hour: newHour,
      min: newMin,
      roomType: !isCancel && check?.booking ? check.booking.roomType : room,
      lessonType,
      isCancel,
      autoSwaps: !isCancel && check?.autoSwaps.length ? check.autoSwaps : undefined,
    });
    setSubmitError(error ? { form: formKey, message: error } : null);
  };

  const selectCls =
    'w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-3.5 animate-in zoom-in-95 border border-slate-100 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="text-sm font-black text-slate-800">
            {cancelOnly ? '取消預約' : '變更 / 取消預約'} ({studentName || booking.studentName})
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {userRole === 'admin' && teachers[booking.teacherId] && (
          <p className="text-[11px] font-bold text-slate-500">
            任課老師：{teachers[booking.teacherId].name}（管理員直接變更，完成後將寫入稽核紀錄並通知老師）
          </p>
        )}

        {/* 原預約內容 */}
        <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full shrink-0 ${booking.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
          <div className="text-xs font-bold text-slate-800 flex-1">
            <span className="font-mono">
              {formatDateWithDay(booking.date)} {formatTimeStr(booking.startHour, booking.startMin)}
            </span>
            <span className="ml-2 text-slate-500 font-sans">
              ({booking.lessonType || '1v1'} · {booking.roomType === 'large' ? '大教室' : '小教室'})
            </span>
          </div>
        </div>

        {cancelOnly && (
          <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2">
            審核完成前無法變更時段或教室，僅可取消課堂。
          </p>
        )}

        {!cancelOnly && (
        <div className="space-y-2.5">
          <div>
            <label className="font-bold text-slate-600 block mb-1">修改日期</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className={`${selectCls} font-mono`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-bold text-slate-600 block mb-1">時 (Hour)</label>
              <select value={hour} onChange={e => setHour(e.target.value)} className={`${selectCls} font-mono`}>
                {DAY_HOURS.map(h => (
                  <option key={h} value={pad(h)}>{pad(h)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-bold text-slate-600 block mb-1">分 (10 分鐘為單位)</label>
              <select value={min} onChange={e => setMin(e.target.value)} className={`${selectCls} font-mono`}>
                {BUSINESS_MINUTES.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-bold text-slate-600 block mb-1">教室選擇</label>
              <select value={room} onChange={(e: any) => setRoom(e.target.value)} className={selectCls}>
                <option value="large">🟣 大教室</option>
                <option value="small">🟢 小教室</option>
              </select>
            </div>
            <div>
              <label className="font-bold text-slate-600 block mb-1">課程類別</label>
              <select value={lessonType} onChange={(e: any) => handleLessonTypeChange(e.target.value)} className={selectCls}>
                <option value="1v1">1v1 單人</option>
                <option value="1v2">1v2 雙人</option>
              </select>
            </div>
          </div>
        </div>
        )}

        {hasNoEffect ? (
          <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 font-bold text-amber-800 leading-relaxed">
            ℹ️ {check?.notices[0] ? `教室調度：${check.notices[0]}。` : ''}調整後的結果與原課堂相同，無法變更。
          </div>
        ) : (
          <BookingCheckCard result={check} userRole={userRole} teachers={teachers} />
        )}

        {submitError?.form === formKey && (
          <div role="alert" className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-black text-rose-700 leading-relaxed whitespace-pre-line">
            ⛔ {submitError.message.replace(/^【[^】]+】\n?/, '')}
          </div>
        )}

        {isLateWindow && (
          <div className="flex items-start gap-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 font-bold text-[11px] leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>距開課小於 24 小時：取消直接生效（不扣學員堂數），紀錄標註「超時取消（24H 內）」。</span>
          </div>
        )}

        {/* 前後無改動：變更課堂灰階禁用 */}
        <div className={`grid ${cancelOnly ? 'grid-cols-1' : 'grid-cols-2'} gap-2 pt-1 border-t border-slate-100`}>
          {!cancelOnly && (
          <button
            onClick={() => handleConfirm(false)}
            disabled={!canChange}
            className={`py-2.5 rounded-xl font-bold transition shadow-xs text-xs ${
              !canChange
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
            title={isUnchanged ? '內容未變更' : '確認變更課堂'}
          >
            變更課堂
          </button>
          )}
          <button
            onClick={() => handleConfirm(true)}
            className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 py-2.5 rounded-xl font-bold transition shadow-xs text-xs"
          >
            取消課堂
          </button>
        </div>
      </div>
    </div>
  );
}
