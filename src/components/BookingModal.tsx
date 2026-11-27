'use client';
import React, { useMemo, useState } from 'react';
import type { StudentItem, TeacherProfile } from '../types';
import {
  BUSINESS_MINUTES,
  DAY_HOURS,
  getStudentBookingPreset,
  type BookingRequestInput,
  type ValidateBookingResult,
} from '../utils/bookingRules';
import BookingCheckCard from './BookingCheckCard';

export interface BookingFormState {
  date: string;
  hour: string;
  minute: string;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
  teacherId: string;
  studentId: string;
}

interface BookingModalProps {
  /** 開啟時帶入的預設值 */
  initial: BookingFormState;
  /** 可選擇的學員 */
  students: StudentItem[];
  userRole: 'admin' | 'teacher';
  teachers: Record<string, TeacherProfile>;
  validate: (input: BookingRequestInput) => ValidateBookingResult;
  /** 回傳 true 代表已寫入（或已送審），彈窗隨即關閉 */
  onSubmit: (input: BookingRequestInput) => Promise<boolean>;
  onClose: () => void;
}

const selectCls =
  'w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold appearance-none outline-none focus:border-rose-500';

const Caret = () => (
  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
);

/** 全站共用「新增預約」彈窗（排班總覽、個人課表、學員詳情頁） */
export default function BookingModal({
  initial, students, userRole, teachers, validate, onSubmit, onClose,
}: BookingModalProps) {
  const [form, setForm] = useState<BookingFormState>(initial);
  const student = students.find(s => s.id === form.studentId);

  const input: BookingRequestInput | null = student
    ? {
        date: form.date,
        startHour: parseInt(form.hour, 10),
        startMin: parseInt(form.minute, 10),
        durationMins: 50,
        teacherId: form.teacherId,
        studentId: student.id,
        studentName: student.name,
        roomType: form.roomType,
        lessonType: form.lessonType,
      }
    : null;

  // 日期 / 時間 / 教室 / 學員任一變動即重算
  const check = useMemo(
    () => (input ? validate(input) : null),
    // input 由 form 與 student 組成；validate 隨全域課表資料更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, student, validate],
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" style={{ zIndex: 99999 }}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-3xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative space-y-4">
        {/* 標題與關閉按鈕 */}
        <div className="flex justify-between items-center pb-1">
          <h3 className="font-black text-lg text-slate-800 tracking-tight">新增預約</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold p-1 leading-none">✕</button>
        </div>

        <div className="space-y-3.5 text-sm">
          {/* 1. 選擇學員 (帶剩餘堂數與預設課型) */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">選擇學員</label>
            <div className="relative">
              <select
                value={form.studentId}
                onChange={e => {
                  const id = e.target.value;
                  const preset = getStudentBookingPreset(students.find(s => s.id === id), userRole);
                  setForm(prev => ({ ...prev, studentId: id, ...preset }));
                }}
                className={selectCls}
              >
                {students.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.credits ?? 0}堂) - {s.defaultLessonType || '1v1'}
                  </option>
                ))}
              </select>
              <Caret />
            </div>
          </div>

          {/* 2. 預約日期 */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">預約日期</label>
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold outline-none focus:border-rose-500"
            />
          </div>

          {/* 3. 時 (Hour) 與 分 (10 分鐘為單位) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">時 (Hour)</label>
              <div className="relative">
                <select value={form.hour} onChange={e => setForm(prev => ({ ...prev, hour: e.target.value }))} className={selectCls}>
                  {DAY_HOURS.map(h => (
                    <option key={h} value={String(h).padStart(2, '0')}>{String(h).padStart(2, '0')}</option>
                  ))}
                </select>
                <Caret />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">分 (10 分鐘為單位)</label>
              <div className="relative">
                <select value={form.minute} onChange={e => setForm(prev => ({ ...prev, minute: e.target.value }))} className={selectCls}>
                  {BUSINESS_MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <Caret />
              </div>
            </div>
          </div>

          {/* 4. 教室選擇 (帶彩色圓點) 與 課程種類 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">教室選擇</label>
              <div className="relative">
                <select
                  value={form.roomType}
                  onChange={e => setForm(prev => ({ ...prev, roomType: e.target.value as 'large' | 'small' }))}
                  className={selectCls}
                >
                  <option value="large">🟣 大教室</option>
                  <option value="small">🟢 小教室</option>
                </select>
                <Caret />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">課程種類</label>
              <div className="relative">
                <select
                  value={form.lessonType}
                  onChange={e => {
                    // 教室自動連動：1v2 → 大教室；1v1 → 小教室（管理員一律優先大教室）
                    const next = e.target.value as '1v1' | '1v2';
                    setForm(prev => ({
                      ...prev,
                      lessonType: next,
                      roomType: userRole === 'admin' || next === '1v2' ? 'large' : 'small',
                    }));
                  }}
                  className={selectCls}
                >
                  <option value="1v1">1v1 單人</option>
                  <option value="1v2">1v2 雙人</option>
                </select>
                <Caret />
              </div>
            </div>
          </div>
        </div>

        <BookingCheckCard result={check} userRole={userRole} teachers={teachers} />
        {!student && <p className="text-xs font-bold text-rose-600">目前沒有可預約的學員</p>}

        {/* 按鈕組 */}
        <div className="grid grid-cols-2 gap-3 pt-3">
          <button type="button" onClick={onClose} className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition active:scale-95">
            取消
          </button>
          <button
            type="button"
            onClick={async () => {
              if (input && await onSubmit(input)) onClose();
            }}
            disabled={!check || !check.ok}
            className="w-full py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold transition active:scale-95 shadow-md shadow-rose-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100"
          >
            確認預約
          </button>
        </div>
      </div>
    </div>
  );
}
