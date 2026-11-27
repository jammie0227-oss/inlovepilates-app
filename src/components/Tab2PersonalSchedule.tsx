'use client';
import React, { useState, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { formatTimeStr, formatDateWithDay, formatLocalDate, getDayOfWeek, getExactTimestamp } from '../mockData';
import { CanvasPadModal, SignatureZoomModal } from './SignatureModals';
import BookingRecordCard from './BookingRecordCard';
import OverdueSettlementList from './OverdueSettlementList';
import BookingEditModal from './BookingEditModal';
import { classifyBookingLifecycle, isSlotReleased, DAY_HOURS, isPendingApproval, REVIEW_TAG, compareByStart } from '../utils/bookingRules';
import { useBookingEditor } from '../utils/useBookingEditor';
import { useCalendarAutoScroll } from '../utils/useCalendarAutoScroll';
import { useNow } from '../utils/useToday';

export default function Tab2PersonalSchedule({
  today,
  userRole, 
  currentUserId, 
  teachers, 
  bookings, 
  isActive = true,
  onSettle,
  priorityGrid,
  onExecuteReschedule,
  students, 
  onSign, 
  onUpdateBookingNote, 
  showToast, 
  onSelectStudent,
  viewMode = 'day',
  setViewMode,
  openGlobalBooking
}: any) {
  const [localView, setLocalView] = useState<'month' | 'week' | 'day'>('day');
  const view = viewMode || localView;
  const setView = setViewMode || setLocalView;

  // 目前瀏覽的日期（日 / 週 / 月共用，切換視圖不跳日期）；null = 跟著今天
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  // 1. 解析今天的日期
  const [sysYear, sysMonth, sysDay] = today.split('-').map(Number);
  const todayDateObj = new Date(sysYear, sysMonth - 1, sysDay);
  const lastDayOfMonth = new Date(sysYear, sysMonth, 0).getDate();
  const isLast5Days = (lastDayOfMonth - todayDateObj.getDate()) < 5;

  // 變更 / 取消 預約彈窗
  const editor = useBookingEditor(onExecuteReschedule);

  const [activeSignModal, setActiveSignModal] = useState<{ id: string; studentName: string } | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; time: string } | null>(null);

  const weekVerticalScrollRef = useRef<HTMLDivElement>(null);

  
  // 2. 建立目前瀏覽日期的運算物件
  const [baseYear, baseMonth, baseDay] = (pickedDate ?? today).split('-').map(Number);
  const baseDate = new Date(baseYear, baseMonth - 1, baseDay);

  const currentStr = formatLocalDate(baseDate);
  const isToday = currentStr === today;
  const isPast = currentStr < today;

  const hours = DAY_HOURS;

  /** 前後翻頁：依目前視圖移動一日 / 一週 / 一月 */
  const shiftDate = (dir: 1 | -1) => {
    const d = new Date(baseDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir, 1);
    else d.setDate(d.getDate() + dir * (view === 'week' ? 7 : 1));
    const key = formatLocalDate(d);
    const backToNow = view === 'month' ? key.slice(0, 7) === today.slice(0, 7) : key === today;
    setPickedDate(backToNow ? null : key);
  };

  // 週曆 7 天日期生成
  const weekDays = useMemo(() => {
    const d = new Date(baseDate);
    const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
    d.setDate(d.getDate() - dayOfWeek + 1);
    return Array.from({ length: 7 }).map((_, i) => {
      const cur = new Date(d);
      cur.setDate(cur.getDate() + i);
      const str = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const m = cur.getMonth() + 1;
      const dateNum = cur.getDate();
      const dayName = getDayOfWeek(str);
      return {
        dateStr: str,
        shortDate: `${m}/${dateNum}`,
        dayName: `(${dayName})`,
        isPast: str < today,
        isToday: str === today
      };
    });
  }, [baseDate, today]);

  // 非優先審核中的課堂沿用教室顏色，僅多掛這個文字標籤
  const reviewTagLabel = (b: any): string | null => (isPendingApproval(b) ? REVIEW_TAG : null);

  // 個人名下所有課程
  const myBookings = useMemo(() => {
    return bookings.filter((b: any) => b.teacherId === currentUserId);
  }, [bookings, currentUserId]);

  // 課堂歸屬一律由 classifyBookingLifecycle 判定
  const now = useNow();
  // 個人課表一律只看「自己」的課堂；逾期清單涵蓋全部日期
  const myOverdueBookings = useMemo(
    () => myBookings.filter((b: any) => classifyBookingLifecycle(b, now) === 'overdue').sort(compareByStart),
    [myBookings, now],
  );

    // 個人課表專用樣式引擎 (依據教室給予明顯顏色、動態粗細與過去時間遮罩)
  const getPersonalBookingStyle = (b: any, viewType: 'month' | 'week' | 'day') => {
    const isLarge = b.roomType === 'large';
    const isPast = b.date < today;

    // 1. 教室代表底色：過去時間採用半透明 (/60)，未來維持實色
    const bg = isLarge 
      ? (isPast ? 'bg-purple-100/60' : 'bg-purple-300') 
      : (isPast ? 'bg-emerald-100/60' : 'bg-emerald-300');

    // 2. 文字顏色：過去時間稍降深淺度，但維持文字可讀性
    const text = isLarge 
      ? (isPast ? 'text-purple-800/80' : 'text-purple-900') 
      : (isPast ? 'text-emerald-800/80' : 'text-emerald-900');

    // 3. 邊框顏色：大教室實體紫線、小教室實體綠線
    const border = isLarge ? 'border-purple-500' : 'border-emerald-500';

    // 4. 簽名實線：若是過去已簽到，線條維持 100% 老師/教室代表色，絕對不退化成灰色
    const lineStyle = b.signed 
      ? (viewType === 'month' ? `border-b-2 ${border}` : `border-b-[2px] ${border}`) 
      : 'border border-transparent';

    const pastOpacity = isPast ? 'opacity-50' : 'opacity-100';
    return `${bg} ${text} ${lineStyle} ${pastOpacity}`;
  };
  const upcomingBookingsForDay = useMemo(
    () => myBookings
      .filter((b: any) => b.date === currentStr && classifyBookingLifecycle(b, now) === 'upcoming')
      .sort(compareByStart),
    [myBookings, currentStr, now],
  );

  const historyBookingsForDay = useMemo(
    () => myBookings
      .filter((b: any) => b.date === currentStr && classifyBookingLifecycle(b, now) === 'history')
      .sort((a: any, b: any) => compareByStart(b, a)), // 最新在上
    [myBookings, currentStr, now],
  );

  const overdueCountForDay = myOverdueBookings.filter((b: any) => b.date === currentStr).length;
  // 瀏覽日有逾期課堂、或逾期學員在瀏覽日另有排課時，自動展開提醒
  const autoExpandOverdue = overdueCountForDay > 0 || myOverdueBookings.some((ob: any) =>
    upcomingBookingsForDay.some((ub: any) => ub.studentId === ob.studentId)
  );

  const openSignModal = (b: any) => setActiveSignModal({ id: b.id, studentName: b.studentName || '學員' });

  // 週曆：自動捲動到當週第一堂課（管理員看全館、老師看自己；無課則 09:00）
  useCalendarAutoScroll({
    ref: weekVerticalScrollRef, enabled: isActive && view === 'week', dates: weekDays.map(w => w.dateStr),
    bookings, userRole, currentUserId,
  });

  return (
    <div className="space-y-2.5 h-full flex flex-col pb-6">
      {/* 日期導航列 */}
      <div className="flex items-center justify-between bg-white px-3 py-1.5 rounded-2xl border border-slate-200 shadow-2xs text-xs shrink-0">
        <button 
          onClick={() => shiftDate(-1)} 
          className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition"
          title="前一日 / 前一週 / 前一月"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          {view === 'month' ? (
            <span className="text-xs font-black font-mono px-3 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 shadow-2xs">
              {baseDate.getFullYear()} 年 {baseDate.getMonth() + 1} 月
            </span>
          ) : view === 'week' ? (
            <span className="text-xs font-black font-mono px-3 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 shadow-2xs">
              {weekDays[0].shortDate}{weekDays[0].dayName} ~ {weekDays[6].shortDate}{weekDays[6].dayName}
            </span>
          ) : (
            <span className={`text-xs font-black font-mono px-3 py-1 rounded-xl transition ${
              isToday 
                ? 'bg-rose-50 text-rose-600 border border-rose-300 ring-2 ring-rose-100 shadow-xs' 
                : isPast 
                  ? 'text-slate-400 bg-slate-100/80 border border-slate-200' 
                  : 'text-slate-800 bg-slate-50 border border-slate-200 shadow-2xs'
            }`}>
              {formatDateWithDay(currentStr)}
            </span>
          )}
        </div>

        <button 
          onClick={() => shiftDate(1)} 
          className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition"
          title="後一日 / 後一週 / 後一月"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 逾期未處理（僅日視圖顯示；以 hidden 保留手動展開 / 收合狀態） */}
      <OverdueSettlementList
        className={view === 'day' ? 'shrink-0' : 'hidden'}
        bookings={myOverdueBookings}
        now={now}
        userRole={userRole}
        currentUserId={currentUserId}
        collapsible
        scrollable
        defaultExpanded={autoExpandOverdue}
        resetKey={currentStr}
        emphasize={isLast5Days}
        onSettle={onSettle}
        onSign={openSignModal}
        onEdit={editor.openEdit}
        onUpdateNote={onUpdateBookingNote}
        onClickBooking={b => onSelectStudent(b.studentId)}
      />

      {/* 日曆檢視 */}
      {view === 'day' && (
        <div className={`flex-1 min-h-[260px] overflow-y-auto bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5 scroll-smooth ${
          isPast ? 'bg-slate-100/70 grayscale' : ''
        }`}>
          {/* 過去日期不會有「即將上課」的課堂 */}
          {!isPast && (
            <div className="space-y-2.5">
              <p className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-sky-600" /> 即將上課
              </p>
              {upcomingBookingsForDay.map((b: any) => (
                <BookingRecordCard
                  key={b.id}
                  booking={b}
                  now={now}
                  showStudentName
                  onClick={() => onSelectStudent(b.studentId)}
                  onUpdateNote={onUpdateBookingNote}
                  onSign={openSignModal}
                  onEdit={editor.openEdit}
                />
              ))}
              {upcomingBookingsForDay.length === 0 && <p className="text-center text-slate-400 text-xs py-4 font-bold">本日無即將上課的課程</p>}
            </div>
          )}
          {overdueCountForDay > 0 && (
            <p className="text-center text-amber-700 text-[11px] font-bold">本日有 {overdueCountForDay} 堂逾期未處理，請見上方「逾期未處理」</p>
          )}

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
            <div className="relative flex justify-center text-[10px]">
              <span className="bg-white px-3 font-bold text-slate-400">
                本日歷史紀錄（{formatDateWithDay(currentStr)}）
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {historyBookingsForDay.length === 0 && (
              <p className="text-center text-slate-300 text-xs py-3 font-bold">本日尚無歷史上課或取消紀錄</p>
            )}
            {historyBookingsForDay.map((b: any) => (
              <BookingRecordCard
                key={b.id}
                booking={b}
                now={now}
                showStudentName
                onClick={() => onSelectStudent(b.studentId)}
                onUpdateNote={onUpdateBookingNote}
                onZoomSignature={setZoomedImage}
              />
            ))}
          </div>
        </div>
      )}

      {/* 月曆檢視 */}
      {view === 'month' && (
        <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-xs font-black text-slate-500 text-center py-2 sticky top-0 z-10">
            <span className="text-rose-500">日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span className="text-indigo-500">六</span>
          </div>
          <div className="grid grid-cols-7 text-xs font-mono">
            {/* 依該月第一天的星期補齊前置空格 */}
            {Array.from({ length: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1).getDay() }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[75px] border-r border-b border-slate-100 bg-slate-50/40" />
            ))}
            {Array.from({ length: new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate() }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayBks = myBookings.filter((b: any) => b.date === dateStr && !isSlotReleased(b)).sort(compareByStart);
              const isMonthToday = dateStr === today;
              const isMonthPast = dateStr < today;

              return (
                <div key={i} className={`min-h-[75px] min-w-0 overflow-hidden border-r border-b border-slate-100 p-1 flex flex-col gap-0.5 transition ${
                  isMonthPast ? 'bg-slate-20/40' : 'bg-white'
                }`}>
                  <span className={`text-[11px] font-bold text-right mb-0.5 ${
                    isMonthToday ? 'text-rose-600 font-black' : isMonthPast ? 'text-slate-300' : 'text-slate-400'
                  }`}>
                    {dayNum}
                  </span>
                  {dayBks.map((b: any) => {
                    const tagLabel = reviewTagLabel(b);
                    return (
                      <div 
                        key={b.id} 
                        onClick={() => onSelectStudent(b.studentId)} 
                        className={`text-[11px] truncate py-0.5 rounded shadow-2xs cursor-pointer hover:scale-[1.02] transition-transform ${tagLabel ? 'px-0.5' : 'px-px md:px-1.5'} ${getPersonalBookingStyle(b, 'month')}`}
                        title={`${b.studentName} (${b.roomType === 'large' ? '大教室' : '小教室'})${tagLabel ? `｜${tagLabel}` : ''}`}
                      >
                        {b.studentName}
                        {tagLabel && (
                          <span className="block whitespace-normal break-words text-balance text-center text-[8px] leading-[10px] tracking-tighter font-sans font-black bg-amber-500 text-white rounded">{tagLabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 週曆檢視 */}
      {view === 'week' && (
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden relative">
          {/* 表頭與時段格置於同一個垂直捲動容器：兩者可用寬度相同（捲軸不會造成欄位偏移） */}
          <div ref={weekVerticalScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
            <div className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] border-b border-slate-200 text-center text-xs font-bold bg-slate-50 py-1.5 divide-x divide-slate-200 sticky top-0 z-30">
              <div className="text-slate-400 font-mono flex items-center justify-center text-[10px]">時</div>
              {weekDays.map((item, idx) => (
                <div key={idx} className={`px-0.5 py-0.5 flex flex-col items-center justify-center leading-tight ${
                  item.isToday 
                    ? 'bg-rose-50/80 text-rose-600 font-black' 
                    : item.isPast 
                      ? 'text-slate-400' 
                      : 'text-slate-700'
                }`}>
                  <span className="text-[10px] font-mono leading-none">{item.shortDate}</span>
                  <span className="text-[10px] font-sans leading-none mt-0.5">{item.dayName}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] divide-x divide-slate-200 text-xs font-mono relative w-full">
              <div className="text-slate-500 bg-slate-50/95 font-bold flex flex-col divide-y divide-slate-100 select-none sticky left-0 z-20">
                {hours.map(h => (
                  <div key={h} className="h-[60px] flex items-center justify-center text-[11px]">
                    {h}
                  </div>
                ))}
              </div>

              {weekDays.map((item, dIdx) => (
                <div key={dIdx} className={`relative ${item.isPast ? 'bg-slate-50/50' : 'bg-white'}`}>
                  {hours.map(h => (
                    <div 
                      key={h} 
                      onClick={() => {
                        // 點擊空白處：統一呼叫全域預約入口，帶入該日期與整點
                        openGlobalBooking({ date: item.dateStr, hour: String(h).padStart(2, '0') });
                      }}
                      className="h-[60px] border-b border-slate-100 border-dotted cursor-pointer hover:bg-slate-50 transition relative" 
                    />
                  ))}
                  {myBookings.filter((b: any) => b.date === item.dateStr && !isSlotReleased(b)).map((b: any) => {
                    const top = (b.startHour - hours[0]) * 60 + b.startMin;
                    const tagLabel = reviewTagLabel(b);
                    return (
                      <div
                        key={b.id}
                        onClick={() => onSelectStudent(b.studentId)}
                        title={tagLabel ? `${b.studentName}｜${tagLabel}` : undefined}
                        style={{ top: `${top}px`, height: `48px` }}
                        className={`absolute inset-x-0.5 z-10 rounded ${tagLabel ? 'p-px overflow-hidden' : 'px-px py-1 md:px-1'} flex flex-col justify-center cursor-pointer shadow-2xs select-none transition hover:scale-[1.02] ${getPersonalBookingStyle(b, 'week')}`}
                      >
                        <span className={`${tagLabel ? 'text-[10px] leading-[12px]' : 'text-[11px] md:text-[12px] leading-tight'} font-black truncate text-center`}>{b.studentName}</span>
                        <span className={`text-[10px] font-mono opacity-80 text-center ${tagLabel ? 'leading-[11px]' : 'leading-tight mt-0.5'}`}>{formatTimeStr(b.startHour, b.startMin)}</span>
                        {tagLabel && (
                          <span className="text-[8px] leading-[9px] tracking-tighter font-sans font-black bg-amber-500 text-white rounded text-center break-words text-balance">{tagLabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* 底部留白：23:00 可捲到身分切換浮鈕上方 */}
            <div className="h-10" />
          </div>
        </div>
      )}

      {/* 變更 / 取消 預約 Modal (共用元件) */}
      <BookingEditModal
        {...editor.modalProps}
        userRole={userRole}
        today={today}
        bookings={bookings}
        priorityGrid={priorityGrid}
        teachers={teachers}
        students={students}
        currentUserId={currentUserId}
      />

      {/* 共用手寫簽名彈窗（自動判定一般簽到 vs 逾期補簽） */}
      <CanvasPadModal
        signModalTarget={activeSignModal}
        bookings={bookings}
        onClose={() => setActiveSignModal(null)}
        onSign={onSign}
        getExactTimestamp={getExactTimestamp}
      />

      {/* 共用放大簽名存根彈窗 */}
      <SignatureZoomModal
        zoomedSignature={zoomedImage}
        onClose={() => setZoomedImage(null)}
      />
    </div>
  );
}