'use client';

import React, { useState, useMemo } from 'react';
import { Calendar as CalendarIcon, Users, FileText, BookOpen, User as UserIcon, Plus, ArrowLeft, RotateCcw, Sparkles } from 'lucide-react';
import { 
  INITIAL_TEACHERS, 
  INITIAL_STUDENTS, 
  INITIAL_BOOKINGS, 
  INITIAL_REVIEWS, 
  INITIAL_LOGS, 
  TeacherProfile, 
  StudentItem, 
  BookingItem, 
  ReviewItem, 
  AuditLogItem,
  formatDateWithDay,
  formatTimeStr,
  checkGlobalConflict
} from '../mockData';

import Tab1StudioCalendar from '../components/Tab1StudioCalendar';
import Tab2PersonalSchedule from '../components/Tab2PersonalSchedule';
import Tab3StudentManagement, { StudentDetailView } from '../components/Tab3StudentManagement';
import Tab4TeachersManagement, { TeacherDetailView } from '../components/Tab4TeachersManagement';
import Tab5RulesAndAudit from '../components/Tab5RulesAndAudit';

const getExactTimestamp = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
};

export default function Home() {
  const [userRole, setUserRole] = useState<'admin' | 'teacher'>('admin');
  const currentUserId = userRole === 'admin' ? 't-daisy' : 't-1';
  
  const [activeTab, setActiveTab] = useState<number>(2);
  const [previousTab, setPreviousTab] = useState<number>(2);
  
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);

  // 頂部動作觸發器
  const [triggerTab1BookModal, setTriggerTab1BookModal] = useState(false);
  const [triggerTab2BookModal, setTriggerTab2BookModal] = useState(false);
  const [isCreateStudentOpen, setIsCreateStudentOpen] = useState(false);
  const [isCreateTeacherOpen, setIsCreateTeacherOpen] = useState(false);
  const [triggerBuyCourseModal, setTriggerBuyCourseModal] = useState(false);

  // Tab 1 & Tab 2 頂部視圖控制狀態 (由 Header 統一控制)
  const [tab1View, setTab1View] = useState<'day' | 'week'>('day');
  const [tab2View, setTab2View] = useState<'day' | 'week' | 'month'>('day');

  const [priorityGrid, setPriorityGrid] = useState<Record<string, { large?: string; small?: string }>>({});

  const [teachers, setTeachers] = useState<Record<string, TeacherProfile>>(INITIAL_TEACHERS);
  const [students, setStudents] = useState<StudentItem[]>(INITIAL_STUDENTS);
  const [bookings, setBookings] = useState<BookingItem[]>(INITIAL_BOOKINGS);
  const [reviews, setReviews] = useState<ReviewItem[]>(INITIAL_REVIEWS);
  const [logs, setLogs] = useState<AuditLogItem[]>(INITIAL_LOGS);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [studioRules, setStudioRules] = useState<string>(
    `1. 上課結束後，請協助消毒器械並將 Footbar 調至自下數第三格。\n2. 大教室優先供 1v2 雙人課程使用。\n3. 自主訓練僅得於授課前 30 分鐘內進場。`
  );

  const showToast = (msg: string) => { 
    setToastMsg(msg); 
    setTimeout(() => setToastMsg(null), 3500); 
  };
  
  // 乾淨結構化日誌產生器
  const addLog = (
    detail: string, 
    typeStr: string, 
    category: 'red' | 'yellow' | 'normal' = 'normal', 
    sName: string = '', 
    tId?: string, 
    rId?: string,
    remainingCredits?: number,
    tName?: string
  ) => {
    const timeFormatted = getExactTimestamp().slice(5, 16);
    const teacherDisplayName = (tName || (userRole === 'admin' ? 'Daisy' : teachers[currentUserId]?.name || '老師'))
      .replace(/ 老師|老師|\(管理者\)/g, '')
      .trim();
    const cleanStudentName = sName === '學員' || sName === '-' ? '' : sName;

    setLogs(prev => [{ 
      id: `l-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
      time: timeFormatted, 
      actor: teacherDisplayName, 
      teacherName: teacherDisplayName,
      studentName: cleanStudentName, 
      action: detail, 
      detail: detail,
      typeStr, 
      category, 
      read: false, 
      teacherId: tId || currentUserId, 
      reviewId: rId,
      remainingCredits: remainingCredits ?? undefined
    } as any, ...prev]);
  };

  const navigateToStudent = (identifier: string, sourceTab: number, isId: boolean = false) => {
    const s = isId ? students.find(item => item.id === identifier) : students.find(item => item.name === identifier);
    if (s) {
      setPreviousTab(sourceTab);
      setSelectedStudentId(s.id);
      setActiveTab(3);
    } else {
      showToast(`找不到該名學員資料`);
    }
  };

  // 支援重排替換 (Clean Baseline) 與一般新增累加
  const handleAddBookings = (newBks: BookingItem[], cleanBase?: BookingItem[]) => {
    if (cleanBase) {
      setBookings([...cleanBase, ...newBks]);
    } else {
      setBookings(prev => [...prev, ...newBks]);
    }
  };

  // 1v2 智能調度引擎 (附帶高精度色標日誌)
  const handleSmartBookingSubmit = (newBk: BookingItem) => {
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][new Date(newBk.date).getDay()];
    const slotKey = `${dayOfWeek}-${newBk.startHour}`;
    const priority = priorityGrid[slotKey] || {};
    const formattedDate = formatDateWithDay(newBk.date);
    const timeFormatted = formatTimeStr(newBk.startHour, newBk.startMin);
    const currentTeacherName = (teachers[newBk.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim();

    // 檢查大教室佔用情況
    const isBigRoomOccupied = bookings.find(b => 
      b.date === newBk.date && 
      b.roomType === 'large' && 
      b.status !== 'cancelled_normal' &&
      !(newBk.startHour * 60 + newBk.startMin + 50 <= b.startHour * 60 + b.startMin || 
        newBk.startHour * 60 + newBk.startMin >= b.startHour * 60 + b.startMin + b.durationMins)
    );

    if (newBk.lessonType === '1v2' && newBk.roomType === 'small') {
      if (!isBigRoomOccupied) {
        if (priority.large && priority.large !== newBk.teacherId) {
          const priorityTeacherName = (teachers[priority.large]?.name || '其他老師').replace(/ 老師|老師/g, '').trim();
          if (confirm(`注意：大教室此時段為 ${priorityTeacherName} 的優先時段。\n是否仍要將此 1v2 課程自動改排至大教室？`)) {
            newBk.roomType = 'large';
            addLog(
              `時間：${formattedDate} ${timeFormatted}\n原本：🟢 ${currentTeacherName} ${newBk.studentName} (1v2)\n改為：🟣 ${currentTeacherName} ${newBk.studentName} (1v2) · 佔用 ${priorityTeacherName} 時段`, 
              '調度', 
              'yellow', 
              newBk.studentName,
              newBk.teacherId,
              undefined,
              undefined,
              '系統排程'
            );
          }
        } else {
          newBk.roomType = 'large';
          addLog(
            `時間：${formattedDate} ${timeFormatted}\n原本：🟢 ${currentTeacherName} ${newBk.studentName} (1v2)\n改為：🟣 ${currentTeacherName} ${newBk.studentName} (1v2)`, 
            '調度', 
            'normal', 
            newBk.studentName,
            newBk.teacherId,
            undefined,
            undefined,
            '系統排程'
          );
        }
      } else {
        if (isBigRoomOccupied.lessonType === '1v1') {
          const originalTeacherName = (teachers[isBigRoomOccupied.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim();
          
          setBookings(prev => prev.map(b => b.id === isBigRoomOccupied.id ? { ...b, roomType: 'small' } : b));
          newBk.roomType = 'large';

          addLog(
            `時間：${formattedDate} ${timeFormatted}\n原本：🟣 ${originalTeacherName} ${isBigRoomOccupied.studentName} (1v1) 與 🟢 ${currentTeacherName} ${newBk.studentName} (1v2)\n改為：🟢 ${originalTeacherName} ${isBigRoomOccupied.studentName} (1v1) 與 🟣 ${currentTeacherName} ${newBk.studentName} (1v2)`, 
            '調度', 
            'yellow', 
            '', 
            isBigRoomOccupied.teacherId,
            undefined,
            undefined,
            '系統排程'
          );
          
          alert(`大教室原 1v1 課程 (${originalTeacherName} / ${isBigRoomOccupied.studentName}) 已協調移至小教室，您的 1v2 課程已安排入大教室，系統已同步發送調度通知！`);
        }
      }
    }

    setBookings(prev => [...prev, newBk]);
    const finalRoomDot = newBk.roomType === 'large' ? '🟣' : '🟢';
    addLog(
      `${formattedDate} ${timeFormatted} ${finalRoomDot} (${newBk.lessonType})`, 
      '預約', 
      'normal', 
      newBk.studentName, 
      newBk.teacherId,
      undefined,
      undefined,
      currentTeacherName
    );
    showToast('預約建立成功！');
  };

  // 變更或取消預約
  const handleExecuteReschedule = (
    bookingId: string, 
    newDate: string, 
    newHour: number, 
    newMin: number, 
    newRoom: 'large' | 'small', 
    isCancel = false,
    newLessonType?: '1v1' | '1v2'
  ) => {
    const target = bookings.find(b => b.id === bookingId);
    if (!target) return;

    const oldDateFormatted = formatDateWithDay(target.date);
    const oldTimeFormatted = formatTimeStr(target.startHour, target.startMin);
    const oldRoomDot = target.roomType === 'large' ? '🟣' : '🟢';

    const newDateFormatted = formatDateWithDay(newDate);
    const newTimeFormatted = formatTimeStr(newHour, newMin);
    const newRoomDot = newRoom === 'large' ? '🟣' : '🟢';
    const finalLessonType = newLessonType || target.lessonType;
    
    const teacherName = (teachers[currentUserId]?.name || '老師').replace(/ 老師|老師/g, '').trim();

    if (userRole === 'admin') {
      if (isCancel) {
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled_normal' } : b));
        addLog(
          `${oldDateFormatted} ${oldTimeFormatted} ${oldRoomDot} 一般取消`, 
          '取消', 
          'normal', 
          target.studentName, 
          target.teacherId,
          undefined,
          undefined,
          'Daisy'
        );
        showToast('管理員已取消預約');
      } else {
        const conflict = checkGlobalConflict({
          dateStr: newDate,
          startHour: newHour,
          startMin: newMin,
          durationMins: target.durationMins || 50,
          roomType: newRoom,
          teacherId: target.teacherId,
          studentId: target.studentId,
          existingBookings: bookings,
          teachersMap: teachers,
          studentsMap: Object.fromEntries(students.map(s => [s.id, s])),
          excludeBookingId: target.id
        });

        if (conflict.hasConflict) {
          const proceed = confirm(`衝堂提醒：${conflict.reason}\n管理員是否仍要強制變更？`);
          if (!proceed) return;
        }

        setBookings(prev => prev.map(b => b.id === bookingId ? { 
          ...b, 
          date: newDate, 
          startHour: newHour, 
          startMin: newMin, 
          roomType: newRoom,
          lessonType: finalLessonType
        } : b));

        addLog(
          `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomDot} (${target.lessonType})\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomDot} (${finalLessonType})\n結果：一般改期`, 
          '改期', 
          'normal', 
          target.studentName, 
          target.teacherId,
          undefined,
          undefined,
          'Daisy'
        );
        showToast('管理員已變更預約');
      }
    } else {
      // 一般老師送審
      const isRoomOrTypeOnlyChange = !isCancel && (target.date === newDate && target.startHour === newHour && target.startMin === newMin);
      const revType = isCancel ? 'cancel' : isRoomOrTypeOnlyChange ? 'room_change' : 'reschedule';
      
      const newRev: any = {
        id: `rev-${Date.now()}`,
        bookingId,
        teacherId: currentUserId,
        teacherName: teacherName,
        studentName: target.studentName,
        date: target.date,
        time: `${oldDateFormatted} ${oldTimeFormatted}`,
        room: oldRoomDot,
        lessonType: finalLessonType,
        reason: isCancel ? '逾期取消申請' : isRoomOrTypeOnlyChange ? '改教室申請' : '逾期改期申請',
        status: 'pending',
        reviewType: revType,
        reqDate: newDate,
        reqHour: newHour,
        reqMin: newMin,
        reqRoom: newRoom,
        reqLessonType: finalLessonType
      };
      
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'special_pending' } : b));
      setReviews(prev => [newRev, ...prev]);
      
      const logDetail = isCancel 
        ? `${oldDateFormatted} ${oldTimeFormatted} ${oldRoomDot} 取消待審核`
        : isRoomOrTypeOnlyChange
          ? `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomDot}\n改至：${newRoomDot}\n結果：待審核`
          : `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomDot}\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomDot}\n結果：待審核`;

      const typeLabel = isCancel ? '取消' : isRoomOrTypeOnlyChange ? '改室' : '改期';
      addLog(
        logDetail, 
        typeLabel, 
        'red', 
        target.studentName, 
        currentUserId, 
        newRev.id,
        undefined,
        teacherName
      );
      showToast('變更已送交 Daisy 審核');
    }
  };

  // 審核處理
  const handleReview = (reviewId: string, decision: 'approved' | 'rejected') => {
    const rev = reviews.find(r => r.id === reviewId) as any;
    if (!rev) return;

    const targetBooking = bookings.find(b => b.id === rev.bookingId);
    const studentName = targetBooking?.studentName || rev.studentName || '';
    const cleanTeacher = (rev.teacherName || '老師').replace(/ 老師|老師/g, '').trim();
    
    const revTimeStr = rev.time?.includes('(') ? rev.time : `${formatDateWithDay(rev.date)} ${rev.time || ''}`;

    // 1. 改教室審核 (核准 / 駁回)
    if (rev.reviewType === 'room_change') {
      const isApproved = decision === 'approved';
      if (isApproved) {
        setBookings(prev => prev.map(b => b.id === rev.bookingId ? { 
          ...b, 
          status: 'confirmed',
          roomType: rev.reqRoom || b.roomType,
          lessonType: rev.reqLessonType || b.lessonType
        } : b));
      } else {
        setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, status: 'confirmed' } : b));
      }
      setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: decision } : r));

      const oldDot = targetBooking?.roomType === 'large' ? '🟣' : '🟢';
      const newDot = rev.reqRoom === 'large' ? '🟣' : '🟢';

      addLog(
        `原課堂：${revTimeStr} ${oldDot}\n改至：${newDot}\n結果：${isApproved ? '核准' : '駁回'}`, 
        '改室', 
        'normal', 
        studentName, 
        rev.teacherId, 
        reviewId,
        undefined,
        cleanTeacher
      );
      showToast(`審核完成：已${isApproved ? '核准' : '駁回'}改室`);
    } 
    // 2. 改期審核 (免罰改期 / 計罰改期)
    else if (rev.reviewType === 'reschedule') {
      const isExempt = decision === 'approved';
      const typeLabel = isExempt ? '免罰改期' : '計罰改期';
      const newStatus = isExempt ? 'special_approved' : 'special_rejected';

      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { 
        ...b, 
        status: 'confirmed',
        date: rev.reqDate,
        startHour: rev.reqHour,
        startMin: rev.reqMin,
        roomType: rev.reqRoom,
        lessonType: rev.reqLessonType || b.lessonType
      } : b));
      setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: decision } : r));

      const oldDot = targetBooking?.roomType === 'large' ? '🟣' : '🟢';
      const newDot = rev.reqRoom === 'large' ? '🟣' : '🟢';
      const newTimeStr = `${formatDateWithDay(rev.reqDate)} ${formatTimeStr(rev.reqHour, rev.reqMin)}`;

      addLog(
        `原課堂：${revTimeStr} ${oldDot}\n改至：${newTimeStr} ${newDot}\n結果：${typeLabel}`, 
        '改期', 
        'red', 
        studentName, 
        rev.teacherId, 
        reviewId,
        undefined,
        cleanTeacher
      );
      showToast(`審核完成：改期已套用 (${isExempt ? '免罰' : '計罰'})`);
    } 
    // 3. 取消審核 (免罰取消 / 計罰取消，無額度贅字與退堂)
    else {
      const isExempt = decision === 'approved';
      const newStatus = isExempt ? 'special_approved' : 'special_rejected';

      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, status: newStatus } : b));
      setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: decision } : r));

      addLog(
        `${revTimeStr} ${isExempt ? '免罰取消' : '計罰取消'}`, 
        '取消', 
        'red', 
        studentName, 
        rev.teacherId, 
        reviewId,
        undefined,
        cleanTeacher
      );
      showToast(`審核完成：${isExempt ? '免罰取消' : '計罰取消'}`);
    }
  };

  const handleResetReview = (reviewId: string) => {
    const rev = reviews.find(r => r.id === reviewId);
    setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: 'pending' } : r));
    if (rev && rev.bookingId) {
      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, status: 'special_pending' } : b));
    }
    const cleanTeacher = (rev?.teacherName || '老師').replace(/ 老師|老師/g, '').trim();
    addLog(
      `${rev?.time || ''} 撤銷審核（回歸待審）`, 
      '取消', 
      'red', 
      rev?.studentName || '', 
      rev?.teacherId,
      undefined,
      undefined,
      cleanTeacher
    );
    showToast('已撤銷審核，案件回到待審');
  };

  // 簽到扣堂
  const handleSign = (bookingId: string, signatureDataUrl: string, timestamp: string) => {
    let sName = ''; 
    let afterC = 0;
    let bDate = '';
    let bTime = '';
    const tName = (teachers[currentUserId]?.name || 'Daisy').replace(/ 老師|老師/g, '').trim();

    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) {
        sName = b.studentName || '';
        bDate = formatDateWithDay(b.date);
        bTime = formatTimeStr(b.startHour, b.startMin);

        if (b.studentId) {
          setStudents(sList => sList.map(s => { 
            if (s.id === b.studentId) { 
              afterC = Math.max(0, s.credits - 1); 
              return { ...s, credits: afterC }; 
            } 
            return s; 
          }));
        }
        return { ...b, signed: true, signatureData: signatureDataUrl, signedAt: timestamp };
      }
      return b;
    }));

    addLog(
      `${bDate} ${bTime}  -1堂  餘 ${afterC} 堂`, 
      '簽到', 
      'normal', 
      sName, 
      currentUserId,
      undefined,
      afterC,
      tName
    );
    showToast(`簽到完成！[${sName}] 已扣 1 堂，剩餘 ${afterC} 堂`);
  };

  // 規範審核燈號層級
  const auditBadgeColor = useMemo(() => {
    const hasPendingReview = userRole === 'admin' && reviews.some(r => r.status === 'pending');
    if (hasPendingReview) return 'red';

    const hasUnreadYellow = logs.some(l => !l.read && l.category === 'yellow' && (userRole === 'admin' || l.teacherId === currentUserId));
    if (hasUnreadYellow) return 'yellow';

    return null;
  }, [reviews, logs, userRole, currentUserId]);

  const currentViewingStudent = useMemo(() => {
    return students.find(s => s.id === selectedStudentId);
  }, [students, selectedStudentId]);

  const activeTeachersList = useMemo(() => {
    return Object.values(teachers).filter(t => t.isActive);
  }, [teachers]);

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 w-full flex flex-col justify-center items-center py-0 md:py-4">
      <div className="flex flex-col h-screen md:h-[94vh] max-h-screen md:max-h-[960px] w-full max-w-md md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-slate-50 shadow-2xl relative border-x md:border border-slate-200 md:rounded-3xl overflow-hidden font-sans">
        
        {toastMsg && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-white text-xs px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <Sparkles className="w-4 h-4 text-amber-400" /><span className="font-bold">{toastMsg}</span>
          </div>
        )}

        {/* 頂部 Header */}
        <header className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-col justify-center shrink-0 shadow-2xs z-20 min-h-[48px]">
          
          {/* Tab 1 Header */}
          {activeTab === 1 && (
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex bg-slate-100 p-0.5 rounded-xl text-[11px] font-bold text-slate-600 shrink-0">
                  <button onClick={() => setTab1View('day')} className={`px-2.5 py-1 rounded-lg transition ${tab1View === 'day' ? 'bg-white text-rose-600 font-black shadow-2xs' : ''}`}>日</button>
                  <button onClick={() => setTab1View('week')} className={`px-2.5 py-1 rounded-lg transition ${tab1View === 'week' ? 'bg-white text-rose-600 font-black shadow-2xs' : ''}`}>週</button>
                </div>
                {/* 解除 max-w 寬度限制，改用 flex-wrap 讓老師名單自動安全換行 */}
                <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap flex-1 pl-1">
                  {activeTeachersList.map(t => (
                    <span key={t.id} className="flex items-center gap-1 text-[10px] font-bold text-slate-600 whitespace-nowrap">
                      <span className={`w-2 h-2 rounded-full ${t.color} shrink-0`} />
                      <span>{t.name}</span>
                    </span>
                  ))}
                </div>
              </div>
              <button 
                onClick={() => setTriggerTab1BookModal(true)}
                className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black w-7 h-7 rounded-xl flex items-center justify-center shadow-xs transition active:scale-95 shrink-0"
                title="新增預約"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Tab 2 Header */}
          {activeTab === 2 && (
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex bg-slate-100 p-0.5 rounded-xl text-[11px] font-bold text-slate-600 shrink-0">
                  <button onClick={() => setTab2View('day')} className={`px-2 py-1 rounded-lg transition ${tab2View === 'day' ? 'bg-white text-rose-600 font-black shadow-2xs' : ''}`}>日</button>
                  <button onClick={() => setTab2View('week')} className={`px-2 py-1 rounded-lg transition ${tab2View === 'week' ? 'bg-white text-rose-600 font-black shadow-2xs' : ''}`}>週</button>
                  <button onClick={() => setTab2View('month')} className={`px-2 py-1 rounded-lg transition ${tab2View === 'month' ? 'bg-white text-rose-600 font-black shadow-2xs' : ''}`}>月</button>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600 flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> 大</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> 小</span>
                </div>
              </div>
              <button 
                onClick={() => setTriggerTab2BookModal(true)}
                className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black w-7 h-7 rounded-xl flex items-center justify-center shadow-xs transition active:scale-95 shrink-0"
                title="新增預約"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Tab 3 Header */}
          {activeTab === 3 && (
            selectedStudentId && currentViewingStudent ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setSelectedStudentId(null); setActiveTab(previousTab); }} className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-black text-slate-800">{currentViewingStudent.name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-mono font-black px-2 py-0.5 rounded-lg border ${currentViewingStudent.credits <= 5 ? 'text-rose-600 bg-rose-50 border-rose-200' : 'text-slate-700 bg-slate-50 border-slate-200'}`}>
                    剩餘 {currentViewingStudent.credits} 堂
                  </span>
                  <button 
                    onClick={() => setTriggerBuyCourseModal(true)} 
                    className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black px-2 py-1 rounded-lg flex items-center gap-0.5 shadow-xs transition active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" /> 續課
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full">
                <span className="text-sm font-black text-slate-800">學生管理清單</span>
                <button 
                  onClick={() => setIsCreateStudentOpen(true)}
                  className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black w-7 h-7 rounded-xl flex items-center justify-center shadow-xs transition active:scale-95 shrink-0"
                  title="新增學員"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            )
          )}

          {/* Tab 4 Header */}
          {activeTab === 4 && (
            <div className="flex items-center justify-between w-full">
              <span className="text-sm font-black text-slate-800">老師與授課統計</span>
              {userRole === 'admin' && !selectedTeacherId && (
                <button 
                  onClick={() => setIsCreateTeacherOpen(true)}
                  className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black w-7 h-7 rounded-xl flex items-center justify-center shadow-xs transition active:scale-95 shrink-0"
                  title="新增老師"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Tab 5 Header */}
          {activeTab === 5 && (
            <div className="flex items-center justify-between w-full">
              <span className="text-sm font-black text-slate-800">規範與日誌審核</span>
              <span className="text-[10px] text-slate-400 font-mono">即時稽核中</span>
            </div>
          )}
        </header>

        {/* 浮動切換者按鈕 */}
        <div className="fixed bottom-20 left-4 z-40">
          <button
            onClick={() => {
              setUserRole(prev => prev === 'admin' ? 'teacher' : 'admin');
              setActiveTab(2);
              setSelectedStudentId(null);
              setSelectedTeacherId(null);
              showToast(`已切換為：${userRole === 'admin' ? '一般老師視角' : 'Daisy 管理者視角'}`);
            }}
            title="點擊切換身分視角"
            className={`px-3 py-1.5 rounded-2xl font-black text-xs shadow-xl border flex items-center gap-1.5 backdrop-blur-md transition hover:scale-105 active:scale-95 ${
              userRole === 'admin' 
                ? 'bg-amber-500/90 text-white border-amber-300 ring-2 ring-amber-200' 
                : 'bg-sky-500/90 text-white border-sky-300 ring-2 ring-sky-200'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{userRole === 'admin' ? 'Daisy' : teachers[currentUserId]?.name}</span>
          </button>
        </div>

        {/* 核心滾動區域 (解決錨定鎖定凍結，推高底部避開導航欄) */}
        <main className="flex-1 relative bg-slate-50/50">
          <div className="absolute inset-0 overflow-y-auto p-3 sm:p-5 pb-36 [overflow-anchor:none] overscroll-y-contain">
            
            {/* Tab 1: 排班總覽 */}
            <div className={activeTab === 1 && !selectedStudentId && !selectedTeacherId ? 'block h-full' : 'hidden'}>
              <Tab1StudioCalendar 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                students={students} 
                bookings={bookings} 
                onSmartBook={handleSmartBookingSubmit}
                showToast={showToast} 
                onSelectStudent={(sName: string) => navigateToStudent(sName, 1)}
                externalBookingModalOpen={triggerTab1BookModal}
                setExternalBookingModalOpen={setTriggerTab1BookModal}
                viewMode={tab1View}
                setViewMode={setTab1View}
              />
            </div>

            {/* Tab 2: 個人課表 */}
            <div className={activeTab === 2 && !selectedStudentId && !selectedTeacherId ? 'block h-full' : 'hidden'}>
              <Tab2PersonalSchedule 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                bookings={bookings} 
                onSmartBook={handleSmartBookingSubmit}
                onExecuteReschedule={handleExecuteReschedule}
                students={students} 
                onSign={handleSign} 
                onUpdateBookingNote={(bId: any, note: any) => { 
                  setBookings(prev => prev.map(b => b.id === bId ? { ...b, teacherNote: note } : b)); 
                  showToast('備註已更新'); 
                }} 
                showToast={showToast} 
                onSelectStudent={(sName: string) => navigateToStudent(sName, 2)} 
                externalBookingModalOpen={triggerTab2BookModal}
                setExternalBookingModalOpen={setTriggerTab2BookModal}
                viewMode={tab2View}
                setViewMode={setTab2View}
              />
            </div>

            {/* Tab 3: 學生管理 */}
            {activeTab === 3 && (
              selectedStudentId ? (
                <StudentDetailView
                  student={students.find(s => s.id === selectedStudentId)!}
                  onBack={() => { setSelectedStudentId(null); setActiveTab(previousTab); }}
                  bookings={bookings}
                  onUpdateStudent={(updated: any) => setStudents(students.map(s => s.id === updated.id ? updated : s))}
                  onSign={handleSign}
                  onUpdateBookingNote={(bId: any, note: any) => { 
                    setBookings(prev => prev.map(b => b.id === bId ? { ...b, teacherNote: note } : b)); 
                    showToast('備註已更新'); 
                  }}
                  onAddBookings={handleAddBookings}
                  onExecuteReschedule={handleExecuteReschedule}
                  showToast={showToast}
                  addLog={addLog}
                  currentUserId={currentUserId}
                  teachers={teachers}
                  userRole={userRole}
                  externalBuyModalOpen={triggerBuyCourseModal}
                  setExternalBuyModalOpen={setTriggerBuyCourseModal}
                />
              ) : (
                <Tab3StudentManagement
                  currentUserId={currentUserId}
                  students={students}
                  setStudents={setStudents}
                  onSelectStudent={(id: string) => navigateToStudent(id, 3, true)}
                  isCreateModalOpen={isCreateStudentOpen}
                  setIsCreateModalOpen={setIsCreateStudentOpen}
                  onAddBookings={handleAddBookings}
                  showToast={showToast}
                  teachers={teachers}
                  bookings={bookings}
                />
              )
            )}
            
            {/* Tab 4: 老師管理 */}
            {activeTab === 4 && (
              selectedTeacherId ? (
                <TeacherDetailView 
                  teacher={teachers[selectedTeacherId]} 
                  onBack={() => setSelectedTeacherId(null)} 
                  onUpdateTeacher={(updated: any) => setTeachers({ ...teachers, [updated.id]: updated })} 
                  priorityGrid={priorityGrid}
                  showToast={showToast} 
                />
              ) : (
                <Tab4TeachersManagement 
                  userRole={userRole} 
                  currentUserId={currentUserId} 
                  teachers={teachers} 
                  setTeachers={setTeachers} 
                  bookings={bookings} 
                  priorityGrid={priorityGrid}
                  onSelectTeacher={setSelectedTeacherId} 
                  showToast={showToast} 
                  isAddTeacherOpen={isCreateTeacherOpen}
                  setIsAddTeacherOpen={setIsCreateTeacherOpen}
                />
              )
            )}

            {/* Tab 5: 規範審核 */}
            {activeTab === 5 && (
              <Tab5RulesAndAudit 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                priorityGrid={priorityGrid} 
                setPriorityGrid={setPriorityGrid} 
                reviews={reviews} 
                onReview={handleReview} 
                onReset={handleResetReview} 
                logs={logs} 
                setLogs={setLogs} 
                studioRules={studioRules} 
                setStudioRules={setStudioRules} 
                showToast={showToast} 
                addLog={addLog} 
              />
            )}
          </div>
        </main>

        {/* 底部導航 Bar */}
        <nav className="absolute bottom-0 left-0 right-0 w-full bg-white/95 backdrop-blur-md border-t border-slate-200 py-2 px-1 flex justify-around items-center z-20 shadow-lg shrink-0">
          <button onClick={() => { setActiveTab(1); setSelectedStudentId(null); setSelectedTeacherId(null); }} className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 1 && !selectedStudentId ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}>
            <CalendarIcon className="w-5 h-5 mb-0.5" /><span className="text-[10px]">排班總覽</span>
          </button>
          <button onClick={() => { setActiveTab(2); setSelectedStudentId(null); setSelectedTeacherId(null); }} className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 2 && !selectedStudentId ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}>
            <BookOpen className="w-5 h-5 mb-0.5" /><span className="text-[10px]">個人課表</span>
          </button>
          <button onClick={() => { setActiveTab(3); setSelectedStudentId(null); setSelectedTeacherId(null); }} className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 3 || selectedStudentId ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}>
            <UserIcon className="w-5 h-5 mb-0.5" /><span className="text-[10px]">學生管理</span>
          </button>
          <button onClick={() => { setActiveTab(4); setSelectedStudentId(null); setSelectedTeacherId(null); }} className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 4 && !selectedTeacherId ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}>
            <Users className="w-5 h-5 mb-0.5" /><span className="text-[10px]">老師管理</span>
          </button>
          <button onClick={() => { setActiveTab(5); setSelectedStudentId(null); setSelectedTeacherId(null); }} className={`flex flex-col items-center flex-1 py-1 relative transition ${activeTab === 5 ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}>
            <div className="relative">
              <FileText className="w-5 h-5 mb-0.5" />
              {auditBadgeColor === 'red' && (
                <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white animate-pulse shadow-sm" />
              )}
              {auditBadgeColor === 'yellow' && (
                <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white shadow-sm" />
              )}
            </div>
            <span className="text-[10px]">規範審核</span>
          </button>
        </nav>
      </div>
    </div>
  );
}