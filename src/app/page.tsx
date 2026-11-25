'use client';
import { genId } from '../utils/id';

import React, { useState, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, Users, FileText, BookOpen, User as UserIcon, Plus, ArrowLeft, RotateCcw, Sparkles } from 'lucide-react';
import { 
  ScheduleEngine,
  checkGlobalConflict,
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
  BusinessHoursConfig,
  formatDateWithDay,
  formatTimeStr
} from '../mockData';

import Tab1StudioCalendar from '../components/Tab1StudioCalendar';
import Tab2PersonalSchedule from '../components/Tab2PersonalSchedule';
import Tab3StudentManagement, { StudentDetailView } from '../components/Tab3StudentManagement';
import Tab4TeachersManagement, { TeacherDetailView } from '../components/Tab4TeachersManagement';
import Tab5RulesAndAudit from '../components/Tab5RulesAndAudit';
import {
  DEFAULT_BUSINESS_HOURS,
  getDisplayHours,
  canRelocateToSmall,
  findReplaceableAutoBooking,
  getStudentBookingPreset,
  isActionableBooking,
  isWithin24Hours,
  isOverdueUnsettled,
  applyPendingHolds,
  getSignatureWindowStatus,
  matchesStudent,
  occupiesQuota,
  validateAndBuildBooking,
  formatRules,
} from '../utils/bookingRules';
import type { AutoSwapItem, BookingRequestInput } from '../utils/bookingRules';
import { formatSubmittedAt, getLogSeverity } from '../utils/bookingRules';
import { systemAlert, registerSystemAlert, systemConfirm, systemPrompt, registerSystemDialog, type SystemAlertPayload, type SystemDialogRequest } from '../utils/systemAlert';

const ADMIN_ID = 't-daisy';

type LogLevel = 'red' | 'yellow' | 'normal' | 'gray';

const getExactTimestamp = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
};

