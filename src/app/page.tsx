'use client';
import { genId } from '../utils/id';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar as CalendarIcon, Users, FileText, BookOpen, User as UserIcon, Plus, ArrowLeft, RotateCcw, Sparkles } from 'lucide-react';
import { 
  ScheduleEngine,
  checkGlobalConflict,
  INITIAL_TEACHERS, 
  INITIAL_STUDENTS, 
  INITIAL_BOOKINGS, 
  INITIAL_REVIEWS, 
  INITIAL_LOGS, 
  INITIAL_PRIORITY_GRID,
  PriorityGrid,
  TeacherProfile, 
  StudentItem, 
  BookingItem, 
  ReviewItem, 
  AuditLogItem,
  formatDateWithDay,
  formatTimeStr
} from '../mockData';

import Tab1StudioCalendar from '../components/Tab1StudioCalendar';
import Tab2PersonalSchedule from '../components/Tab2PersonalSchedule';
import Tab3StudentManagement, { StudentDetailView } from '../components/Tab3StudentManagement';
import Tab4TeachersManagement, { TeacherDetailView } from '../components/Tab4TeachersManagement';
import Tab5RulesAndAudit from '../components/Tab5RulesAndAudit';
import {
  DAY_HOURS,
  REVIEW_TAG,
  canRelocateToSmall,
  findOtherPriorityOwner,
  findReplaceableAutoBooking,
  formatTimestamp,
  getLogSeverity,
  getStudentBookingPreset,
  isActionableBooking,
  isSignableBooking,
  isWithin24Hours,
  getSignatureWindowStatus,
  matchesStudent,
  occupiesQuota,
  priorityReviewHint,
  validateAndBuildBooking,
  formatRules,
  applyAutoSwaps,
  isPendingApproval,
  AUTO_APPROVE_NOTE,
  isDueForAutoApproval,
  isInReviewFreeWindow,
  isLogReadBy,
  isLogVisibleTo,
  isArchivedStudent,
  getAdminOverrideSeverity,
  getSelfCancelSeverity,
} from '../utils/bookingRules';
import type { AutoSwapItem, BookingRequestInput } from '../utils/bookingRules';
import { useToday } from '../utils/useToday';
import { systemAlert, registerSystemAlert, systemConfirm, registerSystemDialog, type SystemAlertPayload, type SystemDialogRequest } from '../utils/systemAlert';

const ADMIN_ID = 't-daisy';

/** 非優先申請的預設事由（不需老師填寫） */
const NON_PRIORITY_REASON = '非優先時段預約申請';
const reviewIdFor = (bookingId: string) => `rev-np-${bookingId}`;
/** 超時取消的紀錄標示（取消當下時間即該筆紀錄的操作時間） */
const LATE_CANCEL_LABEL = '超時取消（24H 內）';

type LogLevel = 'red' | 'yellow' | 'normal' | 'gray';

