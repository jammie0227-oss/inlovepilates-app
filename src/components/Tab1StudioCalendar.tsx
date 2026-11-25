'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Lock, AlertTriangle } from 'lucide-react';
import { formatTimeStr, formatDateWithDay } from '../mockData';
import { TeacherProfile, BookingItem, StudentItem, ReviewItem } from '../mockData';
import type { BusinessHoursConfig } from '../types';
import { getStudentBookingPreset, isWithinBusinessHours, DEFAULT_BUSINESS_HOURS, getCalendarHours, isSlotReleased, isActionableBooking, getReviewHoldLabel } from '../utils/bookingRules';
import BookingEditModal, { BookingEditConfirmPayload } from './BookingEditModal';
import { systemAlert } from '../utils/systemAlert';

export default function Tab1StudioCalendar({
  systemBaseDate, 
  userRole, 
  currentUserId, 
  teachers, 
  students, 
  bookings, 
  reviews = [], 
  businessHours = DEFAULT_BUSINESS_HOURS,
  priorityGrid = {},
  showToast, 
  onSelectStudent,
  viewMode = 'day',
  setViewMode,
  openGlobalBooking,
  onExecuteReschedule
}: {
  systemBaseDate: string;
  businessHours?: BusinessHoursConfig;
  priorityGrid?: Record<string, { large?: string; small?: string }>;
  userRole: 'admin' | 'teacher'; 
  currentUserId: string; 
  teachers: Record<string, TeacherProfile>;
  students: StudentItem[]; 
  bookings: BookingItem[]; 
  reviews?: ReviewItem[]; 
  showToast: (msg: string) => void; 
  onSelectStudent: (name: string) => void;
  viewMode?: 'day' | 'week';
  setViewMode?: (mode: 'day' | 'week') => void;
  openGlobalBooking: (preset?: any) => void;
  /** 管理員直接變更其他老師課表（改期 / 改室 / 取消） */
  onExecuteReschedule?: (
    bookingId: string, newDate: string, newHour: number, newMin: number, newRoom: 'large' | 'small',
    isCancel?: boolean, newLessonType?: '1v1' | '1v2', reason?: string, autoSwaps?: any[]
  ) => void;
}) {
  const [localView, setLocalView] = useState<'week' | 'day'>('day');
  const view = viewMode || localView;
  const setView = setViewMode || setLocalView;

  const [dayOffset, setDayOffset] = useState(0); 

  // 1. 將 systemBaseDate 字串轉換為可運算的 Date 物件
  const [sysYear, sysMonth, sysDay] = systemBaseDate.split('-').map(Number);
  const baseDate = new Date(sysYear, sysMonth - 1, sysDay); // JavaScript 月份從 0 開始
  
  // 2. 依據使用者的位移 (dayOffset) 算出當前畫面的日期
  baseDate.setDate(baseDate.getDate() + dayOffset);
  const currentStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
  
  // 3. 動態判定：今天與過去，都以 systemBaseDate 為基準
  const isToday = currentStr === systemBaseDate;
  const isPastDate = currentStr < systemBaseDate;

  // 1. 課堂是否已被取消判定（一般取消、審核免罰取消、審核計罰取消，皆視為已釋出空位）
  // 課堂是否在排班總覽隱藏（釋出空位）：已取消 或 取消審核中，排班總覽一律不佔位，讓其他老師可直接預約
  // 例外：非營業時間預約待審 (after_hours) 與改室審核佔位 (isHold / roomChangePending) 要卡住時段，不可隱藏
  const isCancelledBooking = (b: BookingItem) => {
    if (isSlotReleased(b)) {
      return true;
    }
    const relatedRev = reviews.find(r => r.bookingId === b.id && r.status === 'pending');
    if (relatedRev && relatedRev.reviewType === 'cancel') {
      return true;
    }
    return false;
  };

  // 審核卡位卡片的標籤文字：「審核中（非營業時間）」/「改室審核中（原教室 ➔ 新教室）」
  const getReviewBadgeLabel = (b: BookingItem) => getReviewHoldLabel(b) || '審核中';
  const isHeldByReview = (b: BookingItem) =>
    !!b.isHold || !!b.roomChangePending || (b.status === 'special_pending' && b.pendingKind === 'after_hours');

  // 管理員點擊其他老師的預約卡片：直接開啟共用變更彈窗（改期 / 改室 / 取消）
  const [adminEditingBooking, setAdminEditingBooking] = useState<BookingItem | null>(null);
  const handleCardClick = (b: BookingItem, isMyStudentCard: boolean) => {
    if (isMyStudentCard) {
      onSelectStudent(b.studentName || '');
      return;
    }
    if (userRole !== 'admin') return;
    if (isHeldByReview(b)) {
      showToast('此課堂正在審核中，審核完成前無法異動');
      return;
    }
    if (!isActionableBooking(b)) {
      showToast('此課堂已簽到、已結算或已取消，無法再異動');
      return;
    }
    setAdminEditingBooking(b);
  };
  const handleAdminEditConfirm = (p: BookingEditConfirmPayload) => {
    if (!p.isCancel && p.notice) showToast(p.notice);
    onExecuteReschedule?.(p.bookingId, p.date, p.hour, p.min, p.roomType, p.isCancel, p.lessonType, p.reason, p.autoSwaps);
    setAdminEditingBooking(null);
  };

  // 2. 嚴格過濾：無論管理者 Daisy 還是任課老師，一律只抓取「自己名下」的有效學員
  const myStudents = useMemo(() => {
    return students.filter(s => s.teacherId === currentUserId && s.status === 'active');
  }, [students, currentUserId]);

  // 正式架構：直接向 teachers 物件讀取顏色，新增 100 位老師也完全不用改代碼！
  const getBookingStyle = (b: any) => {
    const isOwn = b.teacherId === currentUserId;
    const canView = userRole === 'admin' || isOwn;

    if (!canView) {
      // 一般老師看別人的課：保持灰色隱私遮罩
      return 'bg-slate-100 border border-slate-200 text-slate-500';
    }

    // 1. 動態從 props 傳進來的 teachers 字典抓取該老師的設定
    const t = teachers[b.teacherId];
    
    // 2. 如果資料庫有設定就用資料庫的，找不到才給預設值
    const bg = t?.bgLight || 'bg-slate-100';
    const text = t?.text || 'text-slate-900';
    // 實線邊框：取老師的主色 (例如 bg-sky-500 轉為 border-sky-500)
    const borderColor = t?.color ? t.color.replace('bg-', 'border-') : 'border-slate-500';

    // 3. 簽名實線判定
    if (b.signed) {
      return `${bg} ${text} border-b-[4px] ${borderColor} opacity-95`;
    }
    return `${bg} ${text} border border-transparent`;
  };
  // 非營業時間 / 公休日：淡灰斜線底
  const closedStyle = (dateStr: string, h: number): React.CSSProperties | undefined =>
    isWithinBusinessHours(dateStr, h, 0, businessHours, 60)
      ? undefined
      : { backgroundImage: 'repeating-linear-gradient(135deg, rgba(148,163,184,0.18) 0, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)', backgroundColor: 'rgba(241,245,249,0.7)' };

  const weekScrollRef = useRef<HTMLDivElement>(null);
  const dayScrollRef = useRef<HTMLDivElement>(null);

  // 營業時間 8:00 - 22:00 (共 14 小時，每小時 60px)
  const hours = getCalendarHours(businessHours, bookings);
  const minutes = ['00', '10', '20', '30', '40', '50'];

  const weekDays = useMemo(() => {
    const d = new Date(baseDate);
    const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
    d.setDate(d.getDate() - dayOfWeek + 1);
    return Array.from({ length: 7 }).map((_, i) => {
      const cur = new Date(d);
      cur.setDate(cur.getDate() + i);
      const str = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const dayIndex = cur.getDay() === 0 ? 7 : cur.getDay();
      return { 
        dateStr: str, 
        label: formatDateWithDay(str), 
        dayIndex,
        isPast: str < systemBaseDate,
        isToday: str === systemBaseDate,
      };
    });
  }, [baseDate]);

  // 週曆視圖切換水平滾動聚焦
  useEffect(() => {
    if (view === 'week' && weekScrollRef.current) {
      const dayIdx = baseDate.getDay() === 0 ? 7 : baseDate.getDay();
      if (dayIdx >= 3) {
        weekScrollRef.current.scrollTo({ left: (dayIdx - 1) * 130, behavior: 'smooth' });
      } else {
        weekScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    }
  }, [view, dayOffset]);

  // 日曆視圖：自動向下滾動至老師第一堂課的起始時間
  useEffect(() => {
    if (view === 'day' && dayScrollRef.current) {
      const dayBookings = bookings.filter(b => 
        b.date === currentStr && 
        b.status !== 'cancelled_normal' &&
        (userRole === 'admin' ? true : b.teacherId === currentUserId)
      );

      if (dayBookings.length > 0) {
        const earliestMins = Math.min(...dayBookings.map(b => b.startHour * 60 + b.startMin));
        // 每分鐘 1px (60px/hr)，距離 8:00 (480 mins) 的距離
        const scrollTarget = Math.max(0, earliestMins - 480);
        dayScrollRef.current.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      } else {
        // 當天無課程時預設置頂 8:00
        dayScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [view, currentStr, bookings, currentUserId, userRole]);

  // 1v2 小教室衝突提醒
  const alert1v2Bookings = useMemo(() => {
    return bookings.filter(b => {
      if (isSlotReleased(b) || b.isHold) return false;
      if (b.lessonType !== '1v2' || b.roomType !== 'small') return false;
      if (view === 'day') return b.date === currentStr;
      return weekDays.some(w => w.dateStr === b.date);
    });
  }, [bookings, view, currentStr, weekDays]);

  const handleQuickBook = async (h: number, m: string, room: string, date: string) => {
    // 檢查是否為過去時段（基於全域基準日 systemBaseDate）：一般老師直接擋下，管理員需二次確認
    if (date < systemBaseDate && userRole !== 'admin') {
      return systemAlert('一般老師不可預約過去的日期，如需補排請聯絡管理員');
    }
    // 管理員補排過去時段：預約彈窗內會即時顯示紅字提醒，不再另跳確認窗
    if (myStudents.length === 0) return systemAlert('您名下目前無有效學員，無法進行預約');

    const targetStudent = myStudents[0];
    const preset = getStudentBookingPreset(targetStudent, userRole);
    openGlobalBooking({ 
      date, 
      hour: String(h), 
      minute: m, 
      roomType: room as any, 
      studentName: targetStudent.name, 
      lessonType: preset.lessonType 
    });
  };
  
  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2 pb-1">
      
      {/* 日期時間切換列：< 10/24(六) > */}
      <div className="flex items-center justify-between bg-white px-3 py-1.5 rounded-2xl border border-slate-200 shadow-2xs text-xs shrink-0">
        <button 
          onClick={() => setDayOffset(d => view === 'day' ? d - 1 : d - 7)} 
          className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition"
          title="上一日 / 上一週"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          {view === 'day' ? (
            <span className={`text-xs font-black font-mono px-3 py-1 rounded-xl transition ${
              isToday 
                ? 'bg-rose-50 text-rose-600 border border-rose-300 ring-2 ring-rose-100 shadow-xs' 
                : isPastDate 
                  ? 'text-slate-400 bg-slate-100/80 border border-slate-200' 
                  : 'text-slate-800 bg-slate-50 border border-slate-200 shadow-2xs'
            }`}>
              {formatDateWithDay(currentStr)}
            </span>
          ) : (
            <span className="text-xs font-black font-mono px-3 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 shadow-2xs">
              {formatDateWithDay(weekDays[0].dateStr)} ~ {formatDateWithDay(weekDays[6].dateStr)}
            </span>
          )}
        </div>

        <button 
          onClick={() => setDayOffset(d => view === 'day' ? d + 1 : d + 7)} 
          className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition"
          title="下一日 / 下一週"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 1v2 小教室醒目警示橫條 */}
      {alert1v2Bookings.length > 0 && (
        <div className="bg-rose-50 border-2 border-rose-400 px-3 py-2 rounded-2xl text-rose-900 text-xs font-bold flex items-center justify-between shrink-0 animate-in fade-in shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 animate-bounce" />
            <span>
              注意：目前有 {alert1v2Bookings.length} 堂 1v2 課程排在小教室！請 {teachers[alert1v2Bookings[0].teacherId]?.name || '任課'} 老師注意器械空間或申請調度。
            </span>
          </div>
          <span className="text-[10px] bg-rose-200 text-rose-900 px-2 py-0.5 rounded-lg font-mono font-black shrink-0">
            {formatDateWithDay(alert1v2Bookings[0].date)} {formatTimeStr(alert1v2Bookings[0].startHour, alert1v2Bookings[0].startMin)}
          </span>
        </div>
      )}

      {/* 日曆檢視 (間隔緊湊化為 60px/hr，自動滑動至第一堂課) */}
      {view === 'day' && (
        <div className={`flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden ${
          isPastDate ? 'grayscale opacity-75 bg-slate-100/70' : ''
        }`}>
          <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 text-xs font-black text-slate-700 text-center py-2 shrink-0 sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <span className="col-span-2 border-r border-slate-200 font-mono">時間</span>
            <span className="col-span-5 border-r border-slate-200 text-purple-700">🏛️ 大教室</span>
            <span className="col-span-5 text-emerald-700">🧘 小教室</span>
          </div>
          
          <div ref={dayScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth">
            <div className="grid grid-cols-12 text-xs relative w-full">
              {/* 時間軸 */}
              <div className="col-span-2 bg-slate-50/95 border-r border-slate-200 flex flex-col font-mono text-slate-500 font-bold select-none">
                {hours.map(h => (
                  <div key={h} className="h-[60px] flex items-center justify-center border-b border-slate-200 text-xs">
                    {h}
                  </div>
                ))}
              </div>

              {/* 大 / 小 教室 */}
              {['large', 'small'].map((room, idx) => (
                <div key={room} className={`col-span-5 relative ${idx === 0 ? 'border-r border-slate-200' : ''}`} style={{ height: hours.length * 60 }}>
                  {hours.map(h => (
                    <div key={h} style={closedStyle(currentStr, h)} className="h-[60px] flex flex-col border-b border-slate-200">
                      {minutes.map(m => (
                        <button key={m} onClick={() => handleQuickBook(h, m, room, currentStr)} className="h-[10px] border-b border-dotted border-slate-100/60 hover:bg-rose-50/60 transition w-full" />
                      ))}
                    </div>
                  ))}
                  
                  {bookings.filter(b => b.date === currentStr && b.roomType === room && !isCancelledBooking(b)).map(b => {
                    const top = ((b.startHour - hours[0]) * 60 + b.startMin);
                    const isMyStudentCard = b.teacherId === currentUserId;
                    const canSeeDetails = userRole === 'admin' || isMyStudentCard;
                    const is1v2InSmall = b.lessonType === '1v2' && b.roomType === 'small';
                    const isPendingReview = isHeldByReview(b);

                    return (
                      <div 
                        key={b.id} 
                        onClick={() => handleCardClick(b, isMyStudentCard)} 
                        title={isPendingReview ? getReviewBadgeLabel(b) : undefined}
                        style={{ top: `${top}px`, height: `${b.durationMins || 50}px` }} 
                        className={`absolute inset-x-1 z-10 rounded-lg p-1 flex flex-col justify-center shadow-2xs select-none transition ${
                          isMyStudentCard || userRole === 'admin' ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default'
                        } ${
                          isPendingReview 
                            ? 'bg-amber-50/95 border-2 border-dashed border-amber-400 text-amber-950' 
                            : getBookingStyle(b)
                        } ${
                          is1v2InSmall ? 'border-2 border-rose-500 ring-2 ring-rose-200 shadow-md animate-pulse' : ''
                        }`}
                      >
                        {isPendingReview && (
                          <span className="self-start max-w-full text-[8px] leading-[10px] bg-amber-500 text-white font-black px-1 py-px rounded shadow-2xs break-words mb-0.5">
                            {getReviewBadgeLabel(b)}
                          </span>
                        )}

                        {is1v2InSmall && !isPendingReview && (
                          <div className="absolute top-0.5 right-1 flex items-center gap-1">
                            <span className="text-[8px] bg-rose-600 text-white px-1 rounded font-bold">1v2 小教室</span>
                            <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                          </div>
                        )}

                        {canSeeDetails ? (
                          <>
                            <div className="text-xs font-black truncate">{b.studentName}</div>
                            <div className="text-[10px] font-bold opacity-90 leading-tight mt-0.5">
                              {formatTimeStr(b.startHour, b.startMin)} <span className="bg-white/60 px-1 rounded ml-0.5 text-slate-800">{b.lessonType}</span>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-center font-bold text-[11px] gap-1 font-mono opacity-80">
                            <Lock className="w-3 h-3 shrink-0" />
                            <span>{b.lessonType}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 週曆檢視 */}
      {view === 'week' && (
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden relative">
          <div ref={weekScrollRef} className="flex-1 overflow-x-auto overflow-y-auto relative scroll-smooth">
            <div className="min-w-[960px] relative">
              <div className="grid grid-cols-[54px_repeat(7,minmax(130px,1fr))] border-b border-slate-200 text-center text-xs font-bold bg-slate-50 py-2 divide-x divide-slate-200 shrink-0 sticky top-0 z-40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="text-slate-400 font-mono flex items-center justify-center sticky left-0 top-0 bg-slate-50 z-50 border-r border-slate-200 shadow-[1px_0_2px_rgba(0,0,0,0.05)]">時</div>
                {weekDays.map((item, idx) => (
                  <div key={idx} className={`px-1 py-0.5 ${
                    item.isToday 
                      ? 'bg-rose-50/80 text-rose-600 font-black' 
                      : item.isPast 
                        ? 'text-slate-400' 
                        : 'text-slate-700'
                  }`}>
                    <div className="flex items-center justify-center gap-1">
                      <span>{item.label}</span>
                      {item.isToday && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
                    </div>
                    <div className="grid grid-cols-2 text-[10px] text-slate-400 font-medium pt-0.5 border-t border-slate-200/60 mt-0.5"><span>大</span><span>小</span></div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-[54px_repeat(7,minmax(130px,1fr))] divide-x divide-slate-200 text-xs font-mono relative">
                <div className="text-slate-500 bg-slate-50/95 font-bold flex flex-col divide-y divide-slate-200 select-none sticky left-0 z-30 border-r border-slate-200 shadow-[2px_0_4px_rgba(0,0,0,0.04)]">
                  {hours.map(h => <div key={h} className="h-[60px] flex items-center justify-center text-sm">{h}</div>)}
                </div>

                {weekDays.map((item, dIdx) => (
                  <div key={dIdx} className={`grid grid-cols-2 gap-0.5 p-0.5 relative ${
                    item.isPast ? 'bg-slate-100/70 grayscale opacity-80' : 'bg-slate-50/10'
                  }`}>
                    {['large', 'small'].map(room => (
                      <div key={room} className="relative" style={{ height: hours.length * 60 }}>
                        {hours.map(h => (
                          <div key={h} style={closedStyle(item.dateStr, h)} className="h-[60px] flex flex-col border-b border-slate-200">
                            {minutes.map(m => (
                              <button key={m} onClick={() => handleQuickBook(h, m, room, item.dateStr)} className="h-[10px] border-b border-dotted border-slate-100/60 hover:bg-rose-50/60 transition w-full" />
                            ))}
                          </div>
                        ))}

                        {bookings.filter(b => b.date === item.dateStr && b.roomType === room && !isCancelledBooking(b)).map(b => {
                          const top = ((b.startHour - hours[0]) * 60 + b.startMin);
                          const isMyStudentCard = b.teacherId === currentUserId;
                          const canSeeDetails = userRole === 'admin' || isMyStudentCard;
                          const is1v2InSmall = b.lessonType === '1v2' && b.roomType === 'small';
                          const isPendingReview = isHeldByReview(b);

                          return (
                            <div 
                              key={b.id} 
                              onClick={() => handleCardClick(b, isMyStudentCard)} 
                              title={isPendingReview ? getReviewBadgeLabel(b) : undefined}
                              style={{ top: `${top}px`, height: `${b.durationMins || 50}px` }} 
                              className={`absolute inset-x-0.5 z-10 rounded p-1 flex flex-col justify-center shadow-2xs select-none transition ${
                                isMyStudentCard || userRole === 'admin' ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-default'
                              } ${
                                isPendingReview 
                                  ? 'bg-amber-50/95 border border-dashed border-amber-400 text-amber-950' 
                                  : getBookingStyle(b)
                              } ${
                                is1v2InSmall ? 'border border-rose-500 animate-pulse ring-1 ring-rose-300' : ''
                              }`}
                            >
                              {isPendingReview ? (
                                <span className="text-[8px] leading-[9px] bg-amber-500 text-white font-black px-1 py-px rounded text-center self-center mb-0.5 break-words max-w-full">
                                  {getReviewBadgeLabel(b)}
                                </span>
                              ) : is1v2InSmall ? (
                                <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-rose-500 rounded-full animate-ping shadow-sm" />
                              ) : null}

                              {canSeeDetails ? (
                                <>
                                  <span className="text-xs font-black truncate text-center">
                                    {b.studentName}
                                  </span>
                                  <span className="text-[10px] font-mono text-center font-bold mt-0.5">
                                    {b.lessonType}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[10px] font-mono font-bold text-center flex items-center justify-center gap-0.5 opacity-80">
                                  <Lock className="w-2.5 h-2.5 shrink-0" />
                                  <span>{b.lessonType}</span>
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 管理員直接變更一般老師課表（共用變更 / 取消彈窗） */}
      {userRole === 'admin' && (
        <BookingEditModal
          booking={adminEditingBooking}
          userRole={userRole}
          systemBaseDate={systemBaseDate}
          bookings={bookings}
          businessHours={businessHours}
          priorityGrid={priorityGrid}
          teachers={teachers}
          students={students}
          onClose={() => setAdminEditingBooking(null)}
          onConfirm={handleAdminEditConfirm}
        />
      )}

    </div>
  );
}