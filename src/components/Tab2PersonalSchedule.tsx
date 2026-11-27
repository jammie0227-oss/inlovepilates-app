'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, PenTool, Clock, Edit3 } from 'lucide-react';
import { formatTimeStr, formatDateWithDay, formatLocalDate, getDayOfWeek, getExactTimestamp } from '../mockData';
import { BookingStatusBadge, CanvasPadModal, SignatureZoomModal } from './SignatureModals';
import BookingEditModal, { BookingEditConfirmPayload } from './BookingEditModal';
import { RoomDot } from './RoomDot';
import { isOverdueUnsettled, getSignatureWindowStatus, isSlotReleased, DAY_HOURS, isPendingApproval, REVIEW_TAG, compareByStart } from '../utils/bookingRules';
import { useCalendarAutoScroll } from '../utils/useCalendarAutoScroll';
import { useNow } from '../utils/useToday';
import { systemConfirm } from '../utils/systemAlert';

/** 逾期課堂結算草稿：每堂選擇系統代簽或系統取消 */
export interface SettlementDraft {
  action: 'system_sign' | 'system_cancel';
  reason: string;
}

export default function Tab2PersonalSchedule({
  today,
  userRole, 
  currentUserId, 
  teachers, 
  bookings, 
  isActive = true,
  onProcessSettlement,
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

  // --- 逾期結算狀態 (必須在組件內部) ---
  const [isOverdueExpanded, setIsOverdueExpanded] = useState(false);
  const [settlementDrafts, setSettlementDrafts] = useState<Record<string, SettlementDraft>>({});

  // 1. 解析今天的日期
  const [sysYear, sysMonth, sysDay] = today.split('-').map(Number);
  const todayDateObj = new Date(sysYear, sysMonth - 1, sysDay);
  const lastDayOfMonth = new Date(sysYear, sysMonth, 0).getDate();
  const isLast5Days = (lastDayOfMonth - todayDateObj.getDate()) < 5;

  // 變更 / 取消 預約彈窗狀態
  const [editingBooking, setEditingBooking] = useState<any>(null);

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

  // 篩選當前老師「逾期未簽到且未取消」的課堂
  const now = useNow();
  const myOverdueBookings = useMemo(() => {
    return bookings.filter((b: any) => {
      // 個人課表一律只看「自己」的課堂；逾期＝開課時間已過、未簽、未取消
      return b.teacherId === currentUserId && isOverdueUnsettled(b, now);
    });
  }, [bookings, currentUserId, now]);
  // 清單內容有變才變動（每分鐘重算不應重置展開狀態）
  const overdueKey = myOverdueBookings.map((b: any) => b.id).join('|');

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
  const upcomingBookingsForDay = useMemo(() => {
    return myBookings
      .filter((b: any) => b.date === currentStr && !b.signed && (b.status === 'confirmed' || isPendingApproval(b)))
      .sort((a: any, b: any) => (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
  }, [myBookings, currentStr]);

  const historyBookingsForDay = useMemo(() => {
    return myBookings.filter((b: any) => {
      if (b.date !== currentStr) return false;
      if (!b.signed && isPendingApproval(b)) return false; // 待審核課堂歸入「即將上課」
      return b.signed || b.status === 'cancelled_normal';
    }).sort((a: any, b: any) => compareByStart(b, a)); // 最新在上
  }, [myBookings, currentStr]);

  // 如果逾期學員今天剛好有排課，自動展開提醒
  useEffect(() => {
    const hasTodayClass = myOverdueBookings.some((ob: any) => 
      upcomingBookingsForDay.some((ub: any) => ub.studentName === ob.studentName)
    );
    setIsOverdueExpanded(hasTodayClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overdueKey, upcomingBookingsForDay]);
  // 僅保留仍在逾期清單中的草稿（期間可能已簽名或取消）
  const selectedDrafts = Object.fromEntries(
    myOverdueBookings.filter((b: any) => settlementDrafts[b.id]).map((b: any) => [b.id, settlementDrafts[b.id]])
  ) as Record<string, SettlementDraft>;
  const selectedCount = Object.keys(selectedDrafts).length;

  /** 再點一次已選的選項即取消選擇（暫不處理） */
  const toggleSettlement = (id: string, action: SettlementDraft['action']) =>
    setSettlementDrafts(prev => {
      const next = { ...prev };
      if (next[id]?.action === action) delete next[id];
      else next[id] = { action, reason: next[id]?.reason || '' };
      return next;
    });

  const selectAllSettlement = (action: SettlementDraft['action']) =>
    setSettlementDrafts(prev => Object.fromEntries(
      myOverdueBookings.map((b: any) => [b.id, { action, reason: prev[b.id]?.reason || '' }])
    ));

  // 確認後交由 page.tsx 執行結算
  const handleSubmitSettlement = async () => {
    if (selectedCount === 0) return;
    const signCount = Object.values(selectedDrafts).filter(d => d.action === 'system_sign').length;
    const ok = await systemConfirm(
      `系統代簽 ${signCount} 堂（每堂扣學員 1 堂）\n系統取消 ${selectedCount - signCount} 堂（不扣堂數）\n\n送出後僅管理員可撤銷，確定送出嗎？`,
      '確認送出結算'
    );
    if (!ok) return;
    onProcessSettlement?.(selectedDrafts);
    setSettlementDrafts({});
  };

  // 週曆：自動捲動到當週第一堂課（管理員看全館、老師看自己；無課則 09:00）
  useCalendarAutoScroll({
    ref: weekVerticalScrollRef, enabled: isActive && view === 'week', dates: weekDays.map(w => w.dateStr),
    bookings, userRole, currentUserId,
  });

  const openRescheduleModal = (b: any) => setEditingBooking(b);

  const handleConfirmReschedule = (p: BookingEditConfirmPayload) => {
    const error: string | undefined = onExecuteReschedule(
      p.bookingId,
      p.date,
      p.hour,
      p.min,
      p.roomType,
      p.isCancel,
      p.lessonType,
      p.autoSwaps
    );
    if (!error) setEditingBooking(null);
    return error;
  };

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

      {/* 逾期未處理提醒卡片 */}
      {view === 'day' && myOverdueBookings.length > 0 && (
        <div className={`p-3 rounded-2xl border shadow-2xs space-y-2 shrink-0 transition-all ${
          isLast5Days ? 'bg-amber-50/90 border-amber-300 ring-1 ring-amber-200' : 'bg-white border-slate-200'
        }`}>
          <div className="flex justify-between items-center border-amber-200/60 cursor-pointer" onClick={() => setIsOverdueExpanded(!isOverdueExpanded)}>
            <div className="flex items-center text-amber-900 font-black text-xs gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span>⏰ 逾期未處理 ({myOverdueBookings.length})</span>
            </div>

            <span className="text-slate-400 font-bold p-1">{isOverdueExpanded ? '▲' : '▼'}</span>
          </div>
          {isOverdueExpanded && (
            <div className="space-y-2 pt-2 border-t border-amber-200/50 mt-2">
              <div className="flex items-center justify-end gap-3 text-[11px] font-bold">
                <button type="button" onClick={() => selectAllSettlement('system_sign')} className="text-amber-700 hover:underline">全部代簽</button>
                <button type="button" onClick={() => selectAllSettlement('system_cancel')} className="text-rose-600 hover:underline">全部取消</button>
                <button type="button" onClick={() => setSettlementDrafts({})} disabled={selectedCount === 0} className="text-slate-500 hover:underline disabled:text-slate-300 disabled:no-underline">清除選擇</button>
              </div>

              <div className="space-y-1.5 max-h-[34vh] overflow-y-auto">
                {myOverdueBookings.map((b: any) => {
                  const draft = selectedDrafts[b.id];
                  return (
                    <div key={b.id} className="p-2.5 bg-white rounded-xl border border-amber-200 space-y-2 text-xs shadow-2xs">
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <RoomDot room={b.roomType} />
                          <span onClick={() => onSelectStudent(b.studentName)} className="font-black text-slate-800 hover:underline cursor-pointer">{b.studentName}</span>
                          <span className="text-slate-500 font-mono font-bold">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                        </div>
                        <div className="flex gap-1.5 shrink-0 whitespace-nowrap">
                          <button onClick={() => openRescheduleModal(b)} className="text-[11px] bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg font-bold transition">變更</button>
                          <button onClick={() => setActiveSignModal({ id: b.id, studentName: b.studentName || '學員' })} className="text-[11px] bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold transition shadow-xs">{getSignatureWindowStatus(b, now) === 'late_over_1h' ? '補簽' : '簽名'}</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ['system_sign', '系統代簽', '扣 1 堂', 'bg-amber-100 border-amber-400 text-amber-950'],
                          ['system_cancel', '系統取消', '不扣堂', 'bg-rose-100 border-rose-400 text-rose-950'],
                        ] as const).map(([action, label, hint, activeCls]) => (
                          <button
                            key={action}
                            type="button"
                            aria-pressed={draft?.action === action}
                            onClick={() => toggleSettlement(b.id, action)}
                            className={`py-1.5 rounded-lg border text-[11px] font-black transition ${
                              draft?.action === action ? activeCls : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            {label} <span className="font-normal opacity-75">（{hint}）</span>
                          </button>
                        ))}
                      </div>
                      {draft && (
                        <input
                          type="text"
                          value={draft.reason}
                          onChange={e => {
                            const reason = e.target.value;
                            setSettlementDrafts(prev => ({ ...prev, [b.id]: { ...prev[b.id], reason } }));
                          }}
                          placeholder="事由備註（非必填）..."
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-700 outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleSubmitSettlement}
                disabled={selectedCount === 0}
                className="w-full py-2 rounded-xl text-xs font-black transition bg-slate-900 hover:bg-slate-800 text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                送出結算（已選 {selectedCount} 堂）
              </button>
            </div>
          )}
        </div>
      )}

      {/* 日曆檢視 */}
      {view === 'day' && (
        <div className={`flex-1 min-h-[260px] overflow-y-auto bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5 scroll-smooth ${
          isPast ? 'bg-slate-100/70 grayscale' : ''
        }`}>
          <div className="space-y-2.5">
            <p className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-sky-600" /> {isPast ? '當日排定課程' : '即將上課'}
            </p>
            {upcomingBookingsForDay.map((b: any) => (
              <div key={b.id} onClick={() => onSelectStudent(b.studentName)} className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200 space-y-2 text-xs cursor-pointer shadow-2xs transition">
                <div className="flex justify-between items-center gap-2 font-mono">
                  <span className="font-black text-slate-800 text-sm">📅 {formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                  {isPendingApproval(b) && (
                    <span className="shrink-0 whitespace-nowrap text-[10px] font-sans bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-black">{REVIEW_TAG}</span>
                  )}
                </div>
                <div className="flex justify-between items-center text-slate-700 font-bold">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                    <span className="font-black text-slate-900 text-sm mr-1">{b.studentName}</span>
                    <span className="text-slate-400">({b.lessonType})</span>
                  </div>
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    {isPendingApproval(b) ? (
                      <button onClick={() => openRescheduleModal(b)} className="px-2.5 py-1 rounded-xl text-[11px] font-bold border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition">取消</button>
                    ) : (
                      <button onClick={() => openRescheduleModal(b)} className="px-2.5 py-1 rounded-xl text-[11px] font-bold border border-slate-200 bg-white hover:bg-slate-50 transition">變更</button>
                    )}
                    {/* 非優先審核中同樣保留簽名（現場緊急情況保險），時間窗由簽名彈窗把關 */}
                    <button onClick={() => setActiveSignModal({ id: b.id, studentName: b.studentName || '學員' })} className="bg-rose-500 hover:bg-rose-600 text-white font-black px-3 py-1 rounded-xl flex items-center gap-1 shadow-xs transition">
                      <PenTool className="w-3.5 h-3.5" /> 簽名
                    </button>
                  </div>
                </div>
                <div className="relative mt-1" onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    defaultValue={b.teacherNote || ''}
                    onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                    placeholder="填寫上課狀況備註 (點擊外側自動儲存)..."
                    className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-slate-700 outline-none focus:ring-1 focus:ring-rose-400 transition"
                  />
                  <Edit3 className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400 pointer-events-none" />
                </div>
              </div>
            ))}
            {upcomingBookingsForDay.length === 0 && <p className="text-center text-slate-400 text-xs py-4 font-bold">本日無預排課程</p>}
          </div>

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
              <div key={b.id} onClick={() => onSelectStudent(b.studentName)} className="p-3 bg-slate-50 rounded-xl space-y-2 text-xs text-slate-600 border border-slate-200 cursor-pointer hover:bg-slate-100 transition shadow-2xs">
                <div className="flex justify-between items-center font-mono">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                    <span className="font-bold">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                    <span className="font-black text-slate-800 font-sans">{b.studentName}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <BookingStatusBadge booking={b} onZoomSignature={setZoomedImage} />
                  </div>
                </div>
                {(b.settlementType === 'system_deducted' || b.isSystemSigned) && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 space-y-0.5" onClick={e => e.stopPropagation()}>
                    <p className="font-bold">⚡ 系統代結對帳憑證</p>
                    <p>代結時間：<span className="font-mono">{b.systemSignedAt || b.signedAt || '—'}</span></p>
                    <p>事由備註：{b.overdueReason || '—'}</p>
                  </div>
                )}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    defaultValue={b.teacherNote || ''}
                    onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                    placeholder="歷史上課狀況筆記..."
                    className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-2 py-1 text-[11px] text-slate-600 outline-none focus:ring-1 focus:ring-rose-400 transition"
                  />
                  <Edit3 className="w-3.5 h-3.5 absolute left-2 top-1.5 text-slate-400 pointer-events-none" />
                </div>
              </div>
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
                        onClick={() => onSelectStudent(b.studentName)} 
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
                        onClick={() => onSelectStudent(b.studentName)}
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
        booking={editingBooking}
        cancelOnly={!!editingBooking && isPendingApproval(editingBooking)}
        userRole={userRole}
        today={today}
        bookings={bookings}
        priorityGrid={priorityGrid}
        teachers={teachers}
        students={students}
        onClose={() => setEditingBooking(null)}
        onConfirm={handleConfirmReschedule}
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