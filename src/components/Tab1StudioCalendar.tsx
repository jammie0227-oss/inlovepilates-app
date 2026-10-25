'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Lock, X, AlertTriangle } from 'lucide-react';
import { TeacherProfile, BookingItem, StudentItem } from '../types';
import { formatTimeStr, formatDateWithDay, checkGlobalConflict } from '../mockData';

// 判斷學員預約預設類別與教室 (規則含 1v2 優先 1v2；管理員一律優先大教室)
const getStudentBookingPreset = (student: StudentItem | undefined, userRole: 'admin' | 'teacher') => {
  if (!student) {
    return {
      lessonType: '1v1' as const,
      roomType: userRole === 'admin' ? ('large' as const) : ('small' as const)
    };
  }

  const has1v2Rule = student.rules?.some((r: any) => r.lessonType === '1v2');
  const is1v2Preferred = has1v2Rule || student.defaultLessonType === '1v2' || student.lessonType === '1v2';

  const lessonType = is1v2Preferred ? ('1v2' as const) : ('1v1' as const);
  
  // 管理員不管怎樣先排大教室；老師則依 1v2/1v1 分配
  let roomType: 'large' | 'small' = 'small';
  if (userRole === 'admin') {
    roomType = 'large';
  } else {
    roomType = is1v2Preferred ? 'large' : 'small';
  }

  return { lessonType, roomType };
};

