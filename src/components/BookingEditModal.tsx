'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { formatTimeStr, formatDateWithDay } from '../mockData';
import type { BusinessHoursConfig, StudentItem, TeacherProfile } from '../types';
import {
  BUSINESS_MINUTES,
  getDisplayHours,
  DEFAULT_BUSINESS_HOURS,
  isWithin24Hours as isWithin24HoursRule,
  validateAndBuildBooking,
} from '../utils/bookingRules';
import type { AutoSwapItem, PriorityGrid } from '../utils/bookingRules';
import { systemAlert } from '../utils/systemAlert';


export interface BookingEditConfirmPayload {
  bookingId: string;
  date: string;
  hour: number;
  min: number;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
  isCancel: boolean;
  reason: string;
  /** 系統自動調整教室 / 大教室讓位時的提示 */
  notice?: string;
  /** 需同步自動移至小教室的既有 1v1 課堂（改期搶大教室時的讓位） */
  autoSwaps?: AutoSwapItem[];
}

interface BookingEditModalProps {
  /** 正在編輯的預約；為 null 時不渲染 */
  booking: any | null;
  userRole: 'admin' | 'teacher';
  /** 全局基準日 'YYYY-MM-DD'，用於計算「距開課是否小於 24 小時」 */
  systemBaseDate: string;
  /** 全部預約（供教室自動連動計算衝突） */
  bookings?: any[];
  /** 標題顯示的學員名稱；未提供時取 booking.studentName */
  studentName?: string;
  /** 待審核課堂：僅能取消，不顯示改期 / 改室欄位 */
  cancelOnly?: boolean;
  /** 以下供共用驗證 validateAndBuildBooking 使用 */
  businessHours?: BusinessHoursConfig;
  priorityGrid?: PriorityGrid;
  teachers?: Record<string, TeacherProfile>;
  students?: StudentItem[];
  onClose: () => void;
  onConfirm: (payload: BookingEditConfirmPayload) => void;
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export default function BookingEditModal({
  booking,
  userRole,
  systemBaseDate,
  bookings = [],
  studentName,
  cancelOnly = false,
  businessHours = DEFAULT_BUSINESS_HOURS,
  priorityGrid = {},
  teachers = {},
  students = [],
  onClose,
  onConfirm,
}: BookingEditModalProps) {
  const [date, setDate] = useState('');
  const [hour, setHour] = useState('10');
  const [min, setMin] = useState('00');
  const [room, setRoom] = useState<'large' | 'small'>('small');
  const [lessonType, setLessonType] = useState<'1v1' | '1v2'>('1v1');
  const [reason, setReason] = useState('');

  // 每次開啟（booking 變動）重設表單與事由
  useEffect(() => {
    if (!booking) return;
    setDate(booking.date);
    setHour(pad(booking.startHour));
    setMin(pad(booking.startMin));
    setRoom(booking.roomType || 'small');
    setLessonType(booking.lessonType || '1v1');
    setReason('');
  }, [booking]);

  const isUnchanged = useMemo(() => {
    if (!booking) return true;
    return (
      date === booking.date &&
      parseInt(hour, 10) === booking.startHour &&
      min === pad(booking.startMin) &&
      room === (booking.roomType || 'small') &&
      lessonType === (booking.lessonType || '1v1')
    );
  }, [booking, date, hour, min, room, lessonType]);

  if (!booking) return null;

  const needsReason =
    userRole !== 'admin' &&
    isWithin24HoursRule(booking.date, booking.startHour, booking.startMin, systemBaseDate);

  // 教室自動連動：切換課程類別時帶入預設教室（1v2 → 大、1v1 → 小）
  const handleLessonTypeChange = (next: '1v1' | '1v2') => {
    setLessonType(next);
    setRoom(next === '1v2' ? 'large' : 'small');
  };

  const handleConfirm = (isCancel: boolean) => {
    if (!isCancel && isUnchanged) return;
    if (needsReason && !reason.trim()) {
      systemAlert('距上課時間小於 24 小時，請務必填寫異動事由供管理員審核！');
      return;
    }

    let finalRoom = room;
    let notice: string | undefined;
    let autoSwaps: AutoSwapItem[] | undefined;

    if (!isCancel) {
      const newHour = parseInt(hour, 10);
      const newMin = parseInt(min, 10);
      // 僅改教室（日期時間不變）時略過時間限制；其餘一律走共用驗證
      const timeUnchanged =
        date === booking.date && newHour === booking.startHour && newMin === booking.startMin;
      const res = validateAndBuildBooking({
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
        systemBaseDate,
        businessHours,
        priorityGrid,
        bookings,
        teachers,
        students,
        excludeBookingId: booking.id,
        mode: 'reschedule',
        skipTimeConstraints: timeUnchanged,
        skipQuota: true,
      });
      if (!res.ok || !res.booking) {
        systemAlert(`【無法變更】\n${res.error || '此時段無法預約'}`);
        return;
      }
      finalRoom = res.booking.roomType;
      notice = res.notices[0];
      autoSwaps = res.autoSwaps.length ? res.autoSwaps : undefined;
    }

    onConfirm({
      bookingId: booking.id,
      date,
      hour: parseInt(hour, 10),
      min: parseInt(min, 10),
      roomType: finalRoom,
      lessonType,
      isCancel,
      reason: reason.trim(),
      notice,
      autoSwaps,
    });
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
                {getDisplayHours(businessHours).map(h => (
                  <option key={h} value={pad(h)}>{h}</option>
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

        {/* 一般老師距開課小於 24 小時：必填事由 */}
        {needsReason && (
          <div className="space-y-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-2xl animate-in fade-in">
            <div className="flex items-center gap-1.5 text-amber-900 font-bold text-[11px]">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{cancelOnly ? '⚠️ 逾時取消（距上課小於 24 小時），須填事由送審：' : '⚠️ 距上課小於 24 小時，請務必填寫異動事由：'}</span>
            </div>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="請詳細填寫取消或改期原因（例如：學員發燒急診檢附收據、臨時加班等）..."
              className="w-full bg-white border border-amber-300 rounded-xl p-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-amber-500 font-sans shadow-2xs placeholder:text-slate-400"
            />
          </div>
        )}

        {/* 前後無改動：變更課堂灰階禁用 */}
        <div className={`grid ${cancelOnly ? 'grid-cols-1' : 'grid-cols-2'} gap-2 pt-1 border-t border-slate-100`}>
          {!cancelOnly && (
          <button
            onClick={() => handleConfirm(false)}
            disabled={isUnchanged}
            className={`py-2.5 rounded-xl font-bold transition shadow-xs text-xs ${
              isUnchanged
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
