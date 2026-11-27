'use client';
import React from 'react';
import { Plus, X } from 'lucide-react';
import type { StudentRule } from '../types';
import { BUSINESS_MINUTES, DAY_HOURS, getDefaultRoomForSchedule } from '../utils/bookingRules';

export interface ScheduleSettings {
  noRegularRule: boolean;
  rules: StudentRule[];
  autoRescheduleOnCancel: boolean;
}

interface Props {
  value: ScheduleSettings;
  onChange: (next: ScheduleSettings) => void;
  today: string;
  /** 授課老師：決定切換課程種類時的預設教室 */
  teacherId: string;
  /** 新增時段列的預設值 */
  createRule: () => StudentRule;
}

const fieldCls = 'w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none';
const pad = (n: number) => String(n).padStart(2, '0');

/** 排課模式、固定時段列表與取消順延開關（新增學員與編輯排課規則共用） */
export default function ScheduleRulesEditor({ value, onChange, today, teacherId, createRule }: Props) {
  const { noRegularRule, rules, autoRescheduleOnCancel } = value;

  // 切換模式時順延開關回到該模式的預設值：固定時段開、無固定時間關（且不可開啟）
  const setMode = (flexible: boolean) => {
    if (flexible === noRegularRule) return;
    onChange({
      noRegularRule: flexible,
      rules: !flexible && rules.length === 0 ? [createRule()] : rules,
      autoRescheduleOnCancel: !flexible,
    });
  };

  const updateRule = (index: number, patch: Partial<StudentRule>) =>
    onChange({
      ...value,
      rules: rules.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        // 切換課程種類時套用預設教室；之後仍可手動改選
        if (patch.lessonType) next.roomType = getDefaultRoomForSchedule(teacherId, patch.lessonType);
        if (next.lessonType === '1v2') next.roomType = 'large'; // 小教室嚴禁 1v2
        return next;
      }),
    });

  return (
    <div className="space-y-3">
      <div>
        <label className="font-bold text-slate-700 block mb-1">排課模式</label>
        <div role="radiogroup" aria-label="排課模式" className="flex bg-slate-100 p-1 rounded-xl font-bold text-slate-600">
          {([[false, '固定每週時段'], [true, '無固定時間']] as const).map(([flexible, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={noRegularRule === flexible}
              onClick={() => setMode(flexible)}
              className={`flex-1 py-1.5 rounded-lg transition ${noRegularRule === flexible ? 'bg-white text-rose-600 font-black shadow-xs' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={autoRescheduleOnCancel}
        disabled={noRegularRule}
        onClick={() => onChange({ ...value, autoRescheduleOnCancel: !autoRescheduleOnCancel })}
        className="w-full flex items-center justify-between gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-left disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span>
          <span className="font-bold text-slate-700 block">取消時自動順延補排</span>
          <span className="text-[10px] text-slate-400 block">
            {noRegularRule
              ? '無固定時段可依循，取消課堂後不順延補排'
              : '取消課堂時，確認視窗預設建議順延補排 1 堂'}
          </span>
        </span>
        <span className={`shrink-0 relative inline-block w-8 h-[18px] rounded-full transition-colors ${autoRescheduleOnCancel ? 'bg-emerald-500' : 'bg-slate-300'}`}>
          <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${autoRescheduleOnCancel ? 'translate-x-3.5' : ''}`} />
        </span>
      </button>

      {noRegularRule ? (
        <p className="text-slate-400 text-center py-2 font-bold">無固定時間：不啟用自動排課，課堂請手動預約</p>
      ) : (
        <div className="space-y-2">
          <label className="font-bold text-slate-700 block">排課時段列表</label>
          {rules.map((r, index) => {
            const [hStr, mStr] = (r.time || '10:00').split(':');
            return (
              <div key={r.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 relative shadow-2xs">
                {rules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, rules: rules.filter((_, i) => i !== index) })}
                    className="absolute top-2 right-2 p-1 bg-white border border-slate-200 rounded text-slate-400 hover:text-rose-500 transition"
                    title="刪除時段"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}

                {/* 第一行：頻率、種類、教室 */}
                <div className="grid grid-cols-3 gap-1.5 [&>div]:min-w-0">
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">頻率</label>
                    <select value={r.freq} onChange={e => updateRule(index, { freq: e.target.value as StudentRule['freq'] })} className={fieldCls}>
                      <option value="每週">每週</option>
                      <option value="隔週">隔週</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">課程種類</label>
                    <select value={r.lessonType || '1v1'} onChange={e => updateRule(index, { lessonType: e.target.value as '1v1' | '1v2' })} className={fieldCls}>
                      <option value="1v1">1v1 單人</option>
                      <option value="1v2">1v2 雙人</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">指定教室</label>
                    <select value={r.roomType || 'small'} onChange={e => updateRule(index, { roomType: e.target.value as 'large' | 'small' })} className={fieldCls}>
                      <option value="small" disabled={r.lessonType === '1v2'}>🟢 小</option>
                      <option value="large">🟣 大</option>
                    </select>
                  </div>
                </div>

                {/* 第二行：星期、時、分 */}
                <div className="grid grid-cols-3 gap-2 [&>div]:min-w-0">
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">星期</label>
                    <select value={r.day} onChange={e => updateRule(index, { day: e.target.value as StudentRule['day'] })} className={fieldCls}>
                      {['一', '二', '三', '四', '五', '六', '日'].map(d => <option key={d} value={d}>週{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">時</label>
                    <select value={hStr} onChange={e => updateRule(index, { time: `${e.target.value}:${mStr}` })} className={`${fieldCls} font-mono`}>
                      {DAY_HOURS.map(h => <option key={h} value={pad(h)}>{pad(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">分</label>
                    <select value={mStr} onChange={e => updateRule(index, { time: `${hStr}:${e.target.value}` })} className={`${fieldCls} font-mono`}>
                      {BUSINESS_MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-600 text-[10px]">起始排課日</label>
                  <input type="date" value={r.startDate || today} onChange={e => updateRule(index, { startDate: e.target.value })} className={`${fieldCls} font-mono`} />
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => onChange({ ...value, rules: [...rules, createRule()] })}
            className="w-full border border-dashed border-slate-300 text-slate-500 font-bold py-2 rounded-xl hover:bg-slate-50 transition flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> 新增時段
          </button>
        </div>
      )}
    </div>
  );
}