export default function Tab1StudioCalendar({ 
  userRole, 
  currentUserId, 
  teachers, 
  students, 
  bookings, 
  onSmartBook, 
  showToast, 
  onSelectStudent,
  externalBookingModalOpen, 
  setExternalBookingModalOpen,
  viewMode = 'day',
  setViewMode
}: {
  userRole: 'admin' | 'teacher'; 
  currentUserId: string; 
  teachers: Record<string, TeacherProfile>;
  students: StudentItem[]; 
  bookings: BookingItem[]; 
  onSmartBook: (newBk: BookingItem) => void; 
  showToast: (msg: string) => void; 
  onSelectStudent: (name: string) => void;
  externalBookingModalOpen?: boolean;
  setExternalBookingModalOpen?: (open: boolean) => void;
  viewMode?: 'day' | 'week';
  setViewMode?: (mode: 'day' | 'week') => void;
}) {
  const [localView, setLocalView] = useState<'week' | 'day'>('day');
  const view = viewMode || localView;
  const setView = setViewMode || setLocalView;

  const [dayOffset, setDayOffset] = useState(0); 
  const [localBookingModal, setLocalBookingModal] = useState(false);

  const isModalOpen = externalBookingModalOpen || localBookingModal;
  const closeModal = () => {
    setLocalBookingModal(false);
    if (setExternalBookingModalOpen) setExternalBookingModalOpen(false);
  };

  const baseDate = new Date(2026, 9, 24);
  baseDate.setDate(baseDate.getDate() + dayOffset);
  const currentStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
  
  const isToday = currentStr === '2026-10-24';
  const isPastDate = currentStr < '2026-10-24';

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

  const weekScrollRef = useRef<HTMLDivElement>(null);
  const dayScrollRef = useRef<HTMLDivElement>(null);

  // 營業時間 8:00 - 22:00 (共 14 小時，每小時 60px)
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const minutes = ['00', '10', '20', '30', '40', '50'];

  const activeTeachers = useMemo(() => {
    return Object.values(teachers).filter(t => t.isActive);
  }, [teachers]);

  const studentsMap = useMemo(() => {
    return Object.fromEntries(students.map(s => [s.id, s]));
  }, [students]);

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
        isPast: str < '2026-10-24', 
        isToday: str === '2026-10-24' 
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
      if (b.status === 'cancelled_normal') return false;
      if (b.lessonType !== '1v2' || b.roomType !== 'small') return false;
      if (view === 'day') return b.date === currentStr;
      return weekDays.some(w => w.dateStr === b.date);
    });
  }, [bookings, view, currentStr, weekDays]);

  const handleStudentSelect = (name: string) => {
    const targetStudent = students.find(s => s.name === name);
    const preset = getStudentBookingPreset(targetStudent, userRole);
    setModalForm(prev => ({
      ...prev,
      studentName: name,
      lessonType: preset.lessonType,
      roomType: preset.roomType
    }));
  };

  const handleQuickBook = (h: number, m: string, room: string, date: string) => {
    if (date < '2026-10-24') return alert('無法預約過去的時段');
    const targetStudent = students[0];
    const preset = getStudentBookingPreset(targetStudent, userRole);
    setModalForm({ 
      date, 
      hour: String(h), 
      minute: m, 
      roomType: room as any, 
      studentName: targetStudent?.name || '', 
      lessonType: preset.lessonType 
    });
    setLocalBookingModal(true);
  };

  const submitBooking = () => {
    const h = parseInt(modalForm.hour, 10);
    const m = parseInt(modalForm.minute, 10);
    const targetStudent = students.find(s => s.name === modalForm.studentName);

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
    
    const newBk: BookingItem = {
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
    closeModal();
  };

  return (
    <div className="space-y-2.5 h-full flex flex-col">
      
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
                    <div key={h} className="h-[60px] flex flex-col border-b border-slate-200">
                      {minutes.map(m => (
                        <button key={m} onClick={() => handleQuickBook(h, m, room, currentStr)} className="h-[10px] border-b border-dotted border-slate-100/60 hover:bg-rose-50/60 transition w-full" />
                      ))}
                    </div>
                  ))}
                  
                  {bookings.filter(b => b.date === currentStr && b.roomType === room && b.status !== 'cancelled_normal').map(b => {
                    // 每 10 分鐘 10px，計算垂直位置與高度
                    const top = ((b.startHour - 8) * 60 + b.startMin);
                    const isMyStudentCard = b.teacherId === currentUserId;
                    const canSeeDetails = userRole === 'admin' || isMyStudentCard;
                    const t = teachers[b.teacherId];
                    const is1v2InSmall = b.lessonType === '1v2' && b.roomType === 'small';

                    return (
                      <div 
                        key={b.id} 
                        onClick={() => { 
                          if (isMyStudentCard) {
                            onSelectStudent(b.studentName || '');
                          } else if (userRole === 'admin') {
                            showToast('管理者無法檢視其他老師學員之私密內頁');
                          }
                        }} 
                        style={{ top: `${top}px`, height: `${b.durationMins || 50}px` }} 
                        className={`absolute inset-x-1 z-10 rounded-lg p-1 flex flex-col justify-center shadow-2xs select-none transition ${
                          isMyStudentCard ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default'
                        } ${canSeeDetails ? t?.bgLight : 'bg-slate-200 opacity-90'} ${
                          is1v2InSmall ? 'border-2 border-rose-500 ring-2 ring-rose-200 shadow-md animate-pulse' : ''
                        }`}
                      >
                        {is1v2InSmall && (
                          <div className="absolute top-0.5 right-1 flex items-center gap-1">
                            <span className="text-[8px] bg-rose-600 text-white px-1 rounded font-bold">1v2 小教室</span>
                            <span className="w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                          </div>
                        )}
                        {canSeeDetails ? (
                          <>
                            <div className={`text-xs font-black truncate ${t?.text}`}>{b.studentName}</div>
                            <div className={`text-[10px] font-bold ${t?.text} opacity-90 leading-tight mt-0.5`}>
                              {formatTimeStr(b.startHour, b.startMin)} <span className="bg-white/60 px-1 rounded ml-0.5">{b.lessonType}</span>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-center font-bold text-slate-500 text-[10px]"><Lock className="w-2.5 h-2.5 mr-1" />預約</div>
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
                          <div key={h} className="h-[60px] flex flex-col border-b border-slate-200">
                            {minutes.map(m => (
                              <button key={m} onClick={() => handleQuickBook(h, m, room, item.dateStr)} className="h-[10px] border-b border-dotted border-slate-100/60 hover:bg-rose-50/60 transition w-full" />
                            ))}
                          </div>
                        ))}
                        
                        {bookings.filter(b => b.date === item.dateStr && b.roomType === room && b.status !== 'cancelled_normal').map(b => {
                          const top = ((b.startHour - 8) * 60 + b.startMin);
                          const isMyStudentCard = b.teacherId === currentUserId;
                          const canSeeDetails = userRole === 'admin' || isMyStudentCard;
                          const t = teachers[b.teacherId];
                          const is1v2InSmall = b.lessonType === '1v2' && b.roomType === 'small';

                          return (
                            <div 
                              key={b.id} 
                              onClick={() => { 
                                if (isMyStudentCard) {
                                  onSelectStudent(b.studentName || '');
                                } else if (userRole === 'admin') {
                                  showToast('管理員無法檢視其他老師學員之私密內頁');
                                }
                              }} 
                              style={{ top: `${top}px`, height: `${b.durationMins || 50}px` }} 
                              className={`absolute inset-x-0.5 z-10 rounded p-1 flex flex-col justify-center shadow-2xs select-none transition ${
                                isMyStudentCard ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-default'
                              } ${canSeeDetails ? t?.bgLight : 'bg-slate-200 opacity-90'} ${
                                is1v2InSmall ? 'border border-rose-500 animate-pulse ring-1 ring-rose-300' : ''
                              }`}
                            >
                              {is1v2InSmall && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-rose-500 rounded-full animate-ping shadow-sm" />}
                              {canSeeDetails ? (
                                <>
                                  <span className={`text-xs font-black truncate text-center ${t?.text}`}>{b.studentName}</span>
                                  <span className={`text-[10px] font-mono text-center font-bold ${t?.text} mt-0.5`}>{b.lessonType}</span>
                                </>
                              ) : (
                                <span className="text-[10px] font-bold text-center text-slate-500">🔒</span>
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

      {/* ========================================================
          新增預約 Modal (標題正名「新增預約」、標準三行排版)
      ======================================================== */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-800">新增預約</h3>
              <button onClick={closeModal} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-2.5">
              {/* 學員選擇 (去贅字「預設」，直接顯示類別) */}
              <div>
                <label className="text-slate-600 font-bold block mb-1">選擇學員</label>
                <select 
                  value={modalForm.studentName} 
                  onChange={(e) => handleStudentSelect(e.target.value)} 
                  className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                >
                  {students.map(s => {
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

              {/* 第二行：時和分 (10 分鐘為單位) */}
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
                onClick={closeModal} 
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
    </div>
  );
}