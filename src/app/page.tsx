'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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

  // --- 系統基準日 (System Base Date) ---
  // 預設為真實世界的「今天」，但保留手動覆蓋的能力以供測試
  const [systemBaseDate, setSystemBaseDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Tab 1 & Tab 2 頂部視圖控制狀態 (由 Header 統一控制)
  const [tab1View, setTab1View] = useState<'day' | 'week'>('day');
  const [tab2View, setTab2View] = useState<'day' | 'week' | 'month'>('day');

  const [priorityGrid, setPriorityGrid] = useState<Record<string, { large?: string; small?: string }>>({});

  const [teachers, setTeachers] = useState<Record<string, TeacherProfile>>(INITIAL_TEACHERS);
  const [students, setStudents] = useState<StudentItem[]>(INITIAL_STUDENTS);
  const [bookings, setBookings] = useState<BookingItem[]>(INITIAL_BOOKINGS);
  const [reviews, setReviews] = useState<ReviewItem[]>(INITIAL_REVIEWS);
  
  // 1. 初始化日誌時，強制由新到舊倒序排序（時間或 ID 最大的在最上面）
  const [logs, setLogs] = useState<AuditLogItem[]>(() => {
    return [...INITIAL_LOGS].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [studioRules, setStudioRules] = useState<string>(
    `1. 上課結束後，請協助消毒器械並將 Footbar 調至自下數第三格。\n2. 大教室優先供 1v2 雙人課程使用。\n3. 自主訓練僅得於授課前 30 分鐘內進場。`
  );

  const showToast = (msg: string) => { 
    setToastMsg(msg); 
    setTimeout(() => setToastMsg(null), 3500); 
  };
  
  // 乾淨結構化日誌產生器（新日誌絕對強制置頂）
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

    const newLogItem: AuditLogItem = { 
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
    } as any;

    // 將新日誌排在陣列第 0 位，確保最新通知絕對出現在最頂端
    setLogs(prev => [newLogItem, ...prev]);
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
  // 全域共用預約彈窗狀態
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    date: systemBaseDate,
    hour: '10',
    minute: '00',
    roomType: 'small' as 'large' | 'small',
    lessonType: '1v1' as '1v1' | '1v2',
    teacherId: currentUserId,
    studentName: ''
  });

  // 全域日期切換防呆：選取過去日期立即提示
  const handleBookingDateChange = (newDate: string) => {
    if (newDate < systemBaseDate) {
      const confirmPast = confirm(
        `【補排過去課堂提醒】\n您選擇的日期（${newDate}）已是過去時間。\n確定要安排過去時段的預約嗎？`
      );
      if (!confirmPast) {
        setBookingForm(prev => ({ ...prev, date: systemBaseDate }));
        return;
      }
    }
    setBookingForm(prev => ({ ...prev, date: newDate }));
  };

  // 開啟全域預約彈窗的統一入口
  const openGlobalBooking = (preset?: Partial<typeof bookingForm>) => {
    console.log('🔥 點擊了 + 按鈕，正在開啟預約彈窗...', preset);
    // 預設學員
    const myStudents = (students || []).filter(
      (s: any) => s.teacherId === currentUserId
    );
    const defaultStudent = myStudents[0]?.name || '';

    setBookingForm({
      date: preset?.date || systemBaseDate,
      hour: preset?.hour || '10',
      minute: preset?.minute || '00',
      roomType: preset?.roomType || 'small',
      lessonType: preset?.lessonType || '1v1',
      teacherId: preset?.teacherId || currentUserId,
      studentName: preset?.studentName || defaultStudent
    });

    setIsBookingModalOpen(true);
  };

  // 支援重排替換 (Clean Baseline) 與一般新增累加
  const handleAddBookings = (newBks: BookingItem[], cleanBase?: BookingItem[]) => {
    if (cleanBase) {
      setBookings([...cleanBase, ...newBks]);
    } else {
      setBookings(prev => [...prev, ...newBks]);
    }
  };

  // 1v2 智能調度引擎 (優先時段提醒 + Daisy 1v1 自動對調)
  // 1v2 智能調度引擎 (優先時段提醒 + 堂數額度調配 + Daisy 1v1 自動對調)
  const handleSmartBookingSubmit = (newBk: BookingItem) => {
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][new Date(newBk.date).getDay()];
    const slotKey = `${dayOfWeek}-${newBk.startHour}`;
    const priority = priorityGrid[slotKey] || {};
    const formattedDate = formatDateWithDay(newBk.date);
    const timeFormatted = formatTimeStr(newBk.startHour, newBk.startMin);
    const currentTeacherName = (teachers[newBk.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim();

    // 1. 優先時段提醒（若該時段有其他老師優先但尚未預約，先跳提醒確認）
    const targetPriorityTeacher = priority[newBk.roomType];
    if (targetPriorityTeacher && targetPriorityTeacher !== newBk.teacherId) {
      const pName = (teachers[targetPriorityTeacher]?.name || '其他老師').replace(/ 老師|老師/g, '').trim();
      const roomLabel = newBk.roomType === 'large' ? '大教室' : '小教室';
      const proceed = confirm(
        `【優先時段提醒】\n${formattedDate} ${timeFormatted} ${roomLabel} 為 ${pName} 老師的優先時段（目前尚未預約）。\n\n是否仍要執行預約？`
      );
      if (!proceed) return;
    }

    // 🌟 1.5 堂數額度調配與自動讓位機制 (防止 預排 > 剩餘)
    let currentBookings = [...bookings];
    const targetStudent = students.find(s => s.name === newBk.studentName || s.id === newBk.studentId);
    
    if (targetStudent) {
      const remainingCredits = targetStudent.credits ?? 0;

      // 抓出該學員「未來所有尚未完成、有效的預排課堂」（依日期由近到遠排序）
      const futureBookings = currentBookings
        .filter(b => 
          (b.studentId === targetStudent.id || b.studentName === targetStudent.name) &&
          b.date >= systemBaseDate &&
          b.status !== 'cancelled_normal' &&
          !b.signed
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);

      // 判斷加上這堂新課後是否會超出剩餘堂數
      if (futureBookings.length + 1 > remainingCredits) {
        
        // 尋找排在最遠、最後一堂的自動排課 (依據 isAuto 標籤；若無標籤則取未來最後一堂)
        const lastAutoBk = [...futureBookings].reverse().find(b => b.isAuto || b.type === 'auto_batch' || true);

        // 情境 A：剩餘堂數仍大於 0，手動加課會擠爆名額 ➔ 自動釋出最後一堂自動排課
        if (remainingCredits > 0 && lastAutoBk) {
          const lastDateStr = formatDateWithDay(lastAutoBk.date);
          const lastTimeStr = formatTimeStr(lastAutoBk.startHour, lastAutoBk.startMin);
          
          const confirmReplace = confirm(
            `【排課名額調配提醒】\n` +
            `學員「${targetStudent.name}」剩餘堂數為 ${remainingCredits} 堂。\n` +
            `本次臨時加課將導致名額超額！\n\n` +
            `系統將自動釋出最後一堂預排課堂：\n` +
            `👉 ${lastDateStr} ${lastTimeStr}\n\n` +
            `是否確認以此手動加課替換該堂預約？`
          );

          if (!confirmReplace) return;

          // 將該堂自動排課剔除
          currentBookings = currentBookings.filter(b => b.id !== lastAutoBk.id);

          addLog(
            `因臨時加課 (${formattedDate} ${timeFormatted})，系統自動釋出最後一堂預排：${lastDateStr} ${lastTimeStr}`,
            '調度',
            'yellow',
            targetStudent.name,
            newBk.teacherId,
            undefined,
            undefined,
            '系統調配'
          );

        } else {
          // 情境 B：剩餘 <= 0 或無課可退 ➔ 強制透支預排
          const confirmOverdraft = confirm(
            `【學員堂數不足提醒】\n` +
            `學員「${targetStudent.name}」目前剩餘堂數為 ${remainingCredits} 堂，已無可用額度。\n\n` +
            `是否確認強制預排此堂課？\n` +
            `（預排後將進入透支狀態，待學員後續購買續課後會自動抵扣恢復）`
          );

          if (!confirmOverdraft) return;
        }
      }
    }

    // 2. 檢驗大教室佔用情況
    const bigRoomOccupied = currentBookings.find(b => 
      b.date === newBk.date && 
      b.roomType === 'large' && 
      b.status !== 'cancelled_normal' &&
      b.status !== 'special_approved' &&
      b.status !== 'special_rejected' &&
      !(newBk.startHour * 60 + newBk.startMin + 50 <= b.startHour * 60 + b.startMin || 
        newBk.startHour * 60 + newBk.startMin >= b.startHour * 60 + b.startMin + (b.durationMins || 50))
    );

    // 3. 執行智慧自動對調：新課為 1v2 大教室 + 大教室已被「任何老師」之 1v1 佔用 + 小教室全空
    if (newBk.lessonType === '1v2' && newBk.roomType === 'large') {
      const overlappingBks = currentBookings.filter(b => 
        b.date === newBk.date &&
        b.roomType === 'large' &&
        b.status !== 'cancelled_normal' &&
        b.status !== 'special_approved' &&
        b.status !== 'special_rejected' &&
        !(newBk.startHour * 60 + newBk.startMin + 50 <= b.startHour * 60 + b.startMin || 
          newBk.startHour * 60 + newBk.startMin >= b.startHour * 60 + b.startMin + (b.durationMins || 50))
      );

      // 若所有重疊的課堂皆為 1v1
      if (overlappingBks.length > 0 && overlappingBks.every(b => b.lessonType === '1v1')) {
        const smallRoomBlocked = currentBookings.some(b => {
          if (b.date !== newBk.date || b.roomType !== 'small' || b.status === 'cancelled_normal' || b.status === 'special_approved' || b.status === 'special_rejected') return false;
          const bStart = b.startHour * 60 + b.startMin;
          const bEnd = bStart + (b.durationMins || 50);
          return overlappingBks.some(displaced => {
             const dStart = displaced.startHour * 60 + displaced.startMin;
             const dEnd = dStart + (displaced.durationMins || 50);
             return !(bEnd <= dStart || bStart >= dEnd);
          });
        });

        if (!smallRoomBlocked) {
          // 批量對調：將所有重疊的 1v1 移至小教室，新 1v2 進駐大教室
          const overlappingIds = overlappingBks.map(b => b.id);
          setBookings([
            ...currentBookings.map(b => overlappingIds.includes(b.id) ? { ...b, roomType: 'small' as const } : b),
            newBk
          ]);

          const displacedNames = overlappingBks.map(b => b.studentName).join('、');
          
          addLog(
            `時間：${formattedDate} ${timeFormatted}\n原本：${displacedNames} (皆為 1v1)\n改為：${displacedNames} 移至小教室，與 🟣 ${currentTeacherName} ${newBk.studentName} (1v2) 對調`,
            '調度', 'yellow', newBk.studentName, newBk.teacherId, undefined, undefined, '系統排程'
          );

          alert(`【系統自動調度成功】\n原大教室的 ${overlappingBks.length} 堂 1v1 已移至小教室，您的 1v2 雙人課已順利排入大教室！`);
          showToast(`調度成功：原 1v1 已移至小教室！`);
          return;
        }
      }
    }

    // 一般正常預約
    setBookings([...currentBookings, newBk]);
    const finalRoomDot = newBk.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
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

  // 變更或取消預約（課表即時放行／移時段，逾期異動事後由 Daisy 裁決）
  const handleExecuteReschedule = (
    bookingId: string, 
    newDate: string, 
    newHour: number, 
    newMin: number, 
    newRoom: 'large' | 'small', 
    isCancel = false,
    newLessonType?: '1v1' | '1v2',
    reason?: string
  ) => {
    const target = bookings.find(b => b.id === bookingId);
    if (!target) return;

    const oldDateFormatted = formatDateWithDay(target.date);
    const oldTimeFormatted = formatTimeStr(target.startHour, target.startMin);
    const oldRoomLabel = target.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';

    const newDateFormatted = formatDateWithDay(newDate);
    const newTimeFormatted = formatTimeStr(newHour, newMin);
    const newRoomLabel = newRoom === 'large' ? '🟣 大教室' : '🟢 小教室';
    const finalLessonType = newLessonType || target.lessonType;
    
    const teacherName = (teachers[currentUserId]?.name || '老師').replace(/ 老師|老師/g, '').trim();

    // 判斷是否為 24 小時內之逾期異動
    const now = new Date(2026, 9, 24, 0, 0, 0).getTime();
    const [y, m, d] = target.date.split('-').map(Number);
    const bookingTime = new Date(y, m - 1, d, target.startHour, target.startMin).getTime();
    const isOverdue = (bookingTime - now) / (1000 * 60 * 60) < 24;

    // --- 管理員 Daisy 操作：直接生效 ---
    if (userRole === 'admin') {
      if (isCancel) {
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled_normal' } : b));
        addLog(
          `${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} 一般取消`, 
          '取消', 
          'normal', 
          target.studentName, 
          target.teacherId,
          undefined,
          undefined,
          'Daisy'
        );
        showToast('管理員已取消預約（時段已釋出）');
      } else {
        setBookings(prev => prev.map(b => b.id === bookingId ? { 
          ...b, 
          date: newDate, 
          startHour: newHour, 
          startMin: newMin, 
          roomType: newRoom,
          lessonType: finalLessonType
        } : b));

        addLog(
          `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} (${finalLessonType})\n結果：一般改期`, 
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
      return;
    }

    // --- 一般老師操作：課表即時更新，事後交由 Daisy 審核事由 ---
    // --- 一般老師操作：逾期異動強制送審，提示聚焦「送審判定計罰」 ---
    if (isCancel) {
      if (isOverdue) {
        // 逾期取消：課堂標為待審核取消（排班表釋出，但日誌與審核連動）
        const newRev: ReviewItem = {
          id: `rev-${Date.now()}`,
          bookingId,
          teacherId: currentUserId,
          teacherName,
          studentName: target.studentName,
          date: target.date,
          time: `${oldDateFormatted} ${oldTimeFormatted}`,
          room: target.roomType === 'large' ? '大教室' : '小教室',
          lessonType: finalLessonType,
          reason: reason || '學員逾期臨時取消',
          status: 'pending',
          reviewType: 'cancel'
        };

        // 標註為 special_pending（待管理員審核計罰/免罰）
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'special_pending' as const } : b));
        setReviews(prev => [newRev, ...prev]);

        addLog(
          `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n結果：逾期取消送審（待 Daisy 裁決計罰/免罰）\n事由：${reason || '未填寫原因'}`, 
          '取消', 
          'red', 
          target.studentName, 
          currentUserId, 
          newRev.id,
          undefined,
          teacherName
        );

        // 提示重心改為「已送審待判定計罰」
        alert(`【逾期取消已送審】\n課堂已完成取消登記，事由已送交管理員 Daisy 進行逾期審核，將依規定裁決「計罰」或「免罰」。`);
        showToast('逾期取消申請已送出，待管理員審核');
      } else {
        // 提早 24 小時以上：正常取消（免審核）
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled_normal' as const } : b));
        addLog(
          `${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} 提前正常取消`, 
          '取消', 
          'normal', 
          target.studentName, 
          currentUserId, 
          undefined,
          undefined,
          teacherName
        );
        showToast('預約已提前取消成功！');
      }
    } else {
      // 改期或改室：先進行新時段衝突檢查
      const conflict = checkGlobalConflict({
        dateStr: newDate,
        startHour: newHour,
        startMin: newMin,
        durationMins: target.durationMins || 50,
        roomType: newRoom,
        lessonType: finalLessonType,
        teacherId: currentUserId,
        studentId: target.studentId,
        studentName: target.studentName,
        userRole,
        existingBookings: bookings,
        teachersMap: teachers,
        studentsMap: Object.fromEntries(students.map(s => [s.id, s])),
        excludeBookingId: target.id
      });

      if (conflict.hasConflict) {
        return alert(conflict.reason);
      }

      // 2. 課表立即移至新時段（原時段釋出，新時段佔用）
      setBookings(prev => prev.map(b => b.id === bookingId ? { 
        ...b, 
        date: newDate, 
        startHour: newHour, 
        startMin: newMin, 
        roomType: newRoom,
        lessonType: finalLessonType,
        status: 'confirmed'
      } : b));

      if (isOverdue) {
        // 逾期改期：送一張審核單給 Daisy 裁決
        const newRev: ReviewItem = {
          id: `rev-${Date.now()}`,
          bookingId,
          teacherId: currentUserId,
          teacherName,
          studentName: target.studentName,
          date: target.date,
          time: `${oldDateFormatted} ${oldTimeFormatted}`,
          room: target.roomType === 'large' ? '大教室' : '小教室',
          lessonType: finalLessonType,
          reason: reason || '逾期改期申請',
          status: 'pending',
          reviewType: 'reschedule',
          reqDate: newDate,
          reqHour: newHour,
          reqMin: newMin,
          reqRoom: newRoom,
          reqLessonType: finalLessonType
        };
        setReviews(prev => [newRev, ...prev]);

        addLog(
          `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel}\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} · 結果：逾期改期（已生效，待 Daisy 裁決）\n事由：${reason || '未填寫'}`, 
          '改期', 
          'red', 
          target.studentName, 
          currentUserId, 
          newRev.id,
          undefined,
          teacherName
        );
        showToast('課堂已直接改至新時段，案件已送交 Daisy 裁決');
      } else {
        // 提早 24 小時以上改期：直接生效，不打擾 Daisy
        addLog(
          `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} (${finalLessonType})\n結果：提前正常改期`, 
          '改期', 
          'normal', 
          target.studentName, 
          currentUserId, 
          undefined,
          undefined,
          teacherName
        );
        showToast('預約已順利改期！');
      }
    }
  };
  // --- 老師手動執行：月底結算申報處理 ---
  const handleProcessSettlement = (drafts: any) => {
    let attendedMsg: string[] = [];
    let unattendedCount = 0;
    let updatedStudents = [...students];
    let newReviews = [...reviews];
    let hasChanges = false;
    
    const updatedBookings = bookings.map((b: any) => {
      if (drafts[b.id] && drafts[b.id].report !== 'pending') {
        hasChanges = true;
        const draft = drafts[b.id];
        const sIndex = updatedStudents.findIndex(stu => stu.id === b.studentId || stu.name === b.studentName);
        
        if (draft.report === 'attended_unsigned') {
          // 1. 處理未簽到：系統立即代扣堂數
          let remain = 0;
          if (sIndex !== -1) {
             updatedStudents[sIndex] = { ...updatedStudents[sIndex], credits: Math.max(0, updatedStudents[sIndex].credits - 1) };
             remain = updatedStudents[sIndex].credits;
          }
          attendedMsg.push(`• ${b.studentName} 系統代簽 扣堂-1 剩餘${remain}`);
          addLog(
            `原課堂：${formatDateWithDay(b.date)}\n結果：系統代簽認列扣 1 堂\n事由：${draft.reason || '老師回報學生有出席'}`,
            '簽到', 'normal', b.studentName, b.teacherId
          );
          return { ...b, signed: true, signedAt: getExactTimestamp(), teacherNote: draft.reason };
          
        } else if (draft.report === 'unattended_not_cancelled') {
          // 2. 處理未取消：立即送出審核
          unattendedCount++;
          const revId = `rev-settle-${Date.now()}-${b.id}`;
          newReviews.unshift({
            id: revId,
            bookingId: b.id,
            teacherId: b.teacherId,
            teacherName: teachers[b.teacherId]?.name || '老師',
            studentName: b.studentName,
            date: b.date,
            time: `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}`,
            room: b.roomType === 'large' ? '大教室' : '小教室',
            lessonType: b.lessonType,
            reason: draft.reason || '結算申報：未到課忘記取消',
            status: 'pending',
            reviewType: 'cancel'
          });
          addLog(
            `原課堂：${formatDateWithDay(b.date)}\n結果：逾期取消已送審\n事由：${draft.reason || '老師回報未到課'}`,
            '取消', 'red', b.studentName, b.teacherId, revId
          );
          return { ...b, status: 'special_pending' as const };
        }
      }
      return b;
    });

    if (!hasChanges) {
      showToast('皆設定為「暫不處理」，無課堂變更。');
      return;
    }

    setStudents(updatedStudents);
    setBookings(updatedBookings);
    setReviews(newReviews);
    
    let finalAlert = "【逾期課堂結算處理完成】\n";
    if (attendedMsg.length > 0) finalAlert += `\n[未簽到處理]\n${attendedMsg.join("\n")}\n`;
    if (unattendedCount > 0) finalAlert += `\n[未取消處理]\n已送出 ${unattendedCount} 筆逾期取消審核。 (待管理員判定)`;
    
    alert(finalAlert);
  };
  // --- 系統月底自動結算引擎（模擬 10/31 23:59） ---
  const handleExecuteMonthEnd = () => {
    if (!confirm('【系統月底結算模擬】\n確定要執行嗎？\n(所有尚未處理的逾期課堂，將強制結算為老師逾期未取消並計罰)')) return;

    let settledCount = 0;
    // 找出所有逾期未簽到的課堂
    const overdueUnsignedList = bookings.filter(b => !b.signed && b.status === 'confirmed' && b.date <= '2026-10-31');

    const updatedBookings = bookings.map(b => {
      const isTarget = overdueUnsignedList.some(item => item.id === b.id);
      if (!isTarget) return b;
      
      settledCount++;
      // 壓線皆未處理 ➔ 強制判定為 special_rejected（計罰取消），累積至 Tab 4 統計表
      addLog(
        `原課堂：${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}\n結果：系統強制結算為逾期未取消 (計罰)\n事由：老師於月底前均未回報處理`,
        '取消', 'red', b.studentName, b.teacherId, undefined, undefined, '系統結算'
      );
      return { ...b, status: 'special_rejected' as const, teacherNote: '系統月底結算：老師未處理逾期' };
    });

    setBookings(updatedBookings);
    alert(`【系統月底結算完成】\n共強制結算 ${settledCount} 堂未處理逾期課堂為「計罰取消」。`);
  };
  // 審核處理（結果日誌統一第三行備註事由）
  const handleReview = (reviewId: string, decision: 'approved' | 'rejected') => {
    const rev = reviews.find(r => r.id === reviewId) as any;
    if (!rev) return;

    const targetBooking = bookings.find(b => b.id === rev.bookingId);
    const studentName = targetBooking?.studentName || rev.studentName || '';
    const cleanTeacher = (rev.teacherName || '老師').replace(/ 老師|老師/g, '').trim();
    const revTimeStr = rev.time?.includes('(') ? rev.time : `${formatDateWithDay(rev.date)} ${rev.time || ''}`;
    const reasonText = rev.reason ? `\n事由：${rev.reason}` : '';

    // 1. 改教室審核
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

      const oldDot = targetBooking?.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
      const newDot = rev.reqRoom === 'large' ? '🟣 大教室' : '🟢 小教室';

      addLog(
        `原課堂：${revTimeStr} ${oldDot}\n改至：${newDot} · 結果：${isApproved ? '核准' : '駁回'}${reasonText}`, 
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
    // 2. 改期審核
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

      const oldDot = targetBooking?.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
      const newDot = rev.reqRoom === 'large' ? '🟣 大教室' : '🟢 小教室';
      const newTimeStr = `${formatDateWithDay(rev.reqDate)} ${formatTimeStr(rev.reqHour, rev.reqMin)}`;

      addLog(
        `原課堂：${revTimeStr} ${oldDot}\n改至：${newTimeStr} ${newDot} · 結果：${typeLabel}${reasonText}`, 
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
    // 3. 取消審核
    else {
      const isExempt = decision === 'approved';
      const newStatus = isExempt ? 'special_approved' : 'special_rejected';

      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, status: newStatus } : b));
      setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: decision } : r));

      const roomText = targetBooking?.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';

      addLog(
        `原課堂：${revTimeStr} ${roomText}\n結果：${isExempt ? '免罰取消' : '計罰取消'}${reasonText}`, 
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

  // 簽到與補簽共用核心引擎 (支援正常簽到與逾期補簽)
  const handleSign = (
    bookingId: string, 
    signatureDataUrl: string, 
    timestamp: string, 
    isLate: boolean = false
  ) => {
    console.log("🌟 handleSign 接收到:", { bookingId, isLate });
    // 1. 同步找出目標課堂與學生資訊
    const targetBooking = bookings.find(b => b.id === bookingId);
    if (!targetBooking) {
      console.warn("⚠️ 找不到對應課堂 ID:", bookingId);
      return;
    }

    const sId = targetBooking.studentId;
    const sName = targetBooking.studentName || '';
    const bDate = formatDateWithDay(targetBooking.date);
    const bTime = formatTimeStr(targetBooking.startHour, targetBooking.startMin);
    const tName = (teachers[targetBooking.teacherId || currentUserId]?.name || 'Daisy').replace(/ 老師|老師/g, '').trim();

    // 2. 計算扣除後的剩餘堂數 (若已透支允許扣至 0 或負數，此處配合既有邏輯取 Math.max(0, ...))
    let afterC = 0;
    const targetStudent = students.find(s => s.id === sId || s.name === sName);
    if (targetStudent) {
      afterC = Math.max(0, targetStudent.credits - 1);
    }

    // 3. 扣除學員堂數
    setStudents(prev => prev.map(s => {
      if (s.id === sId || s.name === sName) {
        return { ...s, credits: Math.max(0, s.credits - 1) };
      }
      return s;
    }));

    // 4. 更新課堂狀態：補簽加上 isLateSigned 標記，並保存簽名檔
    setBookings(prev => prev.map(b =>
      b.id === bookingId
        ? { 
            ...b, 
            signed: true, 
            isLateSigned: isLate, // 🌟 補簽標籤
            signatureData: signatureDataUrl, 
            signedName: sName, // 🌟 保存簽名人姓名避免消失
            signedAt: timestamp 
          }
        : b
    ));

    // 5. 日誌記錄與彈窗提示分流
    const actionLabel = isLate ? '補簽' : '簽到';
    const logBadgeColor = isLate ? 'yellow' : 'normal';

    addLog(
      `${bDate} ${bTime} [${actionLabel}] -1堂  餘 ${afterC} 堂`, 
      actionLabel, 
      logBadgeColor, 
      sName, 
      targetBooking.teacherId || currentUserId,
      undefined,
      afterC,
      tName
    );

    showToast(`${actionLabel}完成！[${sName}] 已扣 1 堂，剩餘 ${afterC} 堂`);
  };
  const handleUpdateBookingNote = (bookingId: string, note: string) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, teacherNote: note } : b));
    showToast('備註已更新');
  };

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

  // --- 任務 3：月底倒數 5 天判斷與逾期未簽課堂統計 ---
  const todayStr =  systemBaseDate
  // 1. 計算當月剩餘天數（是否進入最後 5 天）
  const monthEndCountdown = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const lastDayOfMonth = new Date(y, m, 0).getDate(); // 取得當月最後一天（如 10 月為 31）
    const daysLeft = lastDayOfMonth - d;
    return {
      isLast5Days: daysLeft < 5, // 剩餘天數 < 5 天（即 27~31 號，包含最後 5 天）
      daysLeft: Math.max(0, daysLeft),
      lastDayStr: `${m}/${lastDayOfMonth}`
    };
  }, [todayStr]);

  // 2. 統計該老師目前逾期未簽到的課堂筆數（排除已取消與已簽到）
  const overdueUnsignedList = useMemo(() => {
    return bookings.filter(b => {
      if (b.status === 'cancelled_normal' || b.status === 'special_approved' || b.status === 'special_rejected') return false;
      if (b.signed) return false;
      const isTargetTeacher = userRole === 'admin' ? true : b.teacherId === currentUserId;
      return isTargetTeacher && b.date <= todayStr;
    });
  }, [bookings, userRole, currentUserId, todayStr]);

  return (
    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
      <div className="flex flex-col h-screen md:h-[94vh] max-h-screen md:max-h-[960px] w-full max-w-md md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-slate-50 shadow-2xl relative border-x md:border border-slate-200 md:rounded-3xl overflow-hidden font-sans">
        
        {toastMsg && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-white text-xs px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <Sparkles className="w-4 h-4 text-amber-400" /><span className="font-bold">{toastMsg}</span>
          </div>
        )}
        {/* 🧪 開發測試專用：時間旅行面板 (正式上線前移除即可) */}
      <div className="bg-slate-800 text-white text-xs px-3 py-1.5 flex items-center justify-between z-50">
        <div className="flex items-center gap-2">
          <span className="font-bold text-amber-400">🧪 測試模式</span>
          <span>基準日：{systemBaseDate}</span>
        </div>
        <select 
          value={systemBaseDate} 
          onChange={(e) => setSystemBaseDate(e.target.value)}
          className="bg-slate-700 text-white border border-slate-600 rounded px-2 py-0.5 outline-none cursor-pointer"
        >
          <option value="2026-10-24">回到 10/24 (原始狀態)</option>
          <option value="2026-10-28">跳至 10/28 (進入月底五天)</option>
          <option value="2026-10-30">跳至 10/30 (結算前夕)</option>
          <option value="2026-10-31">跳至 10/31 (壓線最後一天)</option>
          <option value="2026-11-01">跳至 11/01 (跨月)</option>
        </select>
      </div>
        {/* 頂部 Header */}
        <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 z-20">

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
                onClick={() => openGlobalBooking()}
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
                onClick={() => openGlobalBooking()}
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
              {userRole === 'admin' ? (
                <button 
                  onClick={handleExecuteMonthEnd} 
                  className="bg-amber-100 hover:bg-amber-200 active:scale-95 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-xl text-[11px] font-black shadow-2xs transition"
                >
                  ⚡ 模擬月底結算
                </button>
              ) : (
                <span className="text-[10px] text-slate-400 font-mono">即時稽核中</span>
              )}
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
        <main className="flex-1 overflow-y-auto p-3 pb-20">
          
            {/* Tab 1: 排班總覽（打通高度伸展） */}
            <div className={activeTab === 1 && !selectedStudentId && !selectedTeacherId ? 'flex flex-col h-full min-h-0 flex-1' : 'hidden'}>
              <Tab1StudioCalendar
                systemBaseDate={systemBaseDate} 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                students={students} 
                bookings={bookings} 
                reviews={reviews} 
                onSmartBook={handleSmartBookingSubmit}
                showToast={showToast} 
                onSelectStudent={(sName: string) => navigateToStudent(sName, 1)}
                externalBookingModalOpen={triggerTab1BookModal}
                setExternalBookingModalOpen={setTriggerTab1BookModal}
                viewMode={tab1View}
                setViewMode={setTab1View}
                openGlobalBooking={openGlobalBooking}
              />
            </div>

            {/* Tab 2: 個人課表 */}
            <div className={activeTab === 2 && !selectedStudentId && !selectedTeacherId ? 'block h-full' : 'hidden'}>
              <Tab2PersonalSchedule
                systemBaseDate={systemBaseDate} 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                bookings={bookings}
                onAddBookings={handleAddBookings} 
                onProcessSettlement={handleProcessSettlement}
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
                openGlobalBooking={openGlobalBooking}
              />
            </div>

            {/* Tab 3: 學生管理 */}
            {activeTab === 3 && (
              selectedStudentId ? (
                <StudentDetailView
                  systemBaseDate={systemBaseDate}
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
                  systemBaseDate={systemBaseDate}
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
        {/* 🌟 統一全域預約彈窗（完美圖一版面） */}
      {isBookingModalOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          style={{ zIndex: 99999 }}
        >
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl relative space-y-4">
            
            {/* 標題與關閉按鈕 */}
            <div className="flex justify-between items-center pb-1">
              <h3 className="font-black text-lg text-slate-800 tracking-tight">新增預約</h3>
              <button 
                type="button" 
                onClick={() => setIsBookingModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xl font-bold p-1 leading-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-sm">
              {/* 1. 選擇學員 (帶剩餘堂數與預設課型) */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">選擇學員</label>
                <div className="relative">
                  <select
                    value={bookingForm.studentName}
                    onChange={(e) => {
                      const name = e.target.value;
                      const s = students.find((st: any) => st.name === name);
                      setBookingForm(prev => ({
                        ...prev,
                        studentName: name,
                        lessonType: s?.defaultLessonType || prev.lessonType
                      }));
                    }}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold appearance-none outline-none focus:border-rose-500"
                  >
                    {students
                      .filter((s: any) =>  s.teacherId === currentUserId)
                      .map((s: any) => (
                        <option key={s.id} value={s.name}>
                          {s.name} ({s.credits ?? 0}堂) - {s.defaultLessonType || '1v1'}
                        </option>
                      ))}
                  </select>
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
                </div>
              </div>

              {/* 2. 預約日期 (選到過去日期立即防呆) */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">預約日期</label>
                <input
                  type="date"
                  value={bookingForm.date}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    if (newDate < systemBaseDate) {
                      const ok = confirm(`【補排過去課堂提醒】\n您選擇的日期（${newDate}）已過。\n確定要預約過去時段嗎？`);
                      if (!ok) return;
                    }
                    setBookingForm(prev => ({ ...prev, date: newDate }));
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold outline-none focus:border-rose-500"
                />
              </div>

              {/* 3. 時 (Hour) 與 分 (10 分鐘為單位) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">時 (Hour)</label>
                  <div className="relative">
                    <select
                      value={bookingForm.hour}
                      onChange={(e) => setBookingForm(prev => ({ ...prev, hour: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold appearance-none outline-none focus:border-rose-500"
                    >
                      {Array.from({ length: 14 }, (_, i) => i + 8).map(h => (
                        <option key={h} value={String(h).padStart(2, '0')}>{String(h).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">分 (10 分鐘為單位)</label>
                  <div className="relative">
                    <select
                      value={bookingForm.minute}
                      onChange={(e) => setBookingForm(prev => ({ ...prev, minute: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold appearance-none outline-none focus:border-rose-500"
                    >
                      {['00', '10', '20', '30', '40', '50'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
                  </div>
                </div>
              </div>

              {/* 4. 教室選擇 (帶彩色圓點) 與 課程種類 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">教室選擇</label>
                  <div className="relative">
                    <select
                      value={bookingForm.roomType}
                      onChange={(e) => setBookingForm(prev => ({ ...prev, roomType: e.target.value as any }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold appearance-none outline-none focus:border-rose-500"
                    >
                      <option value="large">🟣 大教室</option>
                      <option value="small">🟢 小教室</option>
                    </select>
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">課程種類</label>
                  <div className="relative">
                    <select
                      value={bookingForm.lessonType}
                      onChange={(e) => setBookingForm(prev => ({ ...prev, lessonType: e.target.value as any }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 text-slate-800 font-bold appearance-none outline-none focus:border-rose-500"
                    >
                      <option value="1v1">1v1 單人</option>
                      <option value="1v2">1v2 雙人</option>
                    </select>
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 按鈕組 */}
            <div className="grid grid-cols-2 gap-3 pt-3">
              <button
                type="button"
                onClick={() => setIsBookingModalOpen(false)}
                className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!bookingForm.studentName) return alert('請選擇學員');
                  const s = students.find((st: any) => st.name === bookingForm.studentName);
                  const newBooking = {
                    id: `b-${Date.now()}`,
                    date: bookingForm.date,
                    startHour: parseInt(bookingForm.hour, 10),
                    startMin: parseInt(bookingForm.minute, 10),
                    durationMins: 50,
                    teacherId: bookingForm.teacherId,
                    studentName: bookingForm.studentName,
                    studentId: s?.id || '',
                    roomType: bookingForm.roomType,
                    lessonType: bookingForm.lessonType,
                    status: 'confirmed',
                    signed: false
                  };
                  setBookings((prev: any[]) => [...prev, newBooking]);
                  setIsBookingModalOpen(false);
                }}
                className="w-full py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold transition active:scale-95 shadow-md shadow-rose-200"
              >
                確認預約
              </button>
            </div>

          </div>
        </div>
      )}

      </div>
    </div>
  );
}