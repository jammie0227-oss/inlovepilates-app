'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, PenTool, Clock, Edit3, X, ZoomIn, AlertTriangle } from 'lucide-react';
import { formatTimeStr, formatDateWithDay, getDayOfWeek, checkGlobalConflict } from '../mockData';

// 判斷學員預約預設類別與教室 (規則含 1v2 優先 1v2；管理員一律優先大教室)
const getStudentBookingPreset = (student: any, userRole: 'admin' | 'teacher') => {
  if (!student) {
    return {
      lessonType: '1v1' as const,
      roomType: userRole === 'admin' ? ('large' as const) : ('small' as const)
    };
  }

  const has1v2Rule = student.rules?.some((r: any) => r.lessonType === '1v2');
  const is1v2Preferred = has1v2Rule || student.defaultLessonType === '1v2' || student.lessonType === '1v2';

  const lessonType = is1v2Preferred ? ('1v2' as const) : ('1v1' as const);
  
  let roomType: 'large' | 'small' = 'small';
  if (userRole === 'admin') {
    roomType = 'large';
  } else {
    roomType = is1v2Preferred ? 'large' : 'small';
  }

  return { lessonType, roomType };
};

// --- 手寫簽名板組件 (需手動按下確認才送出) ---
function CanvasPad({ onConfirm, onCancel }: { onConfirm: (dataUrl: string) => void, onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, []);

  const getCoord = (e: any) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: any) => {
    e.preventDefault();
    setIsDrawing(true);
    setHasDrawn(true);
    const { x, y } = getCoord(e);
    canvasRef.current?.getContext('2d')?.beginPath();
    canvasRef.current?.getContext('2d')?.moveTo(x, y);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoord(e);
    canvasRef.current?.getContext('2d')?.lineTo(x, y);
    canvasRef.current?.getContext('2d')?.stroke();
  };

  const stop = () => {
    setIsDrawing(false);
  };

  const clear = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHasDrawn(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="border-2 border-dashed border-slate-200 rounded-2xl p-1 bg-slate-50 relative touch-none">
        <canvas
          ref={canvasRef}
          width={320}
          height={120}
          className="w-full h-28 bg-white rounded-xl cursor-crosshair"
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={stop}
        />
        {!hasDrawn && (
          <span className="absolute inset-0 flex items-center justify-center text-slate-300 text-xs pointer-events-none font-bold">
            請在此區手寫簽名
          </span>
        )}
      </div>
      <div className="flex justify-between items-center px-1">
        {hasDrawn ? (
          <button type="button" onClick={clear} className="text-xs text-slate-400 hover:text-slate-600 underline font-bold transition">
            清除重簽
          </button>
        ) : <div />}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl text-xs font-bold text-slate-600">
          取消
        </button>
        <button
          onClick={() => hasDrawn && canvasRef.current && onConfirm(canvasRef.current.toDataURL('image/png'))}
          disabled={!hasDrawn}
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold shadow-xs transition ${hasDrawn ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
        >
          確認簽名
        </button>
      </div>
    </div>
  );
}