export default function Home() {
  const [systemAlertModal, setSystemAlertModal] = useState<SystemAlertPayload | null>(null);
  useEffect(() => registerSystemAlert(setSystemAlertModal), []);
  const [systemDialog, setSystemDialog] = useState<SystemDialogRequest | null>(null);
  const [systemDialogInput, setSystemDialogInput] = useState('');
  useEffect(() => registerSystemDialog(r => { setSystemDialogInput(''); setSystemDialog(r); }), []);
  const closeSystemDialog = (value: boolean | string | null) => {
    systemDialog?.resolve(value);
    setSystemDialog(null);
  };
  const [userRole, setUserRole] = useState<'admin' | 'teacher'>('admin');
  const currentUserId = userRole === 'admin' ? ADMIN_ID : 't-1';
  
  const [activeTab, setActiveTab] = useState<number>(2);
  const [previousTab, setPreviousTab] = useState<number>(2);
  
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);

  // 頂部動作觸發器
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
  const [businessHours, setBusinessHours] = useState<BusinessHoursConfig>(DEFAULT_BUSINESS_HOURS);
  
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
  
  // 乾淨結構化日誌建構（不寫入狀態；供「先全部建好再一次寫入」的流程使用）
  const buildLogItem = (
    detail: string, 
    typeStr: string, 
    category: LogLevel = 'normal', 
    sName: string = '', 
    tId?: string, 
    rId?: string,
    remainingCredits?: number,
    tName?: string
  ): AuditLogItem => {
    const timeFormatted = getExactTimestamp().slice(5, 16);
    const teacherDisplayName = (tName || (userRole === 'admin' ? 'Daisy' : teachers[currentUserId]?.name || '老師'))
      .replace(/ 老師|老師|\(管理者\)/g, '')
      .trim();
    const cleanStudentName = sName === '學員' || sName === '-' ? '' : sName;

    return { 
      id: genId('l'), 
      time: timeFormatted, 
      actor: teacherDisplayName, 
      teacherName: teacherDisplayName,
      studentName: cleanStudentName, 
      action: detail, 
      detail: detail,
      typeStr, 
      // 分級：gray（灰階，一般紀錄，不計未讀）/ yellow / red；category 為相容舊欄位（gray → normal）
      severity: category === 'normal' ? 'gray' : category,
      category: category === 'gray' ? 'normal' : category, 
      read: false, 
      teacherId: tId || currentUserId, 
      reviewId: rId,
      remainingCredits: typeof remainingCredits === 'number' && Number.isFinite(remainingCredits) ? remainingCredits : undefined
    } as any;
  };

  // 日誌寫入（新日誌絕對強制置頂），回傳已寫入的日誌
  const addLog = (
    detail: string, 
    typeStr: string, 
    category: LogLevel = 'normal', 
    sName: string = '', 
    tId?: string, 
    rId?: string,
    remainingCredits?: number,
    tName?: string
  ): AuditLogItem => {
    const item = buildLogItem(detail, typeStr, category, sName, tId, rId, remainingCredits, tName);
    setLogs(prev => [item, ...prev]);
    return item;
  };

  // 大教室讓位：為每位「被移課的原老師」各建立一筆系統調度通知
  const buildSwapLogItems = (
    swaps: AutoSwapItem[],
    ctx: { byTeacherName: string; newStudentName: string; newLessonType: '1v1' | '1v2' }
  ): AuditLogItem[] => {
    const byTeacher = new Map<string, AutoSwapItem[]>();
    swaps.forEach(sw => byTeacher.set(sw.teacherId, [...(byTeacher.get(sw.teacherId) || []), sw]));
    return Array.from(byTeacher.entries()).map(([tid, items]) => {
      const lines = items
        .map(sw => `${formatDateWithDay(sw.date)} ${formatTimeStr(sw.startHour, sw.startMin)} ${sw.studentName} (1v1)：🟣 大教室 ➔ 🟢 小教室`)
        .join('\n');
      return buildLogItem(
        `系統調度通知：因 ${ctx.byTeacherName} 老師的 ${ctx.newStudentName} (${ctx.newLessonType}) 預約需使用大教室，您的下列課堂已自動移至小教室\n${lines}`,
        '調度', 'yellow', items.map(sw => sw.studentName).join('、'), tid, undefined, undefined, '系統調度'
      );
    });
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
  // 審核期間的卡位（改室審核同時卡住原教室與目標教室）：僅供衝堂檢測 / 日曆顯示，不寫回課堂資料
  const bookingsWithHolds = useMemo(() => applyPendingHolds(bookings, reviews), [bookings, reviews]);

  // 全域共用預約彈窗狀態
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [afterHoursReasonInput, setAfterHoursReasonInput] = useState('');
  const [bookingForm, setBookingForm] = useState({
    date: systemBaseDate,
    hour: '10',
    minute: '00',
    roomType: 'small' as 'large' | 'small',
    lessonType: '1v1' as '1v1' | '1v2',
    teacherId: currentUserId,
    studentName: ''
  });

  // 開啟全域預約彈窗的統一入口
  const openGlobalBooking = (preset?: Partial<typeof bookingForm>) => {
    // 預設學員
    const myStudents = (students || []).filter(
      (s: any) => s.teacherId === currentUserId
    );
    const defaultStudent = myStudents[0]?.name || '';
    const defaultPreset = getStudentBookingPreset(myStudents.find((s: any) => s.name === (preset?.studentName || defaultStudent)), userRole);

    setBookingForm({
      date: preset?.date || systemBaseDate,
      hour: String(preset?.hour || '10').padStart(2, '0'),
      minute: String(preset?.minute || '00').padStart(2, '0'),
      roomType: preset?.roomType || defaultPreset.roomType,
      lessonType: preset?.lessonType || defaultPreset.lessonType,
      teacherId: preset?.teacherId || currentUserId,
      studentName: preset?.studentName || defaultStudent
    });

    setAfterHoursReasonInput('');
    setIsBookingModalOpen(true);
  };

  // 預約彈窗即時檢測（日期 / 時間 / 教室 / 學員任一變動即重算），用於按鈕上方的紅字 / 琥珀色提示卡
  const bookingCheck = useMemo(() => {
    if (!isBookingModalOpen) return null;
    const stu = students.find(st => st.name === bookingForm.studentName);
    if (!stu) return null;
    return validateAndBuildBooking({
      input: {
        date: bookingForm.date,
        startHour: parseInt(bookingForm.hour, 10),
        startMin: parseInt(bookingForm.minute, 10),
        durationMins: 50,
        teacherId: bookingForm.teacherId,
        studentId: stu.id,
        studentName: stu.name,
        roomType: bookingForm.roomType,
        lessonType: bookingForm.lessonType,
      },
      userRole,
      systemBaseDate,
      businessHours,
      priorityGrid,
      bookings: bookingsWithHolds,
      teachers,
      students,
    });
  }, [isBookingModalOpen, bookingForm, students, userRole, systemBaseDate, businessHours, priorityGrid, bookingsWithHolds, teachers]);

  // 學員資料修改：套用並寫入灰階紀錄（內容沒有實際變動則不寫）
  const handleUpdateStudent = (patch: any) => {
    const cur = students.find(s => s.id === patch.id);
    if (!cur) return;
    const labels: Record<string, string> = {
      note: '備註', rules: '排課規則', name: '姓名', phone: '電話', teacherId: '負責老師', status: '狀態',
      defaultLessonType: '預設課程類別', lessonType: '課程類別', noRegularRule: '固定排課設定',
    };
    const changes = Object.keys(patch)
      .filter(k => k !== 'id' && JSON.stringify((cur as any)[k] ?? null) !== JSON.stringify(patch[k] ?? null));
    if (changes.length === 0) return;
    setStudents(prev => prev.map(s => s.id === patch.id ? { ...s, ...patch } : s));
    const lines = changes.map(k => {
      if (k === 'rules') return `${labels[k]}：${formatRules((cur as any)[k])} ➔ ${formatRules(patch[k])}`;
      if (k === 'note') return `${labels[k]}：${(cur as any)[k] || '（空）'} ➔ ${patch[k] || '（空）'}`;
      return `${labels[k] || k}：${String((cur as any)[k] ?? '（空）')} ➔ ${String(patch[k] ?? '（空）')}`;
    });
    addLog(`學員資料修改\n${lines.join('\n')}`, '學員資料', 'gray', cur.name, cur.teacherId);
  };

  // 非營業時間待審課堂送審：多堂合併為一張批次審核單（核准 / 駁回一次套用），並發一則紅色通知
  const submitAfterHoursBatch = (list: BookingItem[], reason: string) => {
    if (list.length === 0) return;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
    const first = sorted[0];
    const isBatch = sorted.length > 1;
    const revId = `rev-ah-${first.id}`;
    const tName = (teachers[first.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim();
    const lines = sorted.map(b =>
      `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)} ${b.roomType === 'large' ? '🟣 大教室' : '🟢 小教室'} (${b.lessonType})`
    ).join('\n');
    const firstTime = `${formatDateWithDay(first.date)} ${formatTimeStr(first.startHour, first.startMin)}`;
    const rev: ReviewItem = {
      id: revId,
      bookingId: first.id,
      batchBookingIds: isBatch ? sorted.map(b => b.id) : undefined,
      teacherId: first.teacherId,
      teacherName: teachers[first.teacherId]?.name || '老師',
      studentName: first.studentName,
      date: first.date,
      time: isBatch ? `${firstTime} 起 (共 ${sorted.length} 堂)` : firstTime,
      room: first.roomType === 'large' ? '大教室' : '小教室',
      lessonType: first.lessonType,
      reason,
      status: 'pending',
      reviewType: 'after_hours',
      submittedAt: formatSubmittedAt(),
    };
    setReviews(prev => [rev, ...prev]);
    setLogs(prev => [
      buildLogItem(
        `預約：${isBatch ? `共 ${sorted.length} 堂` : firstTime}\n結果：非營業時間預約送審${isBatch ? '（批次）' : ''}\n事由：${reason}${isBatch ? `\n${lines}` : ''}`,
        '預約', 'red', first.studentName, first.teacherId, revId, undefined, tName
      ),
      ...prev,
    ]);
  };

  // 支援重排替換 (Clean Baseline) 與一般新增累加
  const handleAddBookings = (newBks: BookingItem[], cleanBase?: BookingItem[], mode?: 'append_remaining' | 'replace_future') => {
    if (cleanBase) {
      setBookings(() => [...cleanBase, ...newBks]);
    } else {
      setBookings(prev => [...prev, ...newBks]);
    }

    // 自動排課：寫入一則灰階紀錄
    if (newBks.length > 0) {
      const f = newBks[0];
      const ordered = [...newBks].sort((a, b) => a.date.localeCompare(b.date) || (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
      const pendingCount = newBks.filter(b => b.status === 'special_pending').length;
      addLog(
        `自動排課（${mode === 'replace_future' ? '重整未來' : mode === 'append_remaining' ? '接續排課' : '新增'}）：共排入 ${newBks.length} 堂\n` +
        `${formatDateWithDay(ordered[0].date)} ${formatTimeStr(ordered[0].startHour, ordered[0].startMin)} ～ ${formatDateWithDay(ordered[ordered.length - 1].date)} ${formatTimeStr(ordered[ordered.length - 1].startHour, ordered[ordered.length - 1].startMin)}` +
        (pendingCount > 0 ? `\n其中 ${pendingCount} 堂為非營業時間，已批次送審` : ''),
        '預約', 'gray', f.studentName, f.teacherId, undefined, undefined,
        (teachers[f.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim()
      );
    }

    // 非營業時間待審（一般老師）：同一學員的整批課堂合併為「一張」審核單 + 一則紅色通知
    const afterHoursBks = newBks.filter(b => b.status === 'special_pending' && b.pendingKind === 'after_hours');
    const groups = new Map<string, BookingItem[]>();
    afterHoursBks.forEach(b => groups.set(`${b.teacherId}|${b.studentId || b.studentName}`, [...(groups.get(`${b.teacherId}|${b.studentId || b.studentName}`) || []), b]));
    groups.forEach(list => submitAfterHoursBatch(list, '自動排課（非營業時間申請）'));
  };

  // 1v2 智能調度引擎：全站唯一預約入口（時間限制 → 教室調度/讓位 → 全局衝堂 → 額度）
  // 回傳 true 代表已成功寫入（或已送審），呼叫端可關閉彈窗 / 建立後續資料。
  const handleSmartBookingSubmit = async (
    input: BookingRequestInput,
    opts: {
      /** 尚未寫入名單的新學員（新生排課） */
      studentOverride?: Pick<StudentItem, 'id' | 'name' | 'credits'>;
      /** 呼叫端會自行顯示成功訊息 */
      silentSuccess?: boolean;
      /** 呼叫端已在介面內即時顯示過去 / 緊急時段提醒，不再跳出二次確認窗 */
      inlineNotices?: boolean;
      /** 非營業時間事由（呼叫端已收集時，不再跳出確認窗與事由輸入窗） */
      afterHoursReason?: string;
    } = {}
  ): Promise<boolean> => {
    const validation = validateAndBuildBooking({
      input,
      userRole,
      systemBaseDate,
      businessHours,
      priorityGrid,
      bookings: bookingsWithHolds,
      teachers,
      students,
      studentOverride: opts.studentOverride,
    });
    if (!validation.ok || !validation.booking) {
      systemAlert(validation.error || "此時段無法預約", "無法預約");
      return false;
    }

    const newBk = validation.booking;
    const formattedDate = formatDateWithDay(newBk.date);
    const timeFormatted = formatTimeStr(newBk.startHour, newBk.startMin);
    const currentTeacherName = (teachers[newBk.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim();
    const targetStudent = opts.studentOverride ?? students.find(s => matchesStudent(s, input.studentId, input.studentName));

    // 0. 管理員補排過去日期 / 緊急時段：二次確認（預約彈窗已在卡片內即時提醒者略過）
    if (!opts.inlineNotices) {
      if (validation.isPastBackfill) {
        if (!await systemConfirm(`【補排過去課堂提醒】\n您選擇的日期（${newBk.date}）已是過去時間。\n確定要安排過去時段的預約嗎？`)) return false;
      } else if (validation.urgent) {
        if (!await systemConfirm(`【緊急時段提醒】\n此時段已接近或超過開課時間，確認後將直接寫入課表。\n確定要繼續嗎？`)) return false;
      }
    }

    // 1. 非營業時間：取得事由（送 after_hours 審核單）。預約彈窗已即時提示並收集事由，不再跳出阻擋確認窗
    let afterHoursReason: string | undefined;
    if (validation.requiresReview) {
      const inlineReason = (opts.afterHoursReason || '').trim();
      if (inlineReason) {
        afterHoursReason = inlineReason;
      } else {
        if (!await systemConfirm(`【非營業時間提醒】\n${validation.reviewReason}\n\n是否繼續並填寫事由送審？`)) return false;
        const reason = ((await systemPrompt('請填寫非營業時間預約事由：', '非營業時間預約')) || '').trim();
        if (!reason) {
          systemAlert('未填寫事由，預約未送出');
          return false;
        }
        afterHoursReason = reason;
      }
    }

    // 2. 優先時段提醒（14 天內已開放，但提醒對方有優先權）
    if (validation.priorityOwnerId) {
      const pName = (teachers[validation.priorityOwnerId]?.name || '其他老師').replace(/ 老師|老師/g, '').trim();
      const roomLabel = newBk.roomType === 'large' ? '大教室' : '小教室';
      if (!await systemConfirm(
        `【優先時段提醒】\n${formattedDate} ${timeFormatted} ${roomLabel} 為 ${pName} 老師的優先時段（目前尚未預約）。\n\n是否仍要執行預約？`
      )) return false;
    }

    // 3. 額度調配：加課超額時，僅能替換「confirmed、未簽、isAuto」的最遠預約；否則走透支確認
    let releasedBookingId: string | null = null;
    let releasedLogDetail: string | null = null;
    let rebateNotice: string | null = null;
    if (validation.quota.found && validation.quota.exceeds && targetStudent) {
      const remainingCredits = validation.quota.credits;
      const replaceable = remainingCredits > 0
        ? findReplaceableAutoBooking(
            bookings.filter(b => !validation.autoSwaps.some(s => s.bookingId === b.id)),
            targetStudent,
            systemBaseDate
          )
        : undefined;

      const lastDateStr = replaceable ? formatDateWithDay(replaceable.date) : '';
      const lastTimeStr = replaceable ? formatTimeStr(replaceable.startHour, replaceable.startMin) : '';
      const canAutoRebate = !!replaceable &&
        !isWithin24Hours(replaceable.date, replaceable.startHour, replaceable.startMin, systemBaseDate);

      if (replaceable && canAutoRebate) {
        // 最遠預排課距離開課 > 24 小時：自動回扣，寫入完成後提醒
        releasedBookingId = replaceable.id;
        releasedLogDetail = `因臨時加課 (${formattedDate} ${timeFormatted})，系統自動回扣最遠日期預排：${lastDateStr} ${lastTimeStr}`;
        rebateNotice = `已自動回扣最遠日期（${replaceable.date.slice(5).replace('-', '/')}）的預排課程，避免總堂數超出`;
      } else {
        const within24Note = replaceable
          ? `最遠日期（${replaceable.date.slice(5).replace('-', '/')}）的預排課程已在 24 小時內，無法自動回扣，請手動調整。\n\n`
          : '';
        if (!await systemConfirm(
          `【學員堂數不足提醒】\n` +
          within24Note +
          `學員「${targetStudent.name}」目前剩餘堂數為 ${remainingCredits} 堂，已佔用 ${validation.quota.occupied} 堂，` +
          `${replaceable ? '' : '無可替換的自動預排課堂。'}\n\n` +
          `是否確認強制預排此堂課？\n` +
          `（預排後將進入透支狀態，待學員後續購買續課後會自動抵扣恢復）`
        )) return false;
      }
    }

    // 4. 教室調整提示（情境 B；讓位成功的提示在寫入完成後才顯示）
    if (validation.autoSwaps.length === 0 && validation.notices.length > 0) {
      systemAlert(`【教室調度】\n${validation.notices[0]}`);
    }

    // ---- 先建立所有日誌（任何一筆失敗就整體中止，不會留下半套寫入） ----
    const logItems: AuditLogItem[] = [];
    const swapNoticeCount = { teachers: 0 };
    try {
      if (releasedLogDetail && targetStudent) {
        logItems.push(buildLogItem(releasedLogDetail, '調度', 'yellow', targetStudent.name, newBk.teacherId, undefined, undefined, '系統調配'));
      }
      if (afterHoursReason) {
        const tName = teachers[newBk.teacherId]?.name || '老師';
        logItems.push(buildLogItem(
          `預約：${formattedDate} ${timeFormatted}\n結果：非營業時間預約送審\n事由：${afterHoursReason}`,
          '預約', 'red', newBk.studentName, newBk.teacherId, `rev-ah-${newBk.id}`, undefined, tName.replace(/ 老師|老師/g, '').trim()
        ));
      } else {
        const finalRoomDot = newBk.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
        logItems.push(buildLogItem(
          `${formattedDate} ${timeFormatted} ${finalRoomDot} (${newBk.lessonType})`,
          '預約', 'normal', newBk.studentName, newBk.teacherId, undefined, undefined, currentTeacherName
        ));
      }
      const swapLogs = buildSwapLogItems(validation.autoSwaps, {
        byTeacherName: currentTeacherName,
        newStudentName: newBk.studentName,
        newLessonType: newBk.lessonType,
      });
      swapNoticeCount.teachers = swapLogs.length;
      logItems.push(...swapLogs);
    } catch (err) {
      console.error('調度通知建立失敗', err);
      showToast('調度通知建立失敗，預約已中止，請重試');
      return false;
    }

    // ---- 寫入課堂 / 審核單 / 日誌 ----
    const swapIds = new Set(validation.autoSwaps.map(s => s.bookingId));
    setBookings(prev => [
      ...prev
        .filter(b => b.id !== releasedBookingId)
        .map(b => (swapIds.has(b.id) ? { ...b, roomType: 'small' as const } : b)),
      newBk,
    ]);
    if (afterHoursReason) {
      setReviews(prev => [{
        id: `rev-ah-${newBk.id}`,
        bookingId: newBk.id,
        teacherId: newBk.teacherId,
        teacherName: teachers[newBk.teacherId]?.name || '老師',
        studentName: newBk.studentName,
        date: newBk.date,
        time: `${formattedDate} ${timeFormatted}`,
        room: newBk.roomType === 'large' ? '大教室' : '小教室',
        lessonType: newBk.lessonType,
        reason: afterHoursReason,
        status: 'pending',
        reviewType: 'after_hours',
        submittedAt: formatSubmittedAt(),
      }, ...prev]);
    }
    setLogs(prev => [...logItems.slice().reverse(), ...prev]);

    // ---- 寫入完成後才顯示提示 ----
    if (rebateNotice) systemAlert(rebateNotice, '預排課程已回扣');
    if (validation.autoSwaps.length > 0) {
      systemAlert(`【系統自動調度成功】\n原大教室的 ${validation.autoSwaps.length} 堂 1v1 已移至小教室，並已通知 ${swapNoticeCount.teachers} 位原任課老師。您的 1v2 雙人課已順利排入大教室！`);
      showToast('調度成功：原 1v1 已移至小教室！');
    } else if (afterHoursReason) {
      showToast('已送出非營業時間預約審核，待管理員核准');
    } else if (!opts.silentSuccess) {
      showToast('預約建立成功！');
    }
    return true;
  };

  // 取消生效後的自動順延：額度仍有空位才補排，起點不早於 systemBaseDate
  const tryAutoPostpone = (
    cancelled: BookingItem,
    bookingsAfterCancel: BookingItem[]
  ): { added?: BookingItem; message?: string } => {
    const stu = students.find(s => matchesStudent(s, cancelled.studentId, cancelled.studentName));
    if (!stu || stu.status !== 'active') return {};
    if (!stu.rules?.some(r => r.freq !== '不固定')) return {};
    const occupied = bookingsAfterCancel.filter(b => matchesStudent(stu, b.studentId, b.studentName) && occupiesQuota(b)).length;
    if (occupied >= stu.credits) return {};

    const engine = new ScheduleEngine(
      applyPendingHolds(bookingsAfterCancel, reviews),
      teachers,
      Object.fromEntries(students.map(s => [s.id, s]))
    );
    const res = engine.handleAutoPostponeCancelledBooking({
      sid: stu.id,
      sName: stu.name,
      teacherId: stu.teacherId,
      cancelledDate: cancelled.date,
      todayStr: systemBaseDate,
      slots: stu.rules,
      currentBookings: bookingsAfterCancel,
      businessHours,
      priorityGrid,
      userRole: userRole === 'admin' ? 'admin' : 'teacher',
    });
    return { added: res.postponedBooking ?? undefined, message: res.alertMsg };
  };

  // 課堂被取消或異動時，關閉該課堂殘留的舊待審核單（取消 / 改期 / 改教室類）
  const closeStaleReviews = (bookingId: string, note: string) => {
    setReviews(prev => prev.map(r =>
      r.bookingId === bookingId && r.status === 'pending' &&
      (r.reviewType === 'cancel' || r.reviewType === 'reschedule' || r.reviewType === 'room_change')
        ? { ...r, status: 'rejected' as const, resolvedAt: getExactTimestamp(), resolvedNote: note }
        : r
    ));
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
    reason?: string,
    autoSwaps: AutoSwapItem[] = []
  ) => {
    const target = bookings.find(b => b.id === bookingId);
    if (!target) return;
    // 狀態防護：已簽到 / 已結算鎖定 / 非有效預約不可再異動
    if (!isActionableBooking(target)) {
      showToast('此課堂已簽到、已結算或已取消，無法再異動');
      return;
    }

    const oldDateFormatted = formatDateWithDay(target.date);
    const oldTimeFormatted = formatTimeStr(target.startHour, target.startMin);
    const oldRoomLabel = target.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';

    const newDateFormatted = formatDateWithDay(newDate);
    const newTimeFormatted = formatTimeStr(newHour, newMin);
    const newRoomLabel = newRoom === 'large' ? '🟣 大教室' : '🟢 小教室';
    const finalLessonType = newLessonType || target.lessonType;

    const teacherName = (teachers[currentUserId]?.name || '老師').replace(/ 老師|老師/g, '').trim();
    const actorName = userRole === 'admin' ? 'Daisy' : teacherName;

    // 管理員直接變更「其他老師」的課表：寫入稽核紀錄，並通知操作管理員與被變更的老師
    const isAdminOverride = userRole === 'admin' && target.teacherId !== currentUserId;
    const ownerName = (teachers[target.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim();
    const logAdminOverride = (typeStr: string, detail: string) => {
      const adminLog = buildLogItem(
        `管理員 Daisy 協助 ${ownerName} 老師異動課表\n${detail}`,
        typeStr, 'red', target.studentName, ADMIN_ID, undefined, undefined, 'Daisy'
      );
      const teacherLog = buildLogItem(
        `管理員 Daisy 已協助變更您的課表\n${detail}`,
        typeStr, 'red', target.studentName, target.teacherId, undefined, undefined, 'Daisy'
      );
      setLogs(prev => [adminLog, teacherLog, ...prev]);
    };

    // 判斷是否為 24 小時內之逾期異動
    const isOverdue = isWithin24Hours(target.date, target.startHour, target.startMin, systemBaseDate);

    // ================= 取消 =================
    // 取消與學員堂數完全脫鉤：無論一般取消或 24H 內送審取消，額度立即釋出並觸發自動順延；
    // 審核只判定老師計罰 / 免罰，不影響學員堂數。
    if (isCancel) {
      const isLateCancel = userRole !== 'admin' && isOverdue;
      const cancelPatch: Partial<BookingItem> = isLateCancel
        ? { status: 'special_pending', pendingKind: 'late_change' }
        : { status: 'cancelled_normal' };
      const bookingsAfterCancel = bookings.map(b => b.id === bookingId ? { ...b, ...cancelPatch } : b);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...cancelPatch } : b));
      closeStaleReviews(bookingId, '課堂已取消，原申請自動結案');

      if (isLateCancel) {
        const newRev: ReviewItem = {
          id: genId('rev'),
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
          reviewType: 'cancel',
          submittedAt: formatSubmittedAt(),
        };
        setReviews(prev => [newRev, ...prev]);
        addLog(
          `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n結果：逾期取消送審（待 Daisy 裁決計罰/免罰；學員堂數不受影響）\n事由：${reason || '未填寫原因'}`,
          '取消', 'red', target.studentName, currentUserId, newRev.id, undefined, teacherName
        );
        systemAlert(`【逾期取消已送審】\n課堂已完成取消登記，學員堂數不受影響並已自動順延。事由已送交管理員 Daisy 審核，將依規定裁決老師「計罰」或「免罰」。`);
      } else if (isAdminOverride) {
        logAdminOverride('取消', `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n結果：管理員協助取消（時段已釋出，學員堂數不扣）`);
      } else {
        addLog(
          userRole === 'admin'
            ? `${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} 一般取消`
            : `${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} 提前正常取消`,
          '取消', 'normal', target.studentName, userRole === 'admin' ? target.teacherId : currentUserId,
          undefined, undefined, actorName
        );
      }

      // 取消生效後檢查額度，有空位才自動順延補排一堂（起點不早於 systemBaseDate）
      const postponed = tryAutoPostpone(target, bookingsAfterCancel);
      if (postponed.added) {
        const added = postponed.added;
        setBookings(prev => [...prev, added]);
        if (added.status === 'special_pending') submitAfterHoursBatch([added], '取消後自動順延（非營業時間申請）');
        addLog(
          `因取消 ${oldDateFormatted} ${oldTimeFormatted}，系統自動順延補排：${formatDateWithDay(added.date)} ${formatTimeStr(added.startHour, added.startMin)}`,
          '調度', 'normal', target.studentName, target.teacherId, undefined, undefined, '系統調配'
        );
        showToast(`${isLateCancel ? '逾期取消申請已送出，待管理員審核；' : '已取消課堂，'}並已為學員自動順延補排一堂課（${formatDateWithDay(added.date)} ${formatTimeStr(added.startHour, added.startMin)}）`);
      } else {
        showToast(isLateCancel ? '逾期取消申請已送出，待管理員審核' : userRole === 'admin' ? '管理員已取消預約（時段已釋出）' : '預約已提前取消成功！');
        if (postponed.message) systemAlert(postponed.message);
      }
      return;
    }

    // ================= 改期 / 改室 =================
    const timeUnchanged =
      newDate === target.date && newHour === target.startHour && newMin === target.startMin;
    const roomOnly = timeUnchanged && newRoom !== target.roomType && finalLessonType === target.lessonType;
    const studentsMap = Object.fromEntries(students.map(s => [s.id, s]));

    // 24H 內一般老師僅更改教室：禁止自行變更 → 建立 room_change 審核單，原課堂維持不動
    if (userRole !== 'admin' && isOverdue && roomOnly) {
      if (reviews.some(r => r.bookingId === bookingId && r.status === 'pending' && r.reviewType === 'room_change')) {
        showToast('此課堂已有待審核的改教室申請');
        return;
      }
      const roomConflict = checkGlobalConflict({
        dateStr: newDate, startHour: newHour, startMin: newMin,
        durationMins: target.durationMins || 50,
        roomType: newRoom, lessonType: finalLessonType,
        teacherId: target.teacherId, studentId: target.studentId, studentName: target.studentName,
        userRole, existingBookings: bookingsWithHolds, teachersMap: teachers, studentsMap,
        excludeBookingId: target.id
      });
      if (roomConflict.hasConflict) return systemAlert(roomConflict.reason || "該時段已有預約", "無法預約");

      closeStaleReviews(bookingId, '課堂異動，原申請自動結案');
      const newRev: ReviewItem = {
        id: genId('rev-room'),
        bookingId,
        teacherId: currentUserId,
        teacherName,
        studentName: target.studentName,
        date: target.date,
        time: `${oldDateFormatted} ${oldTimeFormatted}`,
        room: target.roomType === 'large' ? '大教室' : '小教室',
        lessonType: finalLessonType,
        reason: reason || '24 小時內申請更換教室',
        status: 'pending',
        reviewType: 'room_change',
        reqRoom: newRoom,
        reqLessonType: finalLessonType,
        submittedAt: formatSubmittedAt(),
      };
      setReviews(prev => [newRev, ...prev]);
      addLog(
        `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel}\n申請改至：${newRoomLabel} · 結果：24H 內改教室送審（原課堂維持不動）\n事由：${reason || '未填寫'}`,
        '改室', 'red', target.studentName, currentUserId, newRev.id, undefined, teacherName
      );
      showToast('24 小時內改教室已送審，核准前原課堂維持不動');
      return;
    }

    // 讓位對象再驗證：必須仍是大教室、有效未簽的 1v1，且完整區間可安全搬進小教室
    const swapIds = new Set(autoSwaps.map(s => s.bookingId));
    const swapTargets = autoSwaps.map(s => bookings.find(b => b.id === s.bookingId));
    const swapInvalid = swapTargets.some(b =>
      !b || b.id === bookingId || b.roomType !== 'large' || b.lessonType !== '1v1' ||
      !isActionableBooking(b) || !canRelocateToSmall(b, bookingsWithHolds, bookingId)
    );
    if (swapInvalid) {
      return systemAlert('【無法改期】\n原大教室課堂的狀態已變動或小教室已無法容納，系統已中止調度，請重新操作。');
    }
    const effectiveBookings = swapIds.size
      ? bookingsWithHolds.map(b => (swapIds.has(b.id) ? { ...b, roomType: 'small' as const } : b))
      : bookingsWithHolds;

    // 衝堂檢查：管理員與一般老師一律執行（讓位後視為已移至小教室）
    const conflict = checkGlobalConflict({
      dateStr: newDate,
      startHour: newHour,
      startMin: newMin,
      durationMins: target.durationMins || 50,
      roomType: newRoom,
      lessonType: finalLessonType,
      teacherId: target.teacherId,
      studentId: target.studentId,
      studentName: target.studentName,
      userRole,
      existingBookings: effectiveBookings,
      teachersMap: teachers,
      studentsMap,
      excludeBookingId: target.id
    });
    if (conflict.hasConflict) {
      return systemAlert(conflict.reason || "該時段已有預約", "無法預約");
    }

    // 建立調度通知（寫入前先建好；失敗則整體中止）
    let swapLogs: AuditLogItem[] = [];
    try {
      swapLogs = buildSwapLogItems(autoSwaps, {
        byTeacherName: actorName,
        newStudentName: target.studentName,
        newLessonType: finalLessonType,
      });
    } catch (err) {
      console.error('調度通知建立失敗', err);
      showToast('調度通知建立失敗，改期已中止，請重試');
      return;
    }

    // 課表立即移至新時段（原時段釋出，新時段佔用）並同步移動被讓位的課堂
    closeStaleReviews(bookingId, '課堂已異動，原申請自動結案');
    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) {
        return {
          ...b,
          date: newDate,
          startHour: newHour,
          startMin: newMin,
          roomType: newRoom,
          lessonType: finalLessonType,
          status: 'confirmed' as const
        };
      }
      return swapIds.has(b.id) ? { ...b, roomType: 'small' as const } : b;
    }));
    if (swapLogs.length > 0) setLogs(prev => [...swapLogs.slice().reverse(), ...prev]);
    const afterWriteNotice = swapLogs.length > 0
      ? `；原大教室 ${autoSwaps.length} 堂 1v1 已移至小教室並通知 ${swapLogs.length} 位原任課老師`
      : '';

    if (userRole === 'admin') {
      const adminDetail = `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} (${finalLessonType})\n結果：${isAdminOverride ? (roomOnly ? '管理員協助改室' : '管理員協助改期') : '一般改期'}`;
      if (isAdminOverride) {
        logAdminOverride(roomOnly ? '改室' : '改期', adminDetail);
      } else {
        addLog(adminDetail, '改期', 'normal', target.studentName, target.teacherId, undefined, undefined, 'Daisy');
      }
      showToast(`管理員已變更預約${afterWriteNotice}`);
      return;
    }

    if (isOverdue) {
      // 逾期改期：送一張審核單給 Daisy 裁決
      const newRev: ReviewItem = {
        id: genId('rev'),
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
        reqLessonType: finalLessonType,
        submittedAt: formatSubmittedAt(),
      };
      setReviews(prev => [newRev, ...prev]);
      addLog(
        `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel}\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} · 結果：逾期改期（已生效，待 Daisy 裁決）\n事由：${reason || '未填寫'}`,
        '改期', 'red', target.studentName, currentUserId, newRev.id, undefined, teacherName
      );
      showToast(`課堂已直接改至新時段，案件已送交 Daisy 裁決${afterWriteNotice}`);
    } else {
      // 提早 24 小時以上改期：直接生效，不打擾 Daisy
      addLog(
        `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} (${finalLessonType})\n結果：提前正常改期`,
        '改期', 'normal', target.studentName, currentUserId, undefined, undefined, teacherName
      );
      showToast(`預約已順利改期！${afterWriteNotice}`);
    }
  };
  // --- 老師手動執行：月底結算申報處理 ---
  const handleProcessSettlement = (drafts: any) => {
    const attendedMsg: string[] = [];
    let unattendedCount = 0;
    const settleTs = getExactTimestamp();

    // 僅處理仍為「有效、未簽、未鎖定」的課堂，避免重複結算
    const targets = bookings.filter((b: any) =>
      drafts[b.id] && drafts[b.id].report !== 'pending' && isActionableBooking(b));
    if (targets.length === 0) {
      showToast('皆設定為「暫不處理」，無課堂變更。');
      return;
    }

    const creditDeltas: Record<string, number> = {};
    const newReviews: ReviewItem[] = [];
    const settledMap: Record<string, any> = {};

    targets.forEach((b: any) => {
      const draft = drafts[b.id];
      if (draft.report === 'attended_unsigned') {
        const stu = students.find(st => matchesStudent(st, b.studentId, b.studentName));
        if (stu) creditDeltas[stu.id] = (creditDeltas[stu.id] || 0) - 1;
        const remain = stu ? stu.credits + (creditDeltas[stu.id] || 0) : 0;
        attendedMsg.push(`• ${b.studentName} 系統代簽 扣堂-1 剩餘${remain}`);
        addLog(
          `原課堂：${formatDateWithDay(b.date)}\n結果：系統代簽認列扣 1 堂\n事由：${draft.reason || '老師回報學生有出席'}`,
          '簽到', 'yellow', b.studentName, b.teacherId, undefined, Number(remain)
        );
        settledMap[b.id] = {
          signed: true,
          signedAt: settleTs,
          isSystemSigned: true,
          settlementType: 'system_deducted',
          systemSignedAt: settleTs,
          overdueReason: draft.reason || '老師回報學生有出席',
          isSettlementLocked: true,
        };
      } else if (draft.report === 'unattended_not_cancelled') {
        unattendedCount++;
        const revId = genId('rev-settle');
        newReviews.push({
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
          reviewType: 'cancel',
          submittedAt: formatSubmittedAt(),
        });
        addLog(
          `原課堂：${formatDateWithDay(b.date)}\n結果：逾期取消已送審\n事由：${draft.reason || '老師回報未到課'}`,
          '取消', 'red', b.studentName, b.teacherId, revId
        );
        settledMap[b.id] = { status: 'special_pending' as const, pendingKind: 'late_change' as const, isSettlementLocked: true };
      }
    });

    setStudents(prev => prev.map(st =>
      creditDeltas[st.id] ? { ...st, credits: st.credits + creditDeltas[st.id] } : st
    ));
    setBookings(prev => prev.map(b => settledMap[b.id] ? { ...b, ...settledMap[b.id] } : b));
    if (newReviews.length > 0) setReviews(prev => [...newReviews, ...prev]);

    let finalAlert = "【逾期課堂結算處理完成】\n";
    if (attendedMsg.length > 0) finalAlert += `\n[未簽到處理]\n${attendedMsg.join("\n")}\n`;
    if (unattendedCount > 0) finalAlert += `\n[未取消處理]\n已送出 ${unattendedCount} 筆逾期取消審核。 (待管理員判定)`;
    systemAlert(finalAlert);
  };

  // --- 老師申請結算更正（結算送出後已鎖定，須送審） ---
  const handleRequestSettlementUndo = (bookingId: string, undoReason: string) => {
    const b = bookings.find(x => x.id === bookingId);
    if (!b) return;
    if (reviews.some(r => r.bookingId === bookingId && r.reviewType === 'settlement_undo' && r.status === 'pending')) {
      showToast('此課堂已有待審核的結算更正申請');
      return;
    }
    const revId = genId('rev-undo');
    const newRev: ReviewItem = {
      id: revId,
      bookingId,
      teacherId: b.teacherId,
      teacherName: teachers[b.teacherId]?.name || '老師',
      studentName: b.studentName,
      date: b.date,
      time: `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}`,
      room: b.roomType === 'large' ? '大教室' : '小教室',
      lessonType: b.lessonType,
      reason: undoReason,
      undoReason,
      status: 'pending',
      reviewType: 'settlement_undo',
      submittedAt: formatSubmittedAt(),
    };
    setReviews(prev => [newRev, ...prev]);
    addLog(
      `原課堂：${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}\n結果：申請結算更正\n事由：${undoReason}`,
      '取消', 'red', b.studentName, b.teacherId, revId
    );
    showToast('已送出結算更正申請，待管理員審核');
  };
  // --- 月底未結清稽核與關帳（兩段式：催辦 ➔ 強制關帳） ---
  const [isMonthEndOpen, setIsMonthEndOpen] = useState(false);

  // 階段一：催辦通知（黃色提醒，不計罰、不鎖定）
  const handleSendMonthEndReminders = () => {
    const list = bookings.filter(b => isOverdueUnsettled(b, systemBaseDate));
    const byTeacher = new Map<string, number>();
    list.forEach(b => byTeacher.set(b.teacherId, (byTeacher.get(b.teacherId) || 0) + 1));
    if (byTeacher.size === 0) { systemAlert('目前無未結清課堂，無需發送催辦通知。'); return; }
    byTeacher.forEach((n, tId) => {
      addLog(
        `【月底關帳提醒】您目前尚有 ${n} 堂已過期課堂未完成簽到或取消，請於月底關帳前儘速處理，逾期將計罰 1 次。`,
        '提醒', 'yellow', '', tId, undefined, undefined, '系統關帳'
      );
    });
    systemAlert(`已發送催辦通知給 ${byTeacher.size} 位老師（共 ${list.length} 堂未結清），未變更課堂狀態、未計罰。`);
  };

  // 階段二：強制關帳（未結清全數計罰；二次確認在彈窗內完成）
  const handleForceMonthEndClose = () => {
    const targets = bookings.filter(b => isOverdueUnsettled(b, systemBaseDate));
    if (targets.length === 0) { systemAlert('目前無未結清課堂。'); return; }
    targets.forEach(b => {
      addLog(
        `原課堂：${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}\n結果：月底關帳判定未到課 (計罰老師，不扣學員堂數)\n事由：老師於月底前均未回報處理`,
        '取消', 'red', b.studentName, b.teacherId, undefined, undefined, '系統結算'
      );
    });
    const ids = new Set(targets.map(b => b.id));
    setBookings(prev => prev.map(b => ids.has(b.id) ? {
      ...b,
      status: 'special_rejected' as const,
      settlementType: 'unattended_no_credit_deducted' as const,
      isSettlementLocked: true,
      teacherNote: '系統月底關帳：老師未處理逾期',
    } : b));
    setIsMonthEndOpen(false);
    systemAlert(`【月底關帳完成】共 ${targets.length} 堂未結清課堂已判定為未到課並計罰老師，課堂已鎖定。`);
  };
  // 審核處理（結果日誌統一第三行備註事由）
  const handleReview = (reviewId: string, decision: 'approved' | 'rejected') => {
    const rev = reviews.find(r => r.id === reviewId) as any;
    if (!rev) return;
    if (rev.status !== 'pending') {
      showToast('此案件已處理，請勿重複審核');
      return;
    }

    const targetBooking = bookings.find(b => b.id === rev.bookingId);
    const studentName = targetBooking?.studentName || rev.studentName || '';
    const cleanTeacher = (rev.teacherName || '老師').replace(/ 老師|老師/g, '').trim();
    const revTimeStr = rev.time?.includes('(') ? rev.time : `${formatDateWithDay(rev.date)} ${rev.time || ''}`;
    const reasonText = rev.reason ? `\n事由：${rev.reason}` : '';

    // 套用課堂 patch，並把「審核前快照 / 審核後狀態 / 堂數異動」寫入審核單，供撤銷真正還原
    const commit = (
      patch: Partial<BookingItem> | null,
      opts: { creditDelta?: number; creditStudentId?: string; cascadedReviewIds?: string[] } = {},
    ) => {
      if (patch && targetBooking) {
        setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, ...patch } : b));
      }
      setReviews(prev => prev.map(r => {
        if (r.id === reviewId) {
          return {
            ...r,
            status: decision,
            bookingSnapshot: targetBooking ? { ...targetBooking } : undefined,
            bookingAfter: targetBooking && patch ? { ...targetBooking, ...patch } : targetBooking ? { ...targetBooking } : undefined,
            creditDelta: opts.creditDelta || 0,
            creditStudentId: opts.creditStudentId,
            cascadedReviewIds: opts.cascadedReviewIds,
          };
        }
        if (opts.cascadedReviewIds?.includes(r.id)) {
          // 作廢原取消審核單：不再佔用免費取消次數（待審者一併結案）
          return {
            ...r,
            voided: true,
            voidedFrom: r.status,
            status: r.status === 'pending' ? ('rejected' as const) : r.status,
            resolvedNote: '結算更正核准，原案件作廢',
          };
        }
        return r;
      }));
    };

    // 0-a'. 批次非營業時間審核（自動排課）：整批一次核准 / 駁回
    if (rev.reviewType === 'after_hours' && rev.batchBookingIds && rev.batchBookingIds.length > 0) {
      const isApproved = decision === 'approved';
      const ids = new Set(rev.batchBookingIds);
      const targets = bookings.filter(b => ids.has(b.id) && b.status === 'special_pending' && b.pendingKind === 'after_hours');
      if (targets.length === 0) {
        showToast('找不到待審的對應課堂，無法審核');
        return;
      }
      if (isApproved) {
        const studentsMap = Object.fromEntries(students.map(st => [st.id, st]));
        const bad = targets.find(t => checkGlobalConflict({
          dateStr: t.date, startHour: t.startHour, startMin: t.startMin, durationMins: t.durationMins || 50,
          roomType: t.roomType, lessonType: t.lessonType, teacherId: t.teacherId,
          studentId: t.studentId, studentName: t.studentName, userRole: 'admin',
          existingBookings: bookings, teachersMap: teachers, studentsMap, excludeBookingId: t.id,
        }).hasConflict);
        if (bad) {
          systemAlert(`【無法核准】\n審核期間 ${formatDateWithDay(bad.date)} ${formatTimeStr(bad.startHour, bad.startMin)} 已被預約，請駁回此批次申請，由老師重新排課。`);
          return;
        }
      }
      const targetIds = new Set(targets.map(t => t.id));
      setBookings(prev => prev.map(b => targetIds.has(b.id)
        ? (isApproved
            ? { ...b, status: 'confirmed' as const, pendingKind: undefined }
            : { ...b, status: 'cancelled_normal' as const, pendingKind: undefined, cancelReason: 'after_hours_rejected' })
        : b));
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, status: decision, bookingSnapshots: targets.map(t => ({ ...t })) } : r));
      const lines = targets
        .map(b => `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}`)
        .join('、');
      addLog(
        `預約：共 ${targets.length} 堂（${lines}）\n結果：非營業時間預約批次${isApproved ? '核准生效' : '駁回不成立'}${reasonText}`,
        '預約', isApproved ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：非營業時間批次預約（${targets.length} 堂）已${isApproved ? '核准' : '駁回'}`);
      return;
    }

    // 0-a. 非營業時間預約審核
    if (rev.reviewType === 'after_hours') {
      const isApproved = decision === 'approved';
      if (!targetBooking) {
        showToast('找不到對應預約，無法審核');
        return;
      }
      if (isApproved) {
        // 審核期間時段可能已被他人預約（special_pending 不佔時段）→ 核准前重跑衝堂檢查
        const conflict = checkGlobalConflict({
          dateStr: targetBooking.date,
          startHour: targetBooking.startHour,
          startMin: targetBooking.startMin,
          durationMins: targetBooking.durationMins || 50,
          roomType: targetBooking.roomType,
          lessonType: targetBooking.lessonType,
          teacherId: targetBooking.teacherId,
          studentId: targetBooking.studentId,
          studentName: targetBooking.studentName,
          userRole: 'admin',
          existingBookings: bookings,
          teachersMap: teachers,
          studentsMap: Object.fromEntries(students.map(st => [st.id, st])),
          excludeBookingId: targetBooking.id,
        });
        if (conflict.hasConflict) {
          systemAlert(`【無法核准】\n審核期間該時段已被預約，請駁回此申請。\n${conflict.reason || ''}`);
          return;
        }
      }
      commit(isApproved
        ? { status: 'confirmed' as const, pendingKind: undefined }
        : { status: 'cancelled_normal' as const, pendingKind: undefined, cancelReason: 'after_hours_rejected' });
      addLog(
        `預約：${revTimeStr}\n結果：非營業時間預約${isApproved ? '核准生效' : '駁回不成立'}${reasonText}`,
        '預約', isApproved ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：非營業時間預約已${isApproved ? '核准' : '駁回'}`);
      return;
    }
    // 0-b. 結算更正審核（核准＝回滾課堂狀態並退還/扣除堂數）
    if (rev.reviewType === 'settlement_undo') {
      const isApproved = decision === 'approved';
      let rollbackNote = '';
      if (isApproved && targetBooking) {
        const st = targetBooking.status;
        const isSystemDeducted = targetBooking.settlementType === 'system_deducted' || !!targetBooking.isSystemSigned;
        const isUnattendedCancel =
          st === 'special_pending' || st === 'special_approved' || st === 'special_rejected';

        // 雙向回滾：系統代簽 → 退還 1 堂；逾期取消 → 學員堂數不變，僅回復課堂並移除計罰
        let creditDelta = 0;
        if (isSystemDeducted && targetBooking.signed) {
          creditDelta = +1;
          rollbackNote = '系統代簽已撤銷，退還學員 1 堂';
        } else if (isUnattendedCancel) {
          rollbackNote = st === 'special_rejected'
            ? '逾期取消已撤銷，老師超時取消計罰 -1'
            : '逾期取消已撤銷，課堂回復有效';
        } else if (targetBooking.signed && targetBooking.settlementType !== 'unattended_no_credit_deducted') {
          creditDelta = +1;
          rollbackNote = '結算簽到已撤銷，退還學員 1 堂';
        }

        // 嚴格以 studentId 比對，僅無 ID 時才退回姓名
        const creditStudent = creditDelta !== 0
          ? students.find(s => matchesStudent(s, targetBooking.studentId, targetBooking.studentName))
          : undefined;
        if (creditDelta !== 0 && creditStudent) {
          setStudents(prev => prev.map(s => s.id === creditStudent.id
            ? { ...s, credits: s.credits + creditDelta } : s));
        }

        // 原取消審核單（不論待審或已裁決）一併作廢，避免殘留或佔用免費取消次數
        const cascaded = reviews
          .filter(r => r.bookingId === rev.bookingId && r.id !== reviewId && r.reviewType === 'cancel' && !r.voided)
          .map(r => r.id);

        // 課堂回復為結算前狀態並解除鎖定（計罰以 special_rejected / penaltyCount 統計，回復後自動 -1）
        commit({
          status: 'confirmed' as const,
          signed: false,
          isSystemSigned: false,
          isLateSigned: false,
          settlementType: undefined,
          systemSignedAt: undefined,
          overdueReason: undefined,
          signedAt: undefined,
          isSettlementLocked: false,
        }, { creditDelta: creditStudent ? creditDelta : 0, creditStudentId: creditStudent?.id, cascadedReviewIds: cascaded });
      } else {
        commit(null);
      }
      addLog(
        `原課堂：${revTimeStr}\n結果：結算更正${isApproved ? `核准（${rollbackNote || '已回滾課堂狀態'}）` : '駁回（維持原結算）'}${reasonText}`,
        '簽到', isApproved ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：結算更正已${isApproved ? '核准並回滾' : '駁回'}`);
      return;
    }

    // 1. 改教室審核
    if (rev.reviewType === 'room_change') {
      const isApproved = decision === 'approved';
      // 核准前再確認目標教室仍空（審核期間已卡位，此為排程引擎等例外路徑的保險）
      if (isApproved && targetBooking && rev.reqRoom) {
        const roomConflict = checkGlobalConflict({
          dateStr: targetBooking.date,
          startHour: targetBooking.startHour,
          startMin: targetBooking.startMin,
          durationMins: targetBooking.durationMins || 50,
          roomType: rev.reqRoom,
          lessonType: rev.reqLessonType || targetBooking.lessonType,
          teacherId: targetBooking.teacherId,
          studentId: targetBooking.studentId,
          studentName: targetBooking.studentName,
          userRole: 'admin',
          existingBookings: bookings,
          teachersMap: teachers,
          studentsMap: Object.fromEntries(students.map(st => [st.id, st])),
          excludeBookingId: targetBooking.id,
        });
        if (roomConflict.hasConflict) {
          systemAlert(`【無法核准】\n目標教室該時段已被佔用，請駁回此申請。\n${roomConflict.reason || ''}`);
          return;
        }
      }
      commit(isApproved
        ? { status: 'confirmed', roomType: rev.reqRoom || targetBooking?.roomType, lessonType: rev.reqLessonType || targetBooking?.lessonType }
        : { status: 'confirmed' });

      const oldDot = targetBooking?.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
      const newDot = rev.reqRoom === 'large' ? '🟣 大教室' : '🟢 小教室';

      addLog(
        `原課堂：${revTimeStr} ${oldDot}\n改至：${newDot} · 結果：${isApproved ? '核准' : '駁回'}${reasonText}`,
        '改室', isApproved ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：已${isApproved ? '核准' : '駁回'}改室`);
    }
    // 2. 改期審核（計罰以 booking.penaltyCount 記錄）
    else if (rev.reviewType === 'reschedule') {
      const isExempt = decision === 'approved';
      const typeLabel = isExempt ? '免罰改期' : '計罰改期';

      // 改期在送審時已即時生效；審核僅記錄免罰 / 計罰，不覆蓋課堂目前的時段與狀態
      commit({ penaltyCount: (targetBooking?.penaltyCount || 0) + (isExempt ? 0 : 1) });

      const oldDot = targetBooking?.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
      const newDot = (targetBooking?.roomType ?? rev.reqRoom) === 'large' ? '🟣 大教室' : '🟢 小教室';
      const newTimeStr = targetBooking
        ? `${formatDateWithDay(targetBooking.date)} ${formatTimeStr(targetBooking.startHour, targetBooking.startMin)}`
        : `${formatDateWithDay(rev.reqDate)} ${formatTimeStr(rev.reqHour, rev.reqMin)}`;

      addLog(
        `原課堂：${revTimeStr} ${oldDot}\n改至：${newTimeStr} ${newDot} · 結果：${typeLabel}${reasonText}`,
        '改期', isExempt ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：改期已套用 (${isExempt ? '免罰' : '計罰'})`);
    }
    // 3. 取消審核
    else {
      const isExempt = decision === 'approved';
      const newStatus = isExempt ? 'special_approved' as const : 'special_rejected' as const;

      commit({ status: newStatus });

      const roomText = targetBooking?.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';

      addLog(
        `原課堂：${revTimeStr} ${roomText}\n結果：${isExempt ? '免罰取消' : '計罰取消'}${reasonText}`,
        '取消', isExempt ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：${isExempt ? '免罰取消' : '計罰取消'}`);
    }
  };

  const handleResetReview = (reviewId: string) => {
    const rev = reviews.find(r => r.id === reviewId);
    if (!rev) return;
    if (rev.status === 'pending') {
      showToast('此案件尚未審核，無需撤銷');
      return;
    }
    const cleanTeacher = (rev.teacherName || '老師').replace(/ 老師|老師/g, '').trim();
    const logReset = () => addLog(
      `${rev.time || ''} 撤銷審核（回歸待審）`,
      '取消', 'yellow', rev.studentName || '', rev.teacherId, undefined, undefined, cleanTeacher
    );

    // 批次非營業時間審核：逐堂確認未被後續異動，再整批還原為待審
    if (rev.batchBookingIds && rev.bookingSnapshots?.length) {
      const expected = rev.status === 'approved' ? 'confirmed' : 'cancelled_normal';
      const changed = rev.bookingSnapshots.some(snap => {
        const cur = bookings.find(b => b.id === snap.id);
        return !cur || cur.status !== expected || cur.signed || cur.date !== snap.date ||
          cur.startHour !== snap.startHour || cur.startMin !== snap.startMin || cur.roomType !== snap.roomType;
      });
      if (changed) {
        showToast('批次中有課堂在審核後已有後續變動（簽到、改期等），無法撤銷審核');
        return;
      }
      const snaps = new Map(rev.bookingSnapshots.map(b => [b.id, b]));
      setBookings(prev => prev.map(b => snaps.has(b.id) ? { ...(snaps.get(b.id) as BookingItem) } : b));
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, status: 'pending' as const, bookingSnapshots: undefined } : r));
      logReset();
      showToast('已撤銷審核，整批課堂已還原，案件回到待審');
      return;
    }

    // 有快照：真正還原課堂與堂數；課堂若已有後續變動則禁止撤銷
    if (rev.bookingSnapshot && rev.bookingAfter && rev.bookingId) {
      const current = bookings.find(b => b.id === rev.bookingId);
      const after = rev.bookingAfter;
      const keys: (keyof BookingItem)[] = [
        'status', 'date', 'startHour', 'startMin', 'roomType', 'lessonType',
        'signed', 'isSettlementLocked', 'settlementType', 'penaltyCount', 'isSystemSigned',
      ];
      const changed = !current || keys.some(k => (current[k] ?? undefined) !== (after[k] ?? undefined));
      if (changed) {
        showToast('此課堂在審核後已有後續變動（簽到、改期、結算等），無法撤銷審核');
        return;
      }
      const snapshot = rev.bookingSnapshot;
      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...snapshot } : b));
      if (rev.creditDelta && rev.creditStudentId) {
        const delta = rev.creditDelta;
        setStudents(prev => prev.map(s => s.id === rev.creditStudentId ? { ...s, credits: s.credits - delta } : s));
      }
      const cascaded = rev.cascadedReviewIds || [];
      setReviews(prev => prev.map(r => {
        if (r.id === reviewId) {
          return { ...r, status: 'pending' as const, bookingSnapshot: undefined, bookingAfter: undefined, creditDelta: undefined, creditStudentId: undefined, cascadedReviewIds: undefined };
        }
        if (cascaded.includes(r.id)) {
          return { ...r, status: r.voidedFrom ?? ('pending' as const), voided: undefined, voidedFrom: undefined, resolvedNote: undefined };
        }
        return r;
      }));
      logReset();
      showToast('已撤銷審核，課堂與堂數已還原，案件回到待審');
      return;
    }

    // 無快照（舊資料）：沿用舊行為，僅限取消/改教室類
    setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, status: 'pending' } : r));
    if (rev.bookingId && (rev.reviewType === 'cancel' || rev.reviewType === 'room_change' || !rev.reviewType)) {
      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, status: 'special_pending', pendingKind: rev.reviewType === 'after_hours' ? 'after_hours' : 'late_change' } : b));
    }
    logReset();
    showToast('已撤銷審核，案件回到待審');
  };

  // 簽到與補簽共用核心引擎 (支援正常簽到與逾期補簽)
  const handleSign = async (
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

    // 狀態防護：避免重複簽到 / 已結算鎖定 / 已取消的課堂被扣堂
    if (!isActionableBooking(targetBooking)) {
      showToast('此課堂已簽到、已結算或已取消，無法重複簽到');
      return;
    }
    // 簽名時間窗：開課前 1 小時才開放簽到（逾期補簽不受限，簽名板會顯示紅字提醒）
    if (getSignatureWindowStatus(targetBooking, systemBaseDate) === 'too_early') {
      systemAlert('尚未開放簽到（開課前 1 小時才可簽名）', '尚未開放簽到');
      return;
    }

    const sId = targetBooking.studentId;
    const sName = targetBooking.studentName || '';

    // 欠堂提醒：剩餘堂數 <= 0 時，簽到前須確認
    const creditsStudent = students.find(st => matchesStudent(st, sId, sName));
    if (creditsStudent && creditsStudent.credits <= 0) {
      if (!await systemConfirm('該學員剩餘堂數為 0，簽到後將成為負數（欠堂），確定繼續嗎？')) return;
    }
    const bDate = formatDateWithDay(targetBooking.date);
    const bTime = formatTimeStr(targetBooking.startHour, targetBooking.startMin);
    const tName = (teachers[targetBooking.teacherId || currentUserId]?.name || 'Daisy').replace(/ 老師|老師/g, '').trim();

    // 2. 計算扣除後的剩餘堂數 (若已透支允許扣至 0 或負數，此處配合既有邏輯取 Math.max(0, ...))
    let afterC = 0;
    const targetStudent = students.find(s => matchesStudent(s, sId, sName));
    if (targetStudent) {
      afterC = targetStudent.credits - 1;
    }

    // 3. 扣除學員堂數
    setStudents(prev => prev.map(s => {
      if (matchesStudent(s, sId, sName)) {
        return { ...s, credits: s.credits - 1 };
      }
      return s;
    }));

    // 4. 更新課堂狀態：補簽加上 isLateSigned 標記，並保存簽名檔
    setBookings(prev => prev.map(b =>
      b.id === bookingId && isActionableBooking(b)
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
  const auditBadgeColor = useMemo(() => {
    const hasPendingReview = userRole === 'admin' && reviews.some(r => r.status === 'pending');
    // 灰階一般紀錄不計未讀；紅色重要 > 黃色提醒
    const unread = logs.filter(l => !l.read && (userRole === 'admin' || l.teacherId === currentUserId));
    if (hasPendingReview || unread.some(l => getLogSeverity(l) === 'red')) return 'red';
    if (unread.some(l => getLogSeverity(l) === 'yellow')) return 'yellow';
    return null;
  }, [reviews, logs, userRole, currentUserId]);

  const currentViewingStudent = useMemo(() => {
    return students.find(s => s.id === selectedStudentId);
  }, [students, selectedStudentId]);

  const activeTeachersList = useMemo(() => {
    return Object.values(teachers).filter(t => t.isActive);
  }, [teachers]);

  return (
    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
      <div className="flex flex-col h-[100dvh] w-full max-w-none bg-slate-50 relative overflow-hidden font-sans">
        
        {systemDialog && (
          <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-6">
            <div role="dialog" aria-modal="true" className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <h3 className="text-base font-black text-slate-800">{systemDialog.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line break-words max-h-[50vh] overflow-y-auto">{systemDialog.message}</p>
              {systemDialog.kind === 'prompt' && (
                <textarea autoFocus value={systemDialogInput} onChange={e => setSystemDialogInput(e.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-rose-400" />
              )}
              <div className="flex gap-2">
                <button onClick={() => closeSystemDialog(systemDialog.kind === 'prompt' ? null : false)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold active:scale-[0.98] transition">取消</button>
                <button onClick={() => closeSystemDialog(systemDialog.kind === 'prompt' ? systemDialogInput : true)} className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold active:scale-[0.98] transition">確定</button>
              </div>
            </div>
          </div>
        )}

        {systemAlertModal && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-6" onClick={() => setSystemAlertModal(null)}>
            <div role="alertdialog" aria-modal="true" className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-black text-slate-800">{systemAlertModal.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line break-words max-h-[60vh] overflow-y-auto">{systemAlertModal.message}</p>
              <button autoFocus onClick={() => setSystemAlertModal(null)} className="w-full py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold active:scale-[0.98] transition">確定</button>
            </div>
          </div>
        )}

        {toastMsg && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[100] bg-slate-900/90 text-white text-xs px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
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
        <header className="px-4 md:px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 z-20">

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
                  onClick={() => setIsMonthEndOpen(true)} 
                  className="bg-amber-100 hover:bg-amber-200 active:scale-95 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-xl text-[11px] font-black shadow-2xs transition"
                >
                  🔒 月底未結清稽核與關帳
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
        <main className="flex-1 min-h-0 overflow-y-auto p-3 md:p-5 pb-20">
          
            {/* Tab 1: 排班總覽（打通高度伸展） */}
            <div className={activeTab === 1 && !selectedStudentId && !selectedTeacherId ? 'flex flex-col h-full min-h-0 flex-1' : 'hidden'}>
              <Tab1StudioCalendar
                systemBaseDate={systemBaseDate} 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                students={students} 
                bookings={bookingsWithHolds} 
                reviews={reviews} 
                businessHours={businessHours}
                priorityGrid={priorityGrid}
                onExecuteReschedule={handleExecuteReschedule}
                showToast={showToast} 
                onSelectStudent={(sName: string) => navigateToStudent(sName, 1)}
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
                calendarBookings={bookingsWithHolds}
                onProcessSettlement={handleProcessSettlement}
                onRequestSettlementUndo={handleRequestSettlementUndo}
                businessHours={businessHours}
                priorityGrid={priorityGrid}
                reviews={reviews}
                onExecuteReschedule={handleExecuteReschedule}
                students={students} 
                onSign={handleSign} 
                onUpdateBookingNote={(bId: any, note: any) => { 
                  setBookings(prev => prev.map(b => b.id === bId ? { ...b, teacherNote: note } : b)); 
                  showToast('備註已更新'); 
                }} 
                showToast={showToast} 
                onSelectStudent={(sName: string) => navigateToStudent(sName, 2)} 
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
                  onUpdateStudent={handleUpdateStudent}
                  onPurchase={(studentId: string, purchase: any) => setStudents(prev => prev.map(s => s.id === studentId
                    ? { ...s, credits: s.credits + Number(purchase.credits), purchases: [purchase, ...(s.purchases || [])] }
                    : s))}
                  onSign={handleSign}
                  onUpdateBookingNote={(bId: any, note: any) => { 
                    setBookings(prev => prev.map(b => b.id === bId ? { ...b, teacherNote: note } : b)); 
                    showToast('備註已更新'); 
                  }}
                  onAddBookings={handleAddBookings}
                  onExecuteReschedule={handleExecuteReschedule}
                  onSmartBook={handleSmartBookingSubmit}
                  students={students}
                  businessHours={businessHours}
                  priorityGrid={priorityGrid}
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
                  addLog={addLog}
                  onSmartBook={handleSmartBookingSubmit}
                  userRole={userRole}
                  businessHours={businessHours}
                  priorityGrid={priorityGrid}
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
                  onUpdateTeacher={(updated: any) => setTeachers(prev => ({ ...prev, [updated.id]: updated }))} 
                  priorityGrid={priorityGrid}
                  bookings={bookings}
                  systemBaseDate={systemBaseDate}
                  showToast={showToast} 
                />
              ) : (
                <Tab4TeachersManagement 
                  userRole={userRole} 
                  currentUserId={currentUserId} 
                  teachers={teachers} 
                  setTeachers={setTeachers} 
                  bookings={bookings} 
                  systemBaseDate={systemBaseDate}
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
                businessHours={businessHours}
                setBusinessHours={setBusinessHours}
                bookings={bookings}
                reviews={reviews} 
                onReview={handleReview} 
                onReset={handleResetReview} 
                logs={logs} 
                setLogs={setLogs} 
                studioRules={studioRules} 
                setStudioRules={setStudioRules} 
                showToast={showToast} 
                addLog={addLog} 
                systemBaseDate={systemBaseDate}
                isMonthEndOpen={isMonthEndOpen}
                onCloseMonthEnd={() => setIsMonthEndOpen(false)}
                onSendReminders={handleSendMonthEndReminders}
                onForceClose={handleForceMonthEndClose}
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
          <div className="bg-white rounded-3xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative space-y-4">
            
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
                      const preset = getStudentBookingPreset(s, userRole);
                      setBookingForm(prev => ({
                        ...prev,
                        studentName: name,
                        lessonType: preset.lessonType,
                        roomType: preset.roomType
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
                  onChange={(e) => setBookingForm(prev => ({ ...prev, date: e.target.value }))}
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
                      {getDisplayHours(businessHours).map(h => (
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
                      onChange={(e) => {
                        // 教室自動連動：1v2 → 大教室；1v1 → 小教室（管理員一律優先大教室）
                        const next = e.target.value as '1v1' | '1v2';
                        setBookingForm(prev => ({
                          ...prev,
                          lessonType: next,
                          roomType: userRole === 'admin' || next === '1v2' ? 'large' : 'small'
                        }));
                      }}
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

            {/* 即時檢測提示卡（日期 / 時間 / 教室 / 學員變動時即時更新，不需送出才看到） */}
            {bookingCheck && (
              <div className="space-y-2 text-xs">
                {!bookingCheck.ok && (
                  <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-bold text-rose-700 leading-relaxed whitespace-pre-line">
                    {bookingCheck.errorKind === 'conflict' ? '⛔ ' : '⚠️ '}
                    {(bookingCheck.error || '此時段無法預約').replace(/^【[^】]+】/, '')}
                  </div>
                )}
                {bookingCheck.ok && bookingCheck.urgent && (
                  <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-black text-rose-700 leading-relaxed">
                    ⚠️ 此時段已接近或超過開課時間，確認後將直接寫入課表
                  </div>
                )}
                {bookingCheck.ok && bookingCheck.requiresReview && (
                  <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                    <p className="font-black text-amber-800 leading-relaxed">
                      ⚠️ 目前選擇為非營業時間，送出後需經管理員審核（管理員本人預約免審核）
                    </p>
                    <textarea
                      value={afterHoursReasonInput}
                      onChange={e => setAfterHoursReasonInput(e.target.value)}
                      rows={2}
                      placeholder="請填寫非營業時間預約事由（必填）"
                      className="w-full bg-white border border-amber-300 rounded-xl p-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                )}
                {bookingCheck.ok && bookingCheck.notices.length > 0 && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 font-bold text-amber-800 leading-relaxed">
                    ℹ️ {bookingCheck.notices[0]}
                  </div>
                )}
              </div>
            )}

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
                onClick={async () => {
                  if (!bookingForm.studentName) return systemAlert('請選擇學員');
                  const s = students.find((st: any) => st.name === bookingForm.studentName);
                  if (!s) return systemAlert('找不到該學員資料');
                  const ok = await handleSmartBookingSubmit({
                    date: bookingForm.date,
                    startHour: parseInt(bookingForm.hour, 10),
                    startMin: parseInt(bookingForm.minute, 10),
                    durationMins: 50,
                    teacherId: bookingForm.teacherId,
                    studentId: s.id,
                    studentName: s.name,
                    roomType: bookingForm.roomType,
                    lessonType: bookingForm.lessonType,
                  }, { inlineNotices: true, afterHoursReason: afterHoursReasonInput });
                  if (ok) setIsBookingModalOpen(false);
                }}
                disabled={!bookingCheck || !bookingCheck.ok || (bookingCheck.requiresReview && !afterHoursReasonInput.trim())}
                className="w-full py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold transition active:scale-95 shadow-md shadow-rose-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100"
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