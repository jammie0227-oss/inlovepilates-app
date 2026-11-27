'use client';
import React from 'react';
import { Edit3, PenTool } from 'lucide-react';
import { formatTimeStr, formatDateWithDay } from '../mockData';
import type { BookingItem } from '../types';
import {
  REVIEW_TAG,
  classifyBookingLifecycle,
  getBookingTimeLines,
  getSignatureWindowStatus,
  isPendingApproval,
} from '../utils/bookingRules';
import { BookingStatusBadge } from './SignatureModals';
import { NoticeText, RoomDot } from './RoomDot';

export interface BookingRecordCardProps {
  booking: BookingItem;
  /** 現在時間（useNow），決定課堂歸屬與簽名鈕文字 */
  now: Date;
  /** 日期時間後方顯示學生姓名（個人課表）；學員詳情頁不需要。課程類別一律顯示 */
  showStudentName?: boolean;
  onUpdateNote: (bookingId: string, note: string) => void;
  onClick?: () => void;
  /** 以下操作鈕僅出現在尚未簽到、未取消的課堂；未傳入者不顯示 */
  onSystemSign?: (booking: BookingItem) => void;
  onEdit?: (booking: BookingItem) => void;
  onSign?: (booking: BookingItem) => void;
  onZoomSignature?: (data: { url: string; time: string }) => void;
  className?: string;
}

const tagCls = 'shrink-0 whitespace-nowrap text-[10px] border px-1.5 py-0.5 rounded-full font-black';

/**
 * 全站共用課堂紀錄卡片：標題、狀態標籤與操作鈕 → 異動 / 處理時間 → 上課狀況筆記。
 * 版型依 classifyBookingLifecycle 自動決定（upcoming / overdue / history）。
 */
export default function BookingRecordCard({
  booking: b,
  now,
  showStudentName = false,
  onUpdateNote,
  onClick,
  onSystemSign,
  onEdit,
  onSign,
  onZoomSignature,
  className = '',
}: BookingRecordCardProps) {
  const lifecycle = classifyBookingLifecycle(b, now);
  const isHistory = lifecycle === 'history';
  const isPending = isPendingApproval(b);
  const timeLines = getBookingTimeLines(b);
  // 非優先審核中不可改期：只有一顆「取消」
  const showEdit = !!onEdit && !isPending;
  const showCancel = !!onEdit && isPending;
  const secondaryCls = 'px-2.5 py-1 rounded-xl text-[11px] font-bold border transition';

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-2xl border space-y-2 text-xs text-slate-600 shadow-2xs transition ${
        lifecycle === 'overdue' ? 'bg-white border-amber-200' : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* 第一行：標題與狀態 */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <RoomDot room={b.roomType} />
          <span className="font-black text-slate-800 font-mono text-sm">
            {formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}
          </span>
          {showStudentName && (
            <span className="font-black text-slate-900 text-sm">{b.studentName}</span>
          )}
          <span className="text-slate-400 font-bold text-[11px]">({b.lessonType})</span>
          {b.rescheduledInfo && <span className={`${tagCls} bg-sky-100 text-sky-800 border-sky-300`}>改期</span>}
          {!isHistory && isPending && <span className={`${tagCls} bg-amber-100 text-amber-800 border-amber-300`}>{REVIEW_TAG}</span>}
        </div>
        {/* 靠右：歷史卡片為最終狀態標籤＋簽名縮圖；其餘為操作鈕（簽名 / 補簽固定最右） */}
        {isHistory && (
          <div className="shrink-0 ml-auto">
            <BookingStatusBadge booking={b} onZoomSignature={onZoomSignature} hideProcessedTime />
          </div>
        )}
        {!isHistory && (
          <div className="flex items-center gap-1.5 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
            {onSystemSign && (
              <button type="button" onClick={() => onSystemSign(b)} title="系統代簽（扣 1 堂）" className={`${secondaryCls} border-amber-300 bg-white text-amber-700 hover:bg-amber-50`}>系統代簽</button>
            )}
            {showEdit && (
              <button type="button" onClick={() => onEdit?.(b)} className={`${secondaryCls} border-slate-200 bg-white hover:bg-slate-50`}>變更</button>
            )}
            {showCancel && (
              <button type="button" onClick={() => onEdit?.(b)} className={`${secondaryCls} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}>取消</button>
            )}
            {/* 非優先審核中同樣保留簽名（現場緊急情況保險），時間窗由簽名彈窗把關 */}
            {onSign && (
              <button
                type="button"
                onClick={() => onSign(b)}
                className={`text-white text-[11px] font-black px-3 py-1 rounded-xl flex items-center gap-1 shadow-xs transition ${
                  lifecycle === 'overdue' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-rose-500 hover:bg-rose-600'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" /> {getSignatureWindowStatus(b, now) === 'late_over_1h' ? '補簽' : '簽名'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 第二行：異動 / 處理時間 */}
      {timeLines.length > 0 && (
        <div className="text-[11px] font-bold text-slate-500 space-y-0.5">
          {timeLines.map(line => <p key={line}><NoticeText text={line} /></p>)}
        </div>
      )}

      {/* 第三行：上課狀況筆記 */}
      <div className="relative" onClick={e => e.stopPropagation()}>
        {/* 個人課表與學員詳情頁同時掛載：key 讓輸入框跟隨另一頁的修改，未改動時不寫入 */}
        <input
          key={b.teacherNote || ''}
          type="text"
          defaultValue={b.teacherNote || ''}
          onBlur={e => {
            if (e.target.value !== (b.teacherNote || '')) onUpdateNote(b.id, e.target.value);
          }}
          placeholder={isHistory ? '歷史上課狀況筆記...' : '填寫上課狀況備註 (點擊外側自動儲存)...'}
          className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-slate-700 outline-none focus:ring-1 focus:ring-rose-400 transition"
        />
        <Edit3 className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}