export default function Tab2PersonalSchedule({
  userRole, 
  currentUserId, 
  teachers, 
  bookings, 
  onSmartBook,
  onExecuteReschedule,
  students, 
  onSign, 
  onUpdateBookingNote, 
  showToast, 
  onSelectStudent,
  externalBookingModalOpen,
  setExternalBookingModalOpen,
  viewMode = 'day',
  setViewMode
}: any) {
  const [localView, setLocalView] = useState<'month' | 'week' | 'day'>('day');
  const view = viewMode || localView;
  const setView = setViewMode || setLocalView;

  const [offset, setOffset] = useState(0);

  // 變更 / 取消 預約彈窗狀態
  const [editingBooking, setEditingBooking] = useState<any>(null);
  const [rescheduleDate, setRescheduleDate] = useState('2026-10-24');
  const [rescheduleHour, setRescheduleHour] = useState('10');
  const [rescheduleMin, setRescheduleMin] = useState('00');
  const [rescheduleRoom, setRescheduleRoom] = useState<'large' | 'small'>('small');
  const [rescheduleLessonType, setRescheduleLessonType] = useState<'1v1' | '1v2'>('1v1');

  const [localBookingModal, setLocalBookingModal] = useState(false);
  const isBookingModalOpen = externalBookingModalOpen || localBookingModal;
  const closeBookingModal = () => {
    setLocalBookingModal(false);
    if (setExternalBookingModalOpen) setExternalBookingModalOpen(false);
  };

  const [activeSignModal, setActiveSignModal] = useState<{ id: string; studentName: string } | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; time: string } | null>(null);

  const dayScrollRef = useRef<HTMLDivElement>(null);
  const weekVerticalScrollRef = useRef<HTMLDivElement>(null);

  const baseDate = new Date(2026, 9, 24);
  if (view === 'month') baseDate.setMonth(baseDate.getMonth() + offset);
  if (view === 'week') baseDate.setDate(baseDate.getDate() + offset * 7);
  if (view === 'day') baseDate.setDate(baseDate.getDate() + offset);

  const currentStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
  const isToday = currentStr === '2026-10-24';
  const isPast = currentStr < '2026-10-24';

  const firstStudent = students[0];
  const initialPreset = getStudentBookingPreset(firstStudent, userRole);

  const [modalForm, setModalForm] = useState({
    date: currentStr,
    hour: '10',
    minute: '00',
    studentName: firstStudent?.name || '',
    lessonType: initialPreset.lessonType,
    roomType: initialPreset.roomType
  });

  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const minutes = ['00', '10', '20', '30', '40', '50'];

  const studentsMap = useMemo(() => {
    return Object.fromEntries(students.map((s: any) => [s.id, s]));
  }, [students]);

  // 週曆 7 天日期生成 (拆分短日期與星期，緊湊無留白)
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
        isPast: str < '2026-10-24',
        isToday: str === '2026-10-24'
      };
    });
  }, [baseDate, offset]);

  // 個人名下所有課程（含體驗課）
  const myBookings = useMemo(() => {
    return bookings.filter((b: any) => b.teacherId === currentUserId);
  }, [bookings, currentUserId]);

  // 當日排定/即將上課課程（含體驗課，需為確認且未簽到）
  const upcomingBookingsForDay = useMemo(() => {
    return myBookings.filter((b: any) => b.date === currentStr && !b.signed && b.status === 'confirmed');
  }, [myBookings, currentStr]);

  // 當日歷史紀錄：嚴格根據當天 (currentStr) 移動呈現
  const historyBookingsForDay = useMemo(() => {
    return myBookings.filter((b: any) => {
      if (b.date !== currentStr) return false;
      return b.signed || b.status === 'cancelled_normal' || b.status === 'special_approved' || b.status === 'special_rejected' || b.status === 'special_pending';
    }).sort((a: any, b: any) => (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
  }, [myBookings, currentStr]);

  // 逾期未簽到提醒
  const overdueBookings = useMemo(() => {
    return myBookings.filter((b: any) => !b.signed && b.status === 'confirmed' && b.date < '2026-10-24');
  }, [myBookings]);

  // 日曆自動垂直滾動至老師當天第一堂課
  useEffect(() => {
    if (view === 'day' && dayScrollRef.current) {
      if (upcomingBookingsForDay.length > 0) {
        const earliestMins = Math.min(...upcomingBookingsForDay.map((b: any) => b.startHour * 60 + b.startMin));
        const scrollTarget = Math.max(0, earliestMins - 480);
        dayScrollRef.current.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      }
    }
  }, [view, currentStr, upcomingBookingsForDay]);

  // 週曆自動垂直滾動至老師當週第一堂課
  useEffect(() => {
    if (view === 'week' && weekVerticalScrollRef.current) {
      const weekDatesSet = new Set(weekDays.map(w => w.dateStr));
      const activeWeekBookings = myBookings.filter((b: any) => weekDatesSet.has(b.date) && b.status !== 'cancelled_normal');
      
      if (activeWeekBookings.length > 0) {
        const earliestMins = Math.min(...activeWeekBookings.map((b: any) => b.startHour * 60 + b.startMin));
        // 每分鐘 1px (60px/hr)，距離 8:00 (480 mins) 的垂直位移
        const scrollTarget = Math.max(0, earliestMins - 480);
        weekVerticalScrollRef.current.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      } else {
        weekVerticalScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [view, weekDays, myBookings]);

  // 判斷原課程異動時間是否距現在小於 24 小時
  const isWithin24HoursAudit = (booking: any) => {
    if (!booking) return false;
    const now = new Date(2026, 9, 24, 0, 0, 0).getTime();
    const [y, m, d] = booking.date.split('-').map(Number);
    const bookingTime = new Date(y, m - 1, d, booking.startHour, booking.startMin).getTime();
    return (bookingTime - now) / (1000 * 60 * 60) < 24;
  };

  // 檢查變更預約彈窗是否無任何改動（防呆灰階禁用）
  const isRescheduleUnchanged = useMemo(() => {
    if (!editingBooking) return true;
    const originalH = editingBooking.startHour;
    const originalM = editingBooking.startMin < 10 ? `0${editingBooking.startMin}` : String(editingBooking.startMin);
    const originalDate = editingBooking.date;
    const originalRoom = editingBooking.roomType || 'small';
    const originalType = editingBooking.lessonType || '1v1';

    return (
      rescheduleDate === originalDate &&
      parseInt(rescheduleHour, 10) === originalH &&
      rescheduleMin === originalM &&
      rescheduleRoom === originalRoom &&
      rescheduleLessonType === originalType
    );
  }, [editingBooking, rescheduleDate, rescheduleHour, rescheduleMin, rescheduleRoom, rescheduleLessonType]);

  const handleStudentSelect = (name: string) => {
    const targetStudent = students.find((s: any) => s.name === name);
    const preset = getStudentBookingPreset(targetStudent, userRole);
    setModalForm(prev => ({
      ...prev,
      studentName: name,
      lessonType: preset.lessonType,
      roomType: preset.roomType
    }));
  };

  const submitBooking = () => {
    const h = parseInt(modalForm.hour, 10);
    const m = parseInt(modalForm.minute, 10);
    const targetStudent = students.find((s: any) => s.name === modalForm.studentName);

    const conflict = checkGlobalConflict({
      dateStr: modalForm.date,
      startHour: h,
      startMin: m,
      durationMins: 50,
      roomType: modalForm.roomType,
      teacherId: currentUserId,
      studentId: targetStudent?.id,
      existingBookings: bookings,
      teachersMap: teachers,
      studentsMap
    });

    if (conflict.hasConflict) {
      return alert(`衝堂警告：${conflict.reason}`);
    }

    const newBk = {
      id: `b-${Date.now()}`,
      date: modalForm.date,
      startHour: h,
      startMin: m,
      durationMins: 50,
      teacherId: currentUserId,
      studentName: modalForm.studentName,
      studentId: targetStudent?.id || '',
      roomType: modalForm.roomType as any,
      lessonType: modalForm.lessonType as any,
      status: 'confirmed',
      signed: false
    };

    onSmartBook(newBk);
    closeBookingModal();
  };

  const openRescheduleModal = (b: any) => {
    setEditingBooking(b);
    setRescheduleDate(b.date);
    setRescheduleHour(String(b.startHour));
    setRescheduleMin(b.startMin < 10 ? `0${b.startMin}` : String(b.startMin));
    setRescheduleRoom(b.roomType || 'small');
    setRescheduleLessonType(b.lessonType || '1v1');
  };

  const handleConfirmReschedule = (isCancel: boolean) => {
    if (!editingBooking) return;
    if (!isCancel && isRescheduleUnchanged) return;

    onExecuteReschedule(
      editingBooking.id,
      rescheduleDate,
      parseInt(rescheduleHour, 10),
      parseInt(rescheduleMin, 10),
      rescheduleRoom,
      isCancel,
      rescheduleLessonType
    );
    setEditingBooking(null);
  };

  const getExactTimestamp = () => {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2.5 h-full flex flex-col pb-6">
      
      {/* 日期導航列：< 10/24(六) > */}
      <div className="flex items-center justify-between bg-white px-3 py-1.5 rounded-2xl border border-slate-200 shadow-2xs text-xs shrink-0">
        <button 
          onClick={() => setOffset(d => d - 1)} 
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
          onClick={() => setOffset(d => d + 1)} 
          className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 transition"
          title="後一日 / 後一週 / 後一月"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 逾期未簽到提醒 */}
      {overdueBookings.length > 0 && (
        <div className="bg-amber-50 p-3 rounded-2xl border border-amber-300 shadow-2xs space-y-2 shrink-0">
          <div className="flex items-center text-amber-900 font-black text-xs gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600" /> ⏰ 逾期未簽到提醒 ({overdueBookings.length} 堂)
          </div>
          <div className="space-y-1.5">
            {overdueBookings.map((b: any) => (
              <div key={b.id} className="p-2.5 bg-white rounded-xl border border-amber-200 flex justify-between items-center text-xs shadow-2xs">
                <div>
                  <span onClick={() => onSelectStudent(b.studentName)} className="font-black text-slate-800 hover:underline cursor-pointer">{b.studentName}</span>
                  <span className="text-slate-500 font-mono ml-2 font-bold">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openRescheduleModal(b)} className="text-[11px] bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg font-bold transition">變更</button>
                  <button onClick={() => setActiveSignModal({ id: b.id, studentName: b.studentName || '學員' })} className="text-[11px] bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold transition shadow-xs">補簽</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= 日曆檢視 ================= */}
      {view === 'day' && (
        <div ref={dayScrollRef} className={`flex-1 overflow-y-auto bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5 scroll-smooth ${
          isPast ? 'bg-slate-100/70 grayscale' : ''
        }`}>
          {/* 當日排定/即將上課課程 */}
          <div className="space-y-2.5">
            <p className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-sky-600" /> {isPast ? '當日排定課程' : '即將上課'}
            </p>
            {upcomingBookingsForDay.map((b: any) => (
              <div key={b.id} onClick={() => onSelectStudent(b.studentName)} className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200 space-y-2 text-xs cursor-pointer shadow-2xs transition">
                <div className="flex justify-between items-center font-mono">
                  <span className="font-black text-slate-800 text-sm">📅 {formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-700 font-bold">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                    <span className="font-black text-slate-900 text-sm mr-1">{b.studentName}</span>
                    <span className="text-slate-400">({b.lessonType})</span>
                  </div>
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openRescheduleModal(b)} className="px-2.5 py-1 rounded-xl text-[11px] font-bold border border-slate-200 bg-white hover:bg-slate-50 transition">變更</button>
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

          {/* 分隔線 */}
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
            <div className="relative flex justify-center text-[10px]">
              <span className="bg-white px-3 font-bold text-slate-400">
                本日歷史紀錄（{formatDateWithDay(currentStr)}）
              </span>
            </div>
          </div>

          {/* 下方歷史紀錄：嚴格根據當天移動呈現 */}
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

                  {/* 狀態標籤與簽名縮圖 */}
                  <div className="flex items-center gap-1.5">
                    {b.status === 'cancelled_normal' ? (
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">正常取消</span>
                    ) : b.status === 'special_rejected' ? (
                      <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">計罰取消</span>
                    ) : b.status === 'special_approved' ? (
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">免罰取消</span>
                    ) : b.status === 'special_pending' ? (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">取消待審核</span>
                    ) : b.signatureData?.startsWith('data:image') ? (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomedImage({ url: b.signatureData, time: b.signedAt || '' });
                        }}
                        className="border border-emerald-300 rounded p-0.5 bg-white cursor-pointer hover:bg-emerald-50 transition"
                        title="點擊放大簽名"
                      >
                        <img src={b.signatureData} alt="簽名" className="h-5 w-12 object-contain" />
                      </div>
                    ) : (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">✓ 簽到完成</span>
                    )}
                  </div>
                </div>
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

      {/* ================= 月曆檢視 (卡片底色顯示教室代表色，底色即可無外框) ================= */}
      {view === 'month' && (
        <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-xs font-black text-slate-500 text-center py-2 sticky top-0 z-10">
            <span className="text-rose-500">日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span className="text-indigo-500">六</span>
          </div>
          <div className="grid grid-cols-7 text-xs font-mono">
            {Array.from({ length: 31 }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayBks = myBookings.filter(b => b.date === dateStr && b.status !== 'cancelled_normal');
              const isMonthToday = dateStr === '2026-10-24';
              const isMonthPast = dateStr < '2026-10-24';

              return (
                <div key={i} className={`min-h-[75px] border-r border-b border-slate-100 p-1 flex flex-col gap-0.5 transition ${
                  isMonthPast ? 'bg-slate-50/60 grayscale' : 'hover:bg-slate-50'
                }`}>
                  <span className={`text-[11px] font-bold text-right mb-0.5 ${
                    isMonthToday ? 'text-rose-600 font-black' : isMonthPast ? 'text-slate-300' : 'text-slate-400'
                  }`}>
                    {dayNum}
                  </span>
                  {dayBks.map((b: any) => {
                    const isLarge = b.roomType === 'large';
                    return (
                      <div 
                        key={b.id} 
                        onClick={() => onSelectStudent(b.studentName)} 
                        className={`text-[10px] rounded px-1 py-0.5 font-bold truncate text-center w-full cursor-pointer transition shadow-2xs ${
                          isLarge 
                            ? 'bg-purple-100 text-purple-900 hover:bg-purple-200' 
                            : 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                        }`}
                        title={`${b.studentName} (${isLarge ? '大教室' : '小教室'})`}
                      >
                        {b.studentName}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= 週曆檢視 (自動滾動至當週第一堂課、雙行緊湊表頭) ================= */}
      {view === 'week' && (
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden relative">
          {/* 表頭：緊湊雙行 */}
          <div className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] border-b border-slate-200 text-center text-xs font-bold bg-slate-50 py-1.5 divide-x divide-slate-200 shrink-0 sticky top-0 z-30">
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

          {/* 週曆滾動主體 (自動向下垂直捲動至老師第一堂課) */}
          <div ref={weekVerticalScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
            <div className="grid grid-cols-[34px_repeat(7,minmax(0,1fr))] divide-x divide-slate-200 text-xs font-mono relative w-full">
              <div className="text-slate-500 bg-slate-50/95 font-bold flex flex-col divide-y divide-slate-100 select-none sticky left-0 z-20">
                {hours.map(h => (
                  <div key={h} className="h-[60px] flex items-center justify-center text-[11px]">
                    {h}
                  </div>
                ))}
              </div>

              {weekDays.map((item, dIdx) => (
                <div key={dIdx} className={`relative ${item.isPast ? 'bg-slate-100/70 grayscale opacity-80' : 'bg-white'}`} style={{ height: hours.length * 60 }}>
                  {hours.map(h => (
                    <div key={h} className="h-[60px] border-b border-slate-100 border-dotted" />
                  ))}
                  {myBookings.filter((b: any) => b.date === item.dateStr && b.status !== 'cancelled_normal').map((b: any) => {
                    const top = (b.startHour - 8) * 60 + b.startMin;
                    const isLarge = b.roomType === 'large';
                    return (
                      <div
                        key={b.id}
                        onClick={() => onSelectStudent(b.studentName)}
                        style={{ top: `${top}px`, height: `48px` }}
                        className={`absolute inset-x-0.5 z-10 rounded p-1 flex flex-col justify-center cursor-pointer shadow-2xs select-none transition hover:scale-[1.02] ${isLarge ? 'bg-purple-100 text-purple-900 border border-purple-200' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'}`}
                      >
                        <span className="text-[10px] font-black truncate text-center leading-tight">{b.studentName}</span>
                        <span className="text-[9px] font-mono opacity-80 text-center leading-tight mt-0.5">{formatTimeStr(b.startHour, b.startMin)}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          變更 / 取消 預約 Modal (三行緊湊佈局 + 前後無差異灰階禁用防呆)
      ======================================================== */}
      {editingBooking && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 animate-in zoom-in-95 border border-slate-100 text-xs">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800">變更 / 取消預約 ({editingBooking.studentName})</h3>
              <button onClick={() => setEditingBooking(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 原本預約內容：開頭用教室圓點標示 + 日期時間 + 類別 */}
            <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full shrink-0 ${editingBooking.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
              <div className="text-xs font-bold text-slate-800 flex-1">
                <span className="font-mono">{formatDateWithDay(editingBooking.date)} {formatTimeStr(editingBooking.startHour, editingBooking.startMin)}</span>
                <span className="ml-2 text-slate-500 font-sans">
                  ({editingBooking.lessonType || '1v1'} · {editingBooking.roomType === 'large' ? '大教室' : '小教室'})
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              {/* 第一行：修改日期 */}
              <div>
                <label className="font-bold text-slate-600 block mb-1">修改日期</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={e => setRescheduleDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                />
              </div>

              {/* 第二行：時和分 (以 10 分鐘為單位) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">時 (Hour)</label>
                  <select
                    value={rescheduleHour}
                    onChange={e => setRescheduleHour(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                  >
                    {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">分 (10 分鐘為單位)</label>
                  <select
                    value={rescheduleMin}
                    onChange={e => setRescheduleMin(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                  >
                    {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* 第三行：教室選擇 (帶圓點色標) 與 類別 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">教室選擇</label>
                  <select
                    value={rescheduleRoom}
                    onChange={(e: any) => setRescheduleRoom(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                  >
                    <option value="large">🟣 大教室</option>
                    <option value="small">🟢 小教室</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">課程類別</label>
                  <select
                    value={rescheduleLessonType}
                    onChange={(e: any) => setRescheduleLessonType(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                  >
                    <option value="1v1">1v1 單人</option>
                    <option value="1v2">1v2 雙人</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 若異動小於 24 小時且為一般老師，於按鈕上一行醒目註明 */}
            {userRole !== 'admin' && isWithin24HoursAudit(editingBooking) && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 font-bold text-[11px] flex items-center gap-1.5 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>⚠️ 時間小於 24 小時改動需要送審核</span>
              </div>
            )}

            {/* 按鈕組：前後無改動時「變更課堂」灰階禁用防呆 */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <button
                onClick={() => handleConfirmReschedule(false)}
                disabled={isRescheduleUnchanged}
                className={`py-2.5 rounded-xl font-bold transition shadow-xs text-xs ${
                  isRescheduleUnchanged
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                    : 'bg-slate-800 hover:bg-slate-700 text-white'
                }`}
                title={isRescheduleUnchanged ? '內容未變更' : '確認變更課堂'}
              >
                變更課堂
              </button>
              <button
                onClick={() => handleConfirmReschedule(true)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 py-2.5 rounded-xl font-bold transition shadow-xs text-xs"
              >
                取消課堂
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          新增預約 Modal (標題正名「新增預約」、規格與 Tab 1 完全一致)
      ======================================================== */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-800">新增預約</h3>
              <button onClick={closeBookingModal} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-2.5">
              {/* 選擇學員 (去贅字「預設」，直接顯示類別) */}
              <div>
                <label className="text-slate-600 font-bold block mb-1">選擇學員</label>
                <select 
                  value={modalForm.studentName} 
                  onChange={(e) => handleStudentSelect(e.target.value)} 
                  className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                >
                  {students.map((s: any) => {
                    const preset = getStudentBookingPreset(s, userRole);
                    return (
                      <option key={s.id} value={s.name}>
                        {s.name} ({s.credits}堂) - {preset.lessonType}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* 第一行：預約日期 */}
              <div>
                <label className="text-slate-600 font-bold block mb-1">預約日期</label>
                <input 
                  type="date" 
                  value={modalForm.date} 
                  onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })} 
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800" 
                />
              </div>

              {/* 第二行：時和分 (以 10 分鐘為單位) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 font-bold block mb-1">時 (Hour)</label>
                  <select 
                    value={modalForm.hour} 
                    onChange={(e) => setModalForm({ ...modalForm, hour: e.target.value })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800" 
                  >
                    {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 font-bold block mb-1">分 (10 分鐘為單位)</label>
                  <select 
                    value={modalForm.minute} 
                    onChange={(e) => setModalForm({ ...modalForm, minute: e.target.value })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800" 
                  >
                    {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* 第三行：教室選擇 (帶圓點色彩提示) 與 課程種類 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 font-bold block mb-1">教室選擇</label>
                  <select 
                    value={modalForm.roomType} 
                    onChange={(e) => setModalForm({ ...modalForm, roomType: e.target.value as any })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800" 
                  >
                    <option value="large">🟣 大教室</option>
                    <option value="small">🟢 小教室</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 font-bold block mb-1">課程種類</label>
                  <select 
                    value={modalForm.lessonType} 
                    onChange={(e) => setModalForm({ ...modalForm, lessonType: e.target.value as any })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800" 
                  >
                    <option value="1v1">1v1 單人</option>
                    <option value="1v2">1v2 雙人</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button 
                onClick={closeBookingModal} 
                className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl font-bold text-slate-600"
              >
                取消
              </button>
              <button 
                onClick={submitBooking} 
                className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs"
              >
                確認預約
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手動確認手寫簽名 Modal */}
      {activeSignModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-1.5">
                <PenTool className="w-4 h-4 text-rose-500" /> 手寫簽名 ({activeSignModal.studentName})
              </h3>
              <button onClick={() => setActiveSignModal(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <CanvasPad
              onCancel={() => setActiveSignModal(null)}
              onConfirm={(url) => {
                onSign(activeSignModal.id, url, getExactTimestamp());
                setActiveSignModal(null);
              }}
            />
          </div>
        </div>
      )}

      {/* 放大簽名 Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={() => setZoomedImage(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl text-center border animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <h3 className="text-xs font-black text-slate-800 mb-3">簽名存根檢視</h3>
            <div className="p-2 bg-slate-50 rounded-2xl border border-slate-200">
              <img src={zoomedImage.url} alt="簽名" className="w-full h-32 object-contain bg-white rounded-xl shadow-xs" />
            </div>
            <p className="text-[10px] font-mono text-slate-500 font-bold mt-2">簽署時間：{zoomedImage.time}</p>
            <button 
              onClick={() => setZoomedImage(null)} 
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-xl text-xs font-bold mt-4 transition shadow-xs"
            >
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}