export default function Home() {
  // 使用者端的真實今天；預先渲染與 hydration 階段為空字串
  const today = useToday();
  const [systemAlertModal, setSystemAlertModal] = useState<SystemAlertPayload | null>(null);
  useEffect(() => registerSystemAlert(setSystemAlertModal), []);
  const [systemDialog, setSystemDialog] = useState<SystemDialogRequest | null>(null);
  useEffect(() => registerSystemDialog(setSystemDialog), []);
  const closeSystemDialog = (value: boolean) => {
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

  // Tab 1 & Tab 2 頂部視圖控制狀態 (由 Header 統一控制)
  const [tab1View, setTab1View] = useState<'day' | 'week'>('day');
  const [tab2View, setTab2View] = useState<'day' | 'week' | 'month'>('day');

  const [priorityGrid, setPriorityGrid] = useState<PriorityGrid>(INITIAL_PRIORITY_GRID);

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

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = (msg: string) => { 
    setToastMsg(msg); 
    // 重新計時，避免前一則提示的計時器提早關掉新提示
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500); 
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
    const teacherDisplayName = (tName || (userRole === 'admin' ? 'Daisy' : teachers[currentUserId]?.name || '老師'))
      .replace(/ 老師|老師|\(管理者\)/g, '')
      .trim();
    const cleanStudentName = sName === '學員' || sName === '-' ? '' : sName;

    return { 
      id: genId('l'), 
      time: formatTimestamp(), 
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

  // 系統規範更新：一則紅色廣播，所有老師各自計算未讀
  const broadcastRuleUpdate = (detail: string) => {
    const item: AuditLogItem = {
      ...buildLogItem(detail, '規範更新', 'red', '', ADMIN_ID, undefined, undefined, 'Daisy'),
      broadcast: true,
    };
    setLogs(prev => [item, ...prev]);
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
        '自動改室', 'yellow', items.map(sw => sw.studentName).join('、'), tid, undefined, undefined, '系統調度'
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
  // 全域共用預約彈窗狀態
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    date: today,
    hour: '10',
    minute: '00',
    roomType: 'small' as 'large' | 'small',
    lessonType: '1v1' as '1v1' | '1v2',
    teacherId: currentUserId,
    studentName: ''
  });

  // 新增預約可選的學員：自己名下且未封存
  const bookableStudents = students.filter(s => s.teacherId === currentUserId && !isArchivedStudent(s));

  // 開啟全域預約彈窗的統一入口
  const openGlobalBooking = (preset?: Partial<typeof bookingForm>) => {
    // 預設學員
    const defaultStudent = bookableStudents[0]?.name || '';
    const defaultPreset = getStudentBookingPreset(bookableStudents.find(s => s.name === (preset?.studentName || defaultStudent)), userRole);

    setBookingForm({
      date: preset?.date || today,
      hour: String(preset?.hour || '10').padStart(2, '0'),
      minute: String(preset?.minute || '00').padStart(2, '0'),
      roomType: preset?.roomType || defaultPreset.roomType,
      lessonType: preset?.lessonType || defaultPreset.lessonType,
      teacherId: preset?.teacherId || currentUserId,
      studentName: preset?.studentName || defaultStudent
    });

    setIsBookingModalOpen(true);
  };

  // 預約彈窗即時檢測（日期 / 時間 / 教室 / 學員任一變動即重算），用於按鈕上方的紅字 / 琥珀色提示卡
  const bookingCheck = useMemo(() => {
    if (!isBookingModalOpen) return null;
    const stu = students.find(st => st.name === bookingForm.studentName && !isArchivedStudent(st));
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
      today,
      priorityGrid,
      bookings,
      teachers,
      students,
    });
  }, [isBookingModalOpen, bookingForm, students, userRole, today, priorityGrid, bookings, teachers]);

  const cleanName = (teacherId: string, fallback = '老師') =>
    (teachers[teacherId]?.name || fallback).replace(/ 老師|老師/g, '').trim();

  // 其他預約彈窗（學員快速預約 / 體驗課）的非優先時段即時提示
  const getPriorityHint = (input: BookingRequestInput): string | null => {
    const res = validateAndBuildBooking({
      input, userRole, today, priorityGrid,
      bookings, teachers, students, skipQuota: true,
    });
    return res.ok && res.requiresReview && res.priorityOwnerId
      ? priorityReviewHint(cleanName(res.priorityOwnerId, '其他老師'))
      : null;
  };

  // 一般老師在他人優先時段（14 天內）直接生效的預約 / 改期：通知該優先老師（不帶學員資料）
  const buildPriorityNoticeLogs = (list: BookingItem[]): AuditLogItem[] => {
    if (userRole === 'admin') return [];
    const byOwner = new Map<string, BookingItem[]>();
    list.filter(b => b.status === 'confirmed').forEach(b => {
      const owner = findOtherPriorityOwner({
        dateStr: b.date, startHour: b.startHour, startMin: b.startMin, durationMins: b.durationMins,
        roomType: b.roomType, teacherId: b.teacherId, priorityGrid,
      });
      if (owner) byOwner.set(owner, [...(byOwner.get(owner) || []), b]);
    });
    return Array.from(byOwner.entries()).map(([ownerId, items]) => {
      const who = cleanName(items[0].teacherId);
      const lines = items
        .map(b => `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)} ${b.roomType === 'large' ? '🟣 大教室' : '🟢 小教室'} (${b.lessonType})`)
        .join('\n');
      return buildLogItem(
        `優先時段提醒：${who} 老師已使用您的優先時段\n${lines}`,
        '提醒', 'yellow', '', ownerId, undefined, undefined, who
      );
    });
  };

  const notifyPriorityOwners = (list: BookingItem[]) => {
    const items = buildPriorityNoticeLogs(list);
    if (items.length > 0) setLogs(prev => [...items, ...prev]);
  };

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
    const statusLabel = (v: StudentItem['status']) => (v === 'archived' ? '已封存' : '上課中');
    const lines = changes.map(k => {
      if (k === 'status') return `${labels[k]}：${statusLabel(cur.status)} ➔ ${statusLabel(patch[k])}`;
      if (k === 'rules') return `${labels[k]}：${formatRules((cur as any)[k])} ➔ ${formatRules(patch[k])}`;
      if (k === 'note') return `${labels[k]}：${(cur as any)[k] || '（空）'} ➔ ${patch[k] || '（空）'}`;
      return `${labels[k] || k}：${String((cur as any)[k] ?? '（空）')} ➔ ${String(patch[k] ?? '（空）')}`;
    });
    addLog(`學員資料修改\n${lines.join('\n')}`, '學員資料', 'gray', cur.name, cur.teacherId);
  };

  // 非優先審核送審：同批多堂合併為一張批次審核單（核准 / 駁回一次套用），並發一則紅色通知
  const submitPendingBatch = (list: BookingItem[], reason: string) => {
    if (list.length === 0) return;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
    const first = sorted[0];
    const isBatch = sorted.length > 1;
    const revId = reviewIdFor(first.id);
    const tName = cleanName(first.teacherId);
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
      reviewType: 'non_priority',
    };
    setReviews(prev => [rev, ...prev]);
    setLogs(prev => [
      buildLogItem(
        `預約：${isBatch ? `共 ${sorted.length} 堂` : firstTime}\n結果：送交${REVIEW_TAG}${isBatch ? '（批次）' : ''}\n事由：${reason}${isBatch ? `\n${lines}` : ''}`,
        '預約', 'red', first.studentName, first.teacherId, revId, undefined, tName
      ),
      ...prev,
    ]);
  };

  // 同一學員的整批待審課堂合併為一張審核單
  const submitPendingBookings = (list: BookingItem[], source: string) => {
    const groups = new Map<string, BookingItem[]>();
    list.filter(isPendingApproval).forEach(b => {
      const key = `${b.teacherId}|${b.studentId || b.studentName}`;
      groups.set(key, [...(groups.get(key) || []), b]);
    });
    groups.forEach(group => submitPendingBatch(group, `${source}（${REVIEW_TAG}）`));
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
      const nonPriorityCount = newBks.filter(isPendingApproval).length;
      addLog(
        `自動排課（${mode === 'replace_future' ? '重整未來' : mode === 'append_remaining' ? '接續排課' : '新增'}）：共排入 ${newBks.length} 堂\n` +
        `${formatDateWithDay(ordered[0].date)} ${formatTimeStr(ordered[0].startHour, ordered[0].startMin)} ～ ${formatDateWithDay(ordered[ordered.length - 1].date)} ${formatTimeStr(ordered[ordered.length - 1].startHour, ordered[ordered.length - 1].startMin)}` +
        (nonPriorityCount > 0 ? `\n其中 ${nonPriorityCount} 堂為非優先時段，已批次送審` : ''),
        '預約', 'gray', f.studentName, f.teacherId, undefined, undefined,
        (teachers[f.teacherId]?.name || '老師').replace(/ 老師|老師/g, '').trim()
      );
    }

    // 待審課堂（一般老師）：合併送審 + 紅色通知；14 天內使用他人優先時段則通知該老師
    submitPendingBookings(newBks, '自動排課');
    notifyPriorityOwners(newBks);
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
      /** 呼叫端已在介面內即時顯示過去時段 / 非優先送審提醒，不再跳出二次確認窗 */
      inlineNotices?: boolean;
    } = {}
  ): Promise<boolean> => {
    const validation = validateAndBuildBooking({
      input,
      userRole,
      today,
      priorityGrid,
      bookings,
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

    // 1. 過去時段提醒（不限制，僅確認）；預約彈窗已在卡片內即時提醒者略過
    if (!opts.inlineNotices && validation.isPastSlot) {
      if (!await systemConfirm(`【過去時段提醒】\n此時段（${formattedDate} ${timeFormatted}）已超過開課時間，確認後將直接寫入課表。\n確定要繼續嗎？`)) return false;
    }

    // 2. 非優先審核（他人優先時段、14 天前預約）
    const needsReview = validation.requiresReview;
    const pName = validation.priorityOwnerId ? cleanName(validation.priorityOwnerId, '其他老師') : '';
    if (needsReview && !opts.inlineNotices) {
      if (!await systemConfirm(`【優先時段提醒】\n${priorityReviewHint(pName)}\n\n是否送出申請？`)) return false;
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
            targetStudent
          )
        : undefined;

      const lastDateStr = replaceable ? formatDateWithDay(replaceable.date) : '';
      const lastTimeStr = replaceable ? formatTimeStr(replaceable.startHour, replaceable.startMin) : '';
      const canAutoRebate = !!replaceable &&
        !isWithin24Hours(replaceable.date, replaceable.startHour, replaceable.startMin);

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
      if (!needsReview) {
        const finalRoomDot = newBk.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';
        logItems.push(buildLogItem(
          `${formattedDate} ${timeFormatted} ${finalRoomDot} (${newBk.lessonType})`,
          '預約', 'normal', newBk.studentName, newBk.teacherId, undefined, undefined, currentTeacherName
        ));
        logItems.push(...buildPriorityNoticeLogs([newBk]));
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
    setBookings(prev => [
      ...applyAutoSwaps(prev.filter(b => b.id !== releasedBookingId), validation.autoSwaps),
      newBk,
    ]);
    setLogs(prev => [...logItems.slice().reverse(), ...prev]);
    if (needsReview) submitPendingBatch([newBk], NON_PRIORITY_REASON);

    // ---- 寫入完成後才顯示提示 ----
    if (rebateNotice) systemAlert(rebateNotice, '預排課程已回扣');
    if (validation.autoSwaps.length > 0) {
      systemAlert(`【系統自動調度成功】\n原大教室的 ${validation.autoSwaps.length} 堂 1v1 已移至小教室，並已通知 ${swapNoticeCount.teachers} 位原任課老師。您的 1v2 雙人課已順利排入大教室！`);
      showToast('調度成功：原 1v1 已移至小教室！');
    } else if (needsReview) {
      showToast(`已送交${REVIEW_TAG}，待管理員核准`);
    } else if (!opts.silentSuccess) {
      showToast(userRole !== 'admin' && pName ? `預約建立成功！已通知 ${pName} 老師（優先時段）` : '預約建立成功！');
    }
    return true;
  };

  // 取消生效後的自動順延：額度仍有空位才補排，起點不早於今天
  const tryAutoPostpone = (
    cancelled: BookingItem,
    bookingsAfterCancel: BookingItem[],
    /** 同一批操作中尚未寫入的學員堂數異動 */
    creditDeltas: Record<string, number> = {}
  ): { added?: BookingItem; message?: string } => {
    const stu = students.find(s => matchesStudent(s, cancelled.studentId, cancelled.studentName));
    if (!stu || stu.status !== 'active') return {};
    if (!stu.rules?.some(r => r.freq !== '不固定')) return {};
    const occupied = bookingsAfterCancel.filter(b => matchesStudent(stu, b.studentId, b.studentName) && occupiesQuota(b)).length;
    if (occupied >= stu.credits + (creditDeltas[stu.id] || 0)) return {};

    const engine = new ScheduleEngine(
      bookingsAfterCancel,
      teachers,
      Object.fromEntries(students.map(s => [s.id, s]))
    );
    const res = engine.handleAutoPostponeCancelledBooking({
      sid: stu.id,
      sName: stu.name,
      teacherId: stu.teacherId,
      cancelledDate: cancelled.date,
      todayStr: today,
      slots: stu.rules,
      currentBookings: bookingsAfterCancel,
      priorityGrid,
      userRole: userRole === 'admin' ? 'admin' : 'teacher',
    });
    return { added: res.postponedBooking ?? undefined, message: res.alertMsg };
  };

  // 所有「系統自動結案」一律走這裡：更新審核單狀態並寫入紀錄（每張審核單一筆）
  const autoCloseReviews = (items: { review: ReviewItem; status: 'approved' | 'rejected'; note: string }[]) => {
    if (items.length === 0) return;
    const byId = new Map(items.map(i => [i.review.id, i]));
    setReviews(prev => prev.map(r => {
      const hit = byId.get(r.id);
      return hit ? { ...r, status: hit.status, resolvedNote: hit.note, autoClosed: true } : r;
    }));
    const logItems = items.map(({ review, note }) => buildLogItem(
      `原課堂：${review.time}\n結果：${REVIEW_TAG}自動結案（${note}）\n事由：${review.reason}`,
      '自動結案', 'yellow', review.studentName, review.teacherId, undefined, undefined, cleanName(review.teacherId)
    ));
    setLogs(prev => [...logItems, ...prev]);
  };

  // 待審課堂跨入開課前 14 天內：自動轉 confirmed、結案審核單，並提醒申請老師與優先時段老師。
  // ref 記錄已處理的課堂，避免同一批重複寫入通知（含開發模式的 effect 重跑）
  const autoApprovedIds = useRef(new Set<string>());
  useEffect(() => {
    if (!today) return;
    const due = bookings.filter(b => isDueForAutoApproval(b, today) && !autoApprovedIds.current.has(b.id));
    if (due.length === 0) return;
    due.forEach(b => autoApprovedIds.current.add(b.id));
    const dueIds = new Set(due.map(b => b.id));

    const closedReviewIds = new Set<string>();
    const logItems: AuditLogItem[] = [];
    // 每位申請老師各一則；每位優先老師依申請老師分別一則（不帶學員資料）
    const byApplicant = new Map<string, BookingItem[]>();
    due.forEach(b => byApplicant.set(b.teacherId, [...(byApplicant.get(b.teacherId) || []), b]));

    reviews.forEach(r => {
      if (r.status !== 'pending') return;
      const ids = r.batchBookingIds?.length ? r.batchBookingIds : [r.bookingId];
      if (!ids.some(id => !!id && dueIds.has(id))) return;
      const stillPending = bookings.some(b => ids.includes(b.id) && isPendingApproval(b) && !dueIds.has(b.id));
      if (!stillPending) closedReviewIds.add(r.id);
    });

    const describe = (b: BookingItem) =>
      `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)} ${b.roomType === 'large' ? '🟣 大教室' : '🟢 小教室'} (${b.lessonType})`;

    byApplicant.forEach((items, applicantId) => {
      const who = cleanName(applicantId);
      const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
      const names = Array.from(new Set(sorted.map(b => b.studentName))).join('、');
      logItems.push(buildLogItem(
        `${REVIEW_TAG}自動核准\n${sorted.map(b => `${describe(b)} ${b.studentName}`).join('\n')}\n結果：${AUTO_APPROVE_NOTE}`,
        '自動核准', 'yellow', names, applicantId, undefined, undefined, who
      ));
      const byOwner = new Map<string, BookingItem[]>();
      sorted.forEach(b => {
        const owner = findOtherPriorityOwner({
          dateStr: b.date, startHour: b.startHour, startMin: b.startMin, durationMins: b.durationMins,
          roomType: b.roomType, teacherId: b.teacherId, priorityGrid,
        });
        if (owner) byOwner.set(owner, [...(byOwner.get(owner) || []), b]);
      });
      byOwner.forEach((owned, ownerId) => {
        logItems.push(buildLogItem(
          `優先時段提醒：${who} 老師在您優先時段的預約已自動核准\n${owned.map(describe).join('\n')}\n結果：${AUTO_APPROVE_NOTE}`,
          '自動核准', 'yellow', '', ownerId, undefined, undefined, who
        ));
      });
    });

    setBookings(prev => prev.map(b => dueIds.has(b.id) && isPendingApproval(b) ? { ...b, status: 'confirmed' as const } : b));
    setReviews(prev => prev.map(r => closedReviewIds.has(r.id)
      ? { ...r, status: 'approved' as const, resolvedNote: AUTO_APPROVE_NOTE, autoClosed: true }
      : r));
    setLogs(prev => [...logItems, ...prev]);
    // 僅在跨日或課堂異動時重新檢查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, bookings]);

  // 非優先審核單：涵蓋的課堂皆已簽到或取消（沒有待審課堂）時自動結案；批次單仍有待審課堂則保留
  const settlePreBookingReviews = (bookingId: string, bookingsAfter: BookingItem[]) => {
    autoCloseReviews(reviews.flatMap(review => {
      if (review.status !== 'pending') return [];
      const ids = review.batchBookingIds?.length ? review.batchBookingIds : [review.bookingId];
      if (!ids.includes(bookingId)) return [];
      const linked = bookingsAfter.filter(b => ids.includes(b.id));
      if (linked.some(isPendingApproval)) return [];
      const attended = linked.some(b => b.signed);
      // 批次單中若有課堂已自動核准而成立，整單不可記為不成立
      const effective = attended || linked.some(b => b.status === 'confirmed');
      return [{
        review,
        status: effective ? 'approved' as const : 'rejected' as const,
        note: attended ? '已簽到授課' : effective ? '其餘課堂已核准生效，待審課堂已取消' : '課堂已取消',
      }];
    }));
  };

  // 變更或取消預約（一律免審核、直接生效）
  const handleExecuteReschedule = (
    bookingId: string,
    newDate: string,
    newHour: number,
    newMin: number,
    newRoom: 'large' | 'small',
    isCancel = false,
    newLessonType?: '1v1' | '1v2',
    autoSwaps: AutoSwapItem[] = []
  ) => {
    const target = bookings.find(b => b.id === bookingId);
    if (!target) return;
    // 非優先審核中：審核完成前不可改期改室，僅可簽到或取消
    if (!isCancel && isPendingApproval(target)) {
      showToast('審核完成前無法變更，僅可簽名或取消');
      return;
    }
    // 狀態防護：已簽到 / 已取消的課堂不可再異動（取消另允許審核中課堂）
    if (isCancel ? !isSignableBooking(target) : !isActionableBooking(target)) {
      showToast('此課堂已簽到或已取消，無法再異動');
      return;
    }

    const oldDateFormatted = formatDateWithDay(target.date);
    const oldTimeFormatted = formatTimeStr(target.startHour, target.startMin);
    const oldRoomLabel = target.roomType === 'large' ? '🟣 大教室' : '🟢 小教室';

    const newDateFormatted = formatDateWithDay(newDate);
    const newTimeFormatted = formatTimeStr(newHour, newMin);
    const newRoomLabel = newRoom === 'large' ? '🟣 大教室' : '🟢 小教室';
    const finalLessonType = newLessonType || target.lessonType;

    const actorName = userRole === 'admin' ? 'Daisy' : cleanName(currentUserId);

    // 管理員直接變更「其他老師」的課表：寫入稽核紀錄，並通知操作管理員與被變更的老師
    const isAdminOverride = userRole === 'admin' && target.teacherId !== currentUserId;
    const ownerName = cleanName(target.teacherId);
    const logAdminOverride = (detail: string, action: '取消' | '改期' | '改室') => {
      const level = getAdminOverrideSeverity(action);
      const adminLog = buildLogItem(
        `管理員 Daisy 協助 ${ownerName} 老師異動課表\n${detail}`,
        '管理員異動', level, target.studentName, ADMIN_ID, undefined, undefined, 'Daisy'
      );
      const teacherLog = buildLogItem(
        `管理員 Daisy 已協助變更您的課表\n${detail}`,
        '管理員異動', level, target.studentName, target.teacherId, undefined, undefined, 'Daisy'
      );
      setLogs(prev => [adminLog, teacherLog, ...prev]);
    };

    // ================= 取消 =================
    // 一律直接生效：不扣學員堂數、釋出空位、自動順延補排；24 小時內僅標註「超時取消」
    if (isCancel) {
      const isLateCancel = isWithin24Hours(target.date, target.startHour, target.startMin);
      const cancelPatch: Partial<BookingItem> = {
        status: 'cancelled_normal', isLateCancel, cancelledAt: formatTimestamp(),
      };
      const bookingsAfterCancel = bookings.map(b => b.id === bookingId ? { ...b, ...cancelPatch } : b);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...cancelPatch } : b));
      settlePreBookingReviews(bookingId, bookingsAfterCancel);

      const cancelLabel = isLateCancel ? LATE_CANCEL_LABEL : '一般取消';
      const cancelDetail = `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n結果：${cancelLabel}`;
      if (isAdminOverride) {
        logAdminOverride(`${cancelDetail}（時段已釋出，學員堂數不扣）`, '取消');
      } else {
        addLog(cancelDetail, '取消', getSelfCancelSeverity(userRole === 'admin', isLateCancel), target.studentName, target.teacherId, undefined, undefined, actorName);
      }

      // 取消生效後檢查額度，有空位才自動順延補排一堂（起點不早於今天）
      const doneText = isLateCancel ? `已取消課堂（${LATE_CANCEL_LABEL}）` : '已取消課堂';
      const postponed = tryAutoPostpone(target, bookingsAfterCancel);
      if (postponed.added) {
        const added = postponed.added;
        const addedTime = `${formatDateWithDay(added.date)} ${formatTimeStr(added.startHour, added.startMin)}`;
        setBookings(prev => [...prev, added]);
        submitPendingBookings([added], '取消後自動順延');
        addLog(
          `因取消 ${oldDateFormatted} ${oldTimeFormatted}，系統自動順延補排：${addedTime}`,
          '調度', 'normal', target.studentName, target.teacherId, undefined, undefined, '系統調配'
        );
        notifyPriorityOwners([added]);
        showToast(`${doneText}，並已為學員自動順延補排一堂課（${addedTime}）`);
      } else {
        showToast(doneText);
        if (postponed.message) systemAlert(postponed.message);
      }
      return;
    }

    // ================= 改期 / 改室 =================
    const timeUnchanged =
      newDate === target.date && newHour === target.startHour && newMin === target.startMin;
    const roomChanged = newRoom !== target.roomType;
    const changeType = timeUnchanged && roomChanged ? '改室' : '改期';
    const studentsMap = Object.fromEntries(students.map(s => [s.id, s]));

    // 讓位對象再驗證：必須仍是大教室、有效未簽的 1v1，且完整區間可安全搬進小教室
    const swapIds = new Set(autoSwaps.map(s => s.bookingId));
    const swapTargets = autoSwaps.map(s => bookings.find(b => b.id === s.bookingId));
    const swapInvalid = swapTargets.some(b =>
      !b || b.id === bookingId || b.roomType !== 'large' || b.lessonType !== '1v1' ||
      !isActionableBooking(b) || !canRelocateToSmall(b, bookings, bookingId)
    );
    if (swapInvalid) {
      return systemAlert('【無法改期】\n原大教室課堂的狀態已變動或小教室已無法容納，系統已中止調度，請重新操作。');
    }
    const effectiveBookings = applyAutoSwaps(bookings, autoSwaps);

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

    const moved: BookingItem = {
      ...target,
      date: newDate,
      startHour: newHour,
      startMin: newMin,
      roomType: newRoom,
      lessonType: finalLessonType,
    };
    // 課表立即移至新時段（原時段釋出，新時段佔用）並同步移動被讓位的課堂
    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) return moved;
      return swapIds.has(b.id) ? { ...b, roomType: 'small' as const } : b;
    }));
    if (swapLogs.length > 0) setLogs(prev => [...swapLogs.slice().reverse(), ...prev]);
    const afterWriteNotice = swapLogs.length > 0
      ? `；原大教室 ${autoSwaps.length} 堂 1v1 已移至小教室並通知 ${swapLogs.length} 位原任課老師`
      : '';

    const detail = `原課堂：${oldDateFormatted} ${oldTimeFormatted} ${oldRoomLabel} (${target.lessonType})\n改至：${newDateFormatted} ${newTimeFormatted} ${newRoomLabel} (${finalLessonType})\n結果：${changeType}完成`;
    if (isAdminOverride) {
      logAdminOverride(detail, changeType);
    } else {
      addLog(detail, changeType, userRole === 'admin' ? 'normal' : 'yellow', target.studentName, target.teacherId, undefined, undefined, actorName);
    }
    if (!timeUnchanged || roomChanged) notifyPriorityOwners([moved]);
    showToast(`${userRole === 'admin' ? '管理員已變更預約' : `${changeType}完成！`}${afterWriteNotice}`);
  };

  // --- 老師手動執行：逾期課堂結算處理（系統代簽 / 取消） ---
  const handleProcessSettlement = (drafts: any) => {
    const attendedMsg: string[] = [];
    const settleTs = formatTimestamp();

    // 僅處理仍為「有效、未簽」的課堂，避免重複結算
    const targets = bookings.filter((b: any) =>
      drafts[b.id] && drafts[b.id].report !== 'pending' && isActionableBooking(b));
    if (targets.length === 0) {
      showToast('皆設定為「暫不處理」，無課堂變更。');
      return;
    }

    const creditDeltas: Record<string, number> = {};
    const settledMap: Record<string, Partial<BookingItem>> = {};
    const cancelledList: BookingItem[] = [];

    targets.forEach(b => {
      const draft = drafts[b.id];
      if (draft.report === 'attended_unsigned') {
        const stu = students.find(st => matchesStudent(st, b.studentId, b.studentName));
        if (stu) creditDeltas[stu.id] = (creditDeltas[stu.id] || 0) - 1;
        const remain = stu ? stu.credits + (creditDeltas[stu.id] || 0) : 0;
        attendedMsg.push(`• ${b.studentName} 系統代簽 扣堂-1 剩餘${remain}`);
        addLog(
          `原課堂：${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}\n結果：系統代簽認列扣 1 堂\n事由：${draft.reason || '老師回報學生有出席'}`,
          '系統代簽', 'yellow', b.studentName, b.teacherId, undefined, Number(remain)
        );
        settledMap[b.id] = {
          signed: true,
          signedAt: settleTs,
          isSystemSigned: true,
          settlementType: 'system_deducted',
          systemSignedAt: settleTs,
          overdueReason: draft.reason || '老師回報學生有出席',
        };
      } else {
        // 學生未到忘記取消：比照一般取消直接生效（不扣堂、釋出時段、順延補排）
        addLog(
          `原課堂：${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}\n結果：${LATE_CANCEL_LABEL}\n事由：${draft.reason || '老師回報未到課'}`,
          '取消', getSelfCancelSeverity(b.teacherId === ADMIN_ID, true), b.studentName, b.teacherId
        );
        settledMap[b.id] = { status: 'cancelled_normal', isLateCancel: true, cancelledAt: settleTs };
        cancelledList.push(b);
      }
    });

    let next = bookings.map(b => settledMap[b.id] ? { ...b, ...settledMap[b.id] } : b);
    const added: BookingItem[] = [];
    cancelledList.forEach(c => {
      const result = tryAutoPostpone(c, next, creditDeltas);
      if (!result.added) return;
      added.push(result.added);
      next = [...next, result.added];
      addLog(
        `因取消 ${formatDateWithDay(c.date)} ${formatTimeStr(c.startHour, c.startMin)}，系統自動順延補排：${formatDateWithDay(result.added.date)} ${formatTimeStr(result.added.startHour, result.added.startMin)}`,
        '調度', 'normal', c.studentName, c.teacherId, undefined, undefined, '系統調配'
      );
    });

    setStudents(prev => prev.map(st =>
      creditDeltas[st.id] ? { ...st, credits: st.credits + creditDeltas[st.id] } : st
    ));
    setBookings(prev => [
      ...prev.map(b => settledMap[b.id] ? { ...b, ...settledMap[b.id] } : b),
      ...added,
    ]);
    submitPendingBookings(added, '取消後自動順延');
    notifyPriorityOwners(added);

    let finalAlert = "【逾期課堂結算處理完成】\n";
    if (attendedMsg.length > 0) finalAlert += `\n[未簽到處理]\n${attendedMsg.join("\n")}\n`;
    if (cancelledList.length > 0) finalAlert += `\n[未取消處理]\n${cancelledList.length} 堂已取消（${LATE_CANCEL_LABEL}，不扣學員堂數），自動順延補排 ${added.length} 堂。`;
    systemAlert(finalAlert);
  };

  // 非優先審核處理（結果日誌統一第三行備註事由）
  const handleReview = (reviewId: string, decision: 'approved' | 'rejected') => {
    const rev = reviews.find(r => r.id === reviewId);
    if (!rev) return;
    if (rev.status !== 'pending') {
      showToast('此案件已處理，請勿重複審核');
      return;
    }

    const isApproved = decision === 'approved';
    const targetBooking = bookings.find(b => b.id === rev.bookingId);
    const studentName = targetBooking?.studentName || rev.studentName || '';
    const cleanTeacher = cleanName(rev.teacherId, rev.teacherName);
    const reasonText = rev.reason ? `\n事由：${rev.reason}` : '';
    const decisionPatch: Partial<BookingItem> = isApproved
      ? { status: 'confirmed' }
      : { status: 'cancelled_normal', cancelReason: 'non_priority_rejected' };
    const resultText = isApproved ? '核准生效' : '駁回不成立（時段已釋出）';
    // 核准前重跑衝堂檢查（排程引擎、撤銷審核等例外路徑的保險）
    const findConflict = (t: BookingItem) => checkGlobalConflict({
      dateStr: t.date, startHour: t.startHour, startMin: t.startMin, durationMins: t.durationMins || 50,
      roomType: t.roomType, lessonType: t.lessonType, teacherId: t.teacherId,
      studentId: t.studentId, studentName: t.studentName, userRole: 'admin',
      existingBookings: bookings, teachersMap: teachers,
      studentsMap: Object.fromEntries(students.map(st => [st.id, st])), excludeBookingId: t.id,
    });

    // 批次審核（自動排課）：整批一次核准 / 駁回
    if (rev.batchBookingIds && rev.batchBookingIds.length > 0) {
      const ids = new Set(rev.batchBookingIds);
      const targets = bookings.filter(b => ids.has(b.id) && isPendingApproval(b));
      if (targets.length === 0) {
        showToast('找不到待審的對應課堂，無法審核');
        return;
      }
      if (isApproved) {
        const bad = targets.find(t => findConflict(t).hasConflict);
        if (bad) {
          systemAlert(`【無法核准】\n審核期間 ${formatDateWithDay(bad.date)} ${formatTimeStr(bad.startHour, bad.startMin)} 已被預約，請駁回此批次申請，由老師重新排課。`);
          return;
        }
      }
      const targetIds = new Set(targets.map(t => t.id));
      setBookings(prev => prev.map(b => targetIds.has(b.id) ? { ...b, ...decisionPatch } : b));
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, status: decision, bookingSnapshots: targets.map(t => ({ ...t })) } : r));
      const lines = targets
        .map(b => `${formatDateWithDay(b.date)} ${formatTimeStr(b.startHour, b.startMin)}`)
        .join('、');
      addLog(
        `預約：共 ${targets.length} 堂（${lines}）\n結果：${REVIEW_TAG}批次${resultText}${reasonText}`,
        '預約', isApproved ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
      );
      showToast(`審核完成：${REVIEW_TAG}批次（${targets.length} 堂）已${isApproved ? '核准' : '駁回'}`);
      return;
    }

    // 單堂審核
    if (!targetBooking) {
      showToast('找不到對應預約，無法審核');
      return;
    }
    if (!isPendingApproval(targetBooking)) {
      showToast('此課堂已取消或異動，無法審核');
      return;
    }
    if (isApproved) {
      const conflict = findConflict(targetBooking);
      if (conflict.hasConflict) {
        systemAlert(`【無法核准】\n審核期間該時段已被預約，請駁回此申請。\n${conflict.reason || ''}`);
        return;
      }
    }
    // 寫入「審核前快照 / 審核後狀態」供撤銷真正還原
    const after = { ...targetBooking, ...decisionPatch };
    setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, ...decisionPatch } : b));
    setReviews(prev => prev.map(r => r.id === reviewId
      ? { ...r, status: decision, bookingSnapshot: { ...targetBooking }, bookingAfter: after }
      : r));
    addLog(
      `預約：${rev.time}\n結果：${REVIEW_TAG}${resultText}${reasonText}`,
      '預約', isApproved ? 'yellow' : 'red', studentName, rev.teacherId, reviewId, undefined, cleanTeacher
    );
    showToast(`審核完成：${REVIEW_TAG}已${isApproved ? '核准' : '駁回'}`);
  };

  const handleResetReview = (reviewId: string) => {
    const rev = reviews.find(r => r.id === reviewId);
    if (!rev) return;
    if (rev.status === 'pending') {
      showToast('此案件尚未審核，無需撤銷');
      return;
    }
    // 自動結案的案件不可撤銷（課堂已簽到或取消，重開會成為無法裁決的待審案件）
    if (rev.autoClosed) {
      showToast('系統自動結案，無法撤銷');
      return;
    }
    // 待審案件只存在於開課前 14 天（含）以前；已進入免審核期者撤銷後會立即自動核准，故不開放
    const reviewed = rev.batchBookingIds ? rev.bookingSnapshots || [] : rev.bookingSnapshot ? [rev.bookingSnapshot] : [];
    if (reviewed.some(b => isInReviewFreeWindow(b.date, today))) {
      showToast('課堂已進入開課前 14 天內免審核期，無法撤銷審核');
      return;
    }
    // 駁回後時段已釋出：撤銷會重新佔用時段，若已被他人預約則禁止
    const retaken = rev.status === 'rejected' && reviewed.some(b => checkGlobalConflict({
      dateStr: b.date, startHour: b.startHour, startMin: b.startMin, durationMins: b.durationMins || 50,
      roomType: b.roomType, lessonType: b.lessonType, teacherId: b.teacherId,
      studentId: b.studentId, studentName: b.studentName, userRole: 'admin',
      existingBookings: bookings, teachersMap: teachers,
      studentsMap: Object.fromEntries(students.map(st => [st.id, st])), excludeBookingId: b.id,
    }).hasConflict);
    if (retaken) {
      showToast('原時段已被其他預約使用，無法撤銷審核');
      return;
    }
    const logReset = () => addLog(
      `原課堂：${rev.time}\n結果：撤銷審核（回歸待審）`,
      '預約', 'yellow', rev.studentName || '', rev.teacherId, undefined, undefined, cleanName(rev.teacherId, rev.teacherName)
    );

    // 批次審核：逐堂確認未被後續異動，再整批還原為待審
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

    // 單堂：依快照還原；課堂若已有後續變動則禁止撤銷
    const current = bookings.find(b => b.id === rev.bookingId);
    const after = rev.bookingAfter;
    const snapshot = rev.bookingSnapshot;
    const keys: (keyof BookingItem)[] = [
      'status', 'date', 'startHour', 'startMin', 'roomType', 'lessonType', 'signed', 'isSystemSigned',
    ];
    if (!current || !after || !snapshot || keys.some(k => (current[k] ?? undefined) !== (after[k] ?? undefined))) {
      showToast('此課堂在審核後已有後續變動（簽到、改期、取消等），無法撤銷審核');
      return;
    }
    setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...snapshot } : b));
    setReviews(prev => prev.map(r => r.id === reviewId
      ? { ...r, status: 'pending' as const, bookingSnapshot: undefined, bookingAfter: undefined }
      : r));
    logReset();
    showToast('已撤銷審核，課堂已還原，案件回到待審');
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

    // 狀態防護：避免重複簽到 / 已取消的課堂被扣堂（審核中課堂允許簽到）
    if (!isSignableBooking(targetBooking)) {
      showToast('此課堂已簽到或已取消，無法重複簽到');
      return;
    }
    // 簽名時間窗：開課前 1 小時才開放簽到（逾期補簽不受限，簽名板會顯示紅字提醒）
    if (getSignatureWindowStatus(targetBooking) === 'too_early') {
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
    const signedWhilePending = isPendingApproval(targetBooking);
    const applySignature = (b: BookingItem) =>
      b.id === bookingId && isSignableBooking(b)
        ? { 
            ...b, 
            // 審核中課堂到課簽到即視為實際授課（計入堂數與授課統計）
            ...(isPendingApproval(b) ? { status: 'confirmed' as const } : {}),
            signed: true, 
            isLateSigned: isLate, // 🌟 補簽標籤
            signatureData: signatureDataUrl, 
            signedName: sName, // 🌟 保存簽名人姓名避免消失
            signedAt: timestamp 
          }
        : b;
    setBookings(prev => prev.map(applySignature));
    if (signedWhilePending) settlePreBookingReviews(bookingId, bookings.map(applySignature));

    // 5. 日誌記錄與彈窗提示分流
    const actionLabel = isLate ? '補簽' : '簽到';
    const logBadgeColor = isLate || signedWhilePending ? 'yellow' : 'normal';

    addLog(
      `${bDate} ${bTime} [${actionLabel}] -1堂  餘 ${afterC} 堂${signedWhilePending ? '\n審核完成前已到課簽到（此堂免審核）' : ''}`, 
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
    const unread = logs.filter(l => isLogVisibleTo(l, userRole, currentUserId) && !isLogReadBy(l, currentUserId));
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

  if (!today) return null;

  return (
    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
      <div className="flex flex-col h-[100dvh] w-full max-w-none bg-slate-50 relative overflow-hidden font-sans">
        
        {systemDialog && (
          <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-6">
            <div role="dialog" aria-modal="true" className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <h3 className="text-base font-black text-slate-800">{systemDialog.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line break-words max-h-[50vh] overflow-y-auto">{systemDialog.message}</p>
              <div className="flex gap-2">
                <button onClick={() => closeSystemDialog(false)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold active:scale-[0.98] transition">取消</button>
                <button onClick={() => closeSystemDialog(true)} className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold active:scale-[0.98] transition">確定</button>
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
              {userRole !== 'admin' && (
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
        {/* md:p-5 會蓋掉 pb-20，需補 md:pb-20 才不會被底部導覽列遮住 */}
        <main className="flex-1 min-h-0 overflow-y-auto p-3 md:p-5 pb-20 md:pb-20">

            {/* Tab 1: 排班總覽（打通高度伸展） */}
            <div className={activeTab === 1 && !selectedStudentId && !selectedTeacherId ? 'flex flex-col h-full min-h-0 flex-1' : 'hidden'}>
              <Tab1StudioCalendar
                today={today} 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                students={students} 
                bookings={bookings} 
                isActive={activeTab === 1 && !selectedStudentId && !selectedTeacherId}
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
                today={today} 
                userRole={userRole} 
                currentUserId={currentUserId} 
                teachers={teachers} 
                bookings={bookings}
                isActive={activeTab === 2 && !selectedStudentId && !selectedTeacherId}
                onProcessSettlement={handleProcessSettlement}
                priorityGrid={priorityGrid}
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
                  today={today}
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
                  getPriorityHint={getPriorityHint}
                  students={students}
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
                  today={today}
                  currentUserId={currentUserId}
                  students={students}
                  setStudents={setStudents}
                  onUpdateStudent={handleUpdateStudent}
                  onSelectStudent={(id: string) => navigateToStudent(id, 3, true)}
                  isCreateModalOpen={isCreateStudentOpen}
                  setIsCreateModalOpen={setIsCreateStudentOpen}
                  onAddBookings={handleAddBookings}
                  addLog={addLog}
                  onSmartBook={handleSmartBookingSubmit}
                  getPriorityHint={getPriorityHint}
                  userRole={userRole}
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
                  today={today}
                  showToast={showToast} 
                />
              ) : (
                <Tab4TeachersManagement 
                  userRole={userRole} 
                  currentUserId={currentUserId} 
                  teachers={teachers} 
                  setTeachers={setTeachers} 
                  bookings={bookings} 
                  today={today}
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
                bookings={bookings}
                reviews={reviews} 
                onReview={handleReview} 
                onReset={handleResetReview} 
                logs={logs} 
                setLogs={setLogs} 
                studioRules={studioRules} 
                setStudioRules={setStudioRules} 
                showToast={showToast} 
                onRuleUpdate={broadcastRuleUpdate}
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
                      const s = bookableStudents.find(st => st.name === name);
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
                    {bookableStudents.map(s => (
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
                      {DAY_HOURS.map(h => (
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
                {bookingCheck.ok && bookingCheck.isPastSlot && (
                  <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-black text-rose-700 leading-relaxed">
                    ⚠️ 此時段已超過開課時間，確認後將直接寫入課表
                  </div>
                )}
                {bookingCheck.ok && bookingCheck.requiresReview && bookingCheck.priorityOwnerId && (
                  <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 font-black text-rose-700 leading-relaxed">
                    {priorityReviewHint(cleanName(bookingCheck.priorityOwnerId, '其他老師'))}
                  </div>
                )}
                {bookingCheck.ok && !bookingCheck.requiresReview && userRole !== 'admin' && bookingCheck.priorityOwnerId && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 font-bold text-amber-800 leading-relaxed">
                    ℹ️ 此為 {cleanName(bookingCheck.priorityOwnerId, '其他老師')} 優先時段（14 天內），預約直接生效並通知該老師
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
                  const s = bookableStudents.find(st => st.name === bookingForm.studentName);
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
                  }, { inlineNotices: true });
                  if (ok) setIsBookingModalOpen(false);
                }}
                disabled={!bookingCheck || !bookingCheck.ok}
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