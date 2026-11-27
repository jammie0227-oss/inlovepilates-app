'use client';
import { genId } from '../utils/id';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import BookingModal, { type BookingFormState } from '../components/BookingModal';
import {
  REVIEW_TAG,
  compareByStart,
  formatLessonRef,
  formatLessonsTitle,
  classifyBookingLifecycle,
  calculateStudentStats,
  canSettleBooking,
  shouldAutoReschedule,
  canPostponeOnCancel,
  canRelocateToSmall,
  isYieldableLesson,
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
  ADMIN_ID,
  getDefaultRoomForSchedule,
  getScheduleRole,
} from '../utils/bookingRules';
import type { AutoSwapItem, BookingRequestInput } from '../utils/bookingRules';
import type { SettlementAction } from '../types';
import { useToday } from '../utils/useToday';
import { systemAlert, registerSystemAlert, systemConfirm, registerSystemDialog, type SystemAlertPayload, type SystemDialogRequest } from '../utils/systemAlert';

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

  // 大教室讓位：每一堂被移動的課各發一則改室通知給原老師
  const buildSwapLogItems = (
    swaps: AutoSwapItem[],
    ctx: { byTeacherName: string; newStudentName: string; newLessonType: '1v1' | '1v2' }
  ): AuditLogItem[] =>
    swaps.map(sw => {
      const before = { ...sw, roomType: 'large' as const, lessonType: '1v1' as const };
      const after = { ...before, roomType: 'small' as const };
      return buildLessonLog(
        [after],
        `原定課程：${formatLessonRef(before)}\n系統調度：因 ${ctx.byTeacherName} 老師的 ${ctx.newStudentName} (${ctx.newLessonType}) 預約需使用大教室，此堂已自動移至小教室`,
        '自動改室', 'yellow', { actor: '系統調度' }
      );
    });

  const countTeachers = (swaps: AutoSwapItem[]) => new Set(swaps.map(s => s.teacherId)).size;

  /** 讓位完成提示（手動預約、改期、自動排課、順延補排共用） */
  const swapSummary = (swaps: AutoSwapItem[]) =>
    `原大教室 ${swaps.length} 堂 1v1 已移至小教室，並通知 ${countTeachers(swaps)} 位原任課老師`;

  const navigateToStudent = (studentId: string, sourceTab: number) => {
    const s = students.find(item => item.id === studentId);
    if (s) {
      setPreviousTab(sourceTab);
      setSelectedStudentId(s.id);
      setActiveTab(3);
    } else {
      showToast(`找不到該名學員資料`);
    }
  };
  // 全域共用預約彈窗：非 null 即開啟，內容為帶入的預設值
  const [bookingPreset, setBookingPreset] = useState<BookingFormState | null>(null);

  // 新增預約可選的學員：自己名下且未封存
  const bookableStudents = students.filter(s => s.teacherId === currentUserId && !isArchivedStudent(s));
  // 由學員詳情頁帶入的學員（管理員查看他人學員時不在自己名單內）一併列入
  const presetStudent = students.find(s => s.id === bookingPreset?.studentId && !isArchivedStudent(s));
  // 管理員非由學員詳情頁開啟時可選授課老師，學員名單交由彈窗依所選老師過濾
  const canSelectTeacher = userRole === 'admin' && !bookingPreset?.fromStudentDetail;
  const modalStudents = canSelectTeacher
    ? students
    : presetStudent && !bookableStudents.some(s => s.id === presetStudent.id)
      ? [presetStudent, ...bookableStudents]
      : bookableStudents;

  // 開啟全域預約彈窗的統一入口
  const openGlobalBooking = (preset?: Partial<BookingFormState>) => {
    const target = students.find(s => s.id === preset?.studentId) ?? bookableStudents[0];
    const teacherId = preset?.teacherId || currentUserId;
    const lessonType = preset?.lessonType || getStudentBookingPreset(target, teacherId).lessonType;

    setBookingPreset({
      date: preset?.date || today,
      hour: String(preset?.hour || '10').padStart(2, '0'),
      minute: String(preset?.minute || '00').padStart(2, '0'),
      roomType: preset?.roomType || getDefaultRoomForSchedule(teacherId, lessonType),
      lessonType,
      teacherId,
      studentId: target?.id || '',
      fromStudentDetail: preset?.fromStudentDetail,
    });
  };

  // 預約彈窗內的即時檢測（衝堂 / 教室調度 / 優先時段），結果直接顯示在彈窗中
  const checkBooking = useCallback(
    (input: BookingRequestInput, studentOverride?: Pick<StudentItem, 'id' | 'name' | 'credits'>) =>
      validateAndBuildBooking({
        input, userRole, today, priorityGrid, bookings, teachers, students, studentOverride,
      }),
    [userRole, today, priorityGrid, bookings, teachers, students]
  );

  const cleanName = (teacherId: string, fallback = '老師') =>
    (teachers[teacherId]?.name || fallback).replace(/ 老師|老師/g, '').trim();

  // 單堂（或同一學員多堂）通知：標題一律「老師名・學生名（色點 M/D HH:mm 類別）」
  const buildLessonLog = (
    lessons: Pick<BookingItem, 'teacherId' | 'studentName' | 'date' | 'startHour' | 'startMin' | 'roomType' | 'lessonType'>[],
    detail: string,
    typeStr: string,
    category: LogLevel = 'normal',
    opts: { recipientId?: string; actor?: string; reviewId?: string; remainingCredits?: number } = {}
  ): AuditLogItem => {
    const first = lessons[0];
    const teacherName = cleanName(first.teacherId);
    return {
      ...buildLogItem(
        detail, typeStr, category, first.studentName, opts.recipientId ?? first.teacherId,
        opts.reviewId, opts.remainingCredits, opts.actor ?? teacherName
      ),
      title: formatLessonsTitle(teacherName, first.studentName, lessons),
    };
  };

  /** 多堂通知的內文明細；單堂已寫在標題，不重複列出 */
  const lessonList = (lessons: BookingItem[]) =>
    lessons.length > 1 ? `\n${lessons.map(formatLessonRef).join('\n')}` : '';

  const pushLogs = (items: AuditLogItem[]) => {
    if (items.length > 0) setLogs(prev => [...items, ...prev]);
  };

  // 一般老師在他人優先時段（14 天內）直接生效的預約 / 改期：通知該優先老師（不帶學員資料）
  const buildPriorityNoticeLogs = (list: BookingItem[], role = userRole): AuditLogItem[] => {
    if (role === 'admin') return [];
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
      const sorted = [...items].sort(compareByStart);
      return {
        ...buildLogItem(
          `優先時段提醒：${who} 老師已使用您的優先時段${lessonList(sorted)}`,
          '提醒', 'yellow', '', ownerId, undefined, undefined, who
        ),
        title: formatLessonsTitle(who, '', sorted),
      };
    });
  };

  const notifyPriorityOwners = (list: BookingItem[]) => pushLogs(buildPriorityNoticeLogs(list));

  // 學員資料修改：套用並寫入灰階紀錄（內容沒有實際變動則不寫）
  const handleUpdateStudent = (patch: any) => {
    const cur = students.find(s => s.id === patch.id);
    if (!cur) return;
    const labels: Record<string, string> = {
      note: '備註', rules: '排課規則', name: '姓名', phone: '電話', teacherId: '負責老師', status: '狀態',
      defaultLessonType: '預設課程類別', lessonType: '課程類別', noRegularRule: '排課模式',
      autoRescheduleOnCancel: '取消時自動順延補排',
    };
    const comparable = (k: string, v: unknown) => JSON.stringify(k === 'noRegularRule' ? !!v : v ?? null);
    const changes = Object.keys(patch)
      .filter(k => k !== 'id' && comparable(k, (cur as any)[k]) !== comparable(k, patch[k]));
    if (changes.length === 0) return;
    setStudents(prev => prev.map(s => s.id === patch.id ? { ...s, ...patch } : s));
    const statusLabel = (v: StudentItem['status']) => (v === 'archived' ? '已封存' : '上課中');
    const lines = changes.map(k => {
      if (k === 'status') return `${labels[k]}：${statusLabel(cur.status)} ➔ ${statusLabel(patch[k])}`;
      if (k === 'noRegularRule') {
        const mode = (v: unknown) => (v ? '無固定時間' : '固定每週時段');
        return `${labels[k]}：${mode(cur.noRegularRule)} ➔ ${mode(patch[k])}`;
      }
      if (k === 'autoRescheduleOnCancel') {
        const onOff = (v: unknown) => (v ? '開啟' : '關閉');
        return `${labels[k]}：${onOff(cur.autoRescheduleOnCancel)} ➔ ${onOff(patch[k])}`;
      }
      if (k === 'rules') return `${labels[k]}：${formatRules((cur as any)[k])} ➔ ${formatRules(patch[k])}`;
      if (k === 'note') return `${labels[k]}：${(cur as any)[k] || '（空）'} ➔ ${patch[k] || '（空）'}`;
      return `${labels[k] || k}：${String((cur as any)[k] ?? '（空）')} ➔ ${String(patch[k] ?? '（空）')}`;
    });
    addLog(`學員資料修改\n${lines.join('\n')}`, '學員資料', 'gray', cur.name, cur.teacherId);
  };

  // 非優先審核送審：同批多堂合併為一張批次審核單（核准 / 駁回一次套用），並發一則紅色通知
  const submitPendingBatch = (list: BookingItem[], reason: string, actor?: string) => {
    if (list.length === 0) return;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin));
    const first = sorted[0];
    const isBatch = sorted.length > 1;
    const revId = reviewIdFor(first.id);
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
    pushLogs([buildLessonLog(
      sorted,
      `結果：送交${REVIEW_TAG}${isBatch ? '（批次）' : ''}\n事由：${reason}${lessonList(sorted)}`,
      '預約', 'red', { reviewId: revId, actor }
    )]);
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
  const handleAddBookings = (
    newBks: BookingItem[],
    cleanBase?: BookingItem[],
    mode?: 'append_remaining' | 'replace_future',
    /** 排課引擎為 1v2 讓位而需移至小教室的既有 1v1 */
    autoSwaps: AutoSwapItem[] = []
  ) => {
    if (cleanBase) {
      setBookings(() => applyAutoSwaps([...cleanBase, ...newBks], autoSwaps));
    } else {
      setBookings(prev => applyAutoSwaps([...prev, ...newBks], autoSwaps));
    }

    // 自動排課：不論排入幾堂，合併為單一筆「系統預排」通知
    if (newBks.length > 0) {
      const ordered = [...newBks].sort(compareByStart);
      const first = ordered[0];
      const monthDay = (b: BookingItem) => `${Number(b.date.slice(5, 7))}/${Number(b.date.slice(8))}`;
      const range = `${monthDay(first)} ～ ${monthDay(ordered[ordered.length - 1])}`;
      const tName = cleanName(first.teacherId);
      const removedCount = cleanBase ? bookings.length - cleanBase.length : 0;
      const nonPriorityCount = newBks.filter(isPendingApproval).length;
      pushLogs([{
        ...buildLogItem(
          `自動排課（${mode === 'replace_future' ? '重整未來' : mode === 'append_remaining' ? '接續排課' : '新增'}）：總共自動排入 ${newBks.length} 堂` +
          (removedCount > 0 ? `（取代原預排 ${removedCount} 堂）` : '') +
          `\n起迄日期：${range}\n課堂列表：\n${ordered.map(formatLessonRef).join('\n')}` +
          (nonPriorityCount > 0 ? `\n其中 ${nonPriorityCount} 堂為非優先時段，已批次送審` : ''),
          '系統預排', 'normal', first.studentName, first.teacherId, undefined, undefined, tName
        ),
        title: `${tName}・${first.studentName} 自動排入 ${newBks.length} 堂（${range}）`,
      }]);
    }

    // 待審課堂（一般老師）：合併送審 + 紅色通知；14 天內使用他人優先時段則通知該老師
    submitPendingBookings(newBks, '自動排課');
    notifyPriorityOwners(newBks);

    // 大教室讓位：通知每一堂被移動課堂的原老師
    if (newBks.length > 0 && autoSwaps.length > 0) {
      pushLogs(buildSwapLogItems(autoSwaps, {
        byTeacherName: cleanName(newBks[0].teacherId),
        newStudentName: newBks[0].studentName,
        newLessonType: '1v2',
      }));
      showToast(`調度成功：${swapSummary(autoSwaps)}`);
    }
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
    // 衝堂、教室調度、過去時段與優先時段提示皆由呼叫端彈窗即時顯示，此處僅做寫入前把關
    if (!validation.ok || !validation.booking) return false;

    const newBk = validation.booking;
    const currentTeacherName = cleanName(newBk.teacherId);
    const targetStudent = opts.studentOverride ?? students.find(s => matchesStudent(s, input.studentId, input.studentName));
    const needsReview = validation.requiresReview;
    const pName = validation.priorityOwnerId ? cleanName(validation.priorityOwnerId, '其他老師') : '';
    // 管理員代其他老師新增預約：紀錄操作者為 Daisy，優先時段依授課老師身分處理
    const actor = userRole === 'admin' && newBk.teacherId !== currentUserId ? 'Daisy' : undefined;
    const scheduleRole = getScheduleRole(newBk.teacherId);

    // 3. 額度調配：加課超額時，僅能替換「confirmed、未簽、isAuto」的最遠預約；否則走透支確認
    let released: BookingItem | null = null;
    let rebateNotice: string | null = null;
    if (validation.quota.found && validation.quota.exceeds && targetStudent) {
      const remainingCredits = validation.quota.credits;
      const replaceable = remainingCredits > 0
        ? findReplaceableAutoBooking(
            bookings.filter(b => !validation.autoSwaps.some(s => s.bookingId === b.id)),
            targetStudent
          )
        : undefined;

      const canAutoRebate = !!replaceable &&
        !isWithin24Hours(replaceable.date, replaceable.startHour, replaceable.startMin);

      if (replaceable && canAutoRebate) {
        // 最遠預排課距離開課 > 24 小時：自動回扣，寫入完成後提醒
        released = replaceable;
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

    // ---- 先建立所有日誌（任何一筆失敗就整體中止，不會留下半套寫入） ----
    const logItems: AuditLogItem[] = [];
    try {
      if (released) {
        logItems.push(buildLessonLog(
          [released],
          `因臨時加課${formatLessonRef(newBk)}，系統自動回扣最遠日期的這堂預排`,
          '調度', 'yellow', { recipientId: newBk.teacherId, actor: '系統調配' }
        ));
      }
      if (!needsReview) {
        logItems.push(buildLessonLog([newBk], '預約成立', '預約', 'normal', { actor }));
        logItems.push(...buildPriorityNoticeLogs([newBk], scheduleRole));
      }
      logItems.push(...buildSwapLogItems(validation.autoSwaps, {
        byTeacherName: currentTeacherName,
        newStudentName: newBk.studentName,
        newLessonType: newBk.lessonType,
      }));
    } catch (err) {
      console.error('調度通知建立失敗', err);
      showToast('調度通知建立失敗，預約已中止，請重試');
      return false;
    }

    // ---- 寫入課堂 / 審核單 / 日誌 ----
    setBookings(prev => [
      ...applyAutoSwaps(prev.filter(b => b.id !== released?.id), validation.autoSwaps),
      newBk,
    ]);
    setLogs(prev => [...logItems.slice().reverse(), ...prev]);
    if (needsReview) submitPendingBatch([newBk], NON_PRIORITY_REASON, actor);

    // ---- 寫入完成後才顯示提示 ----
    if (rebateNotice) systemAlert(rebateNotice, '預排課程已回扣');
    if (validation.autoSwaps.length > 0) {
      showToast(`調度成功：${swapSummary(validation.autoSwaps)}`);
    } else if (needsReview) {
      showToast(`已送交${REVIEW_TAG}，待管理員核准`);
    } else if (!opts.silentSuccess) {
      showToast(scheduleRole !== 'admin' && pName ? `預約建立成功！已通知 ${pName} 老師（優先時段）` : '預約建立成功！');
    }
    return true;
  };

  // 取消生效後的自動順延：額度仍有空位才補排，起點不早於今天
  const tryAutoPostpone = (
    cancelled: BookingItem,
    bookingsAfterCancel: BookingItem[],
    /** true = 操作者在取消確認彈窗選擇順延；false = 依學員開關自動判定（系統取消） */
    requested = false
  ): { added?: BookingItem; autoSwaps?: AutoSwapItem[]; message?: string } => {
    const stu = students.find(s => matchesStudent(s, cancelled.studentId, cancelled.studentName));
    // 無固定時間沒有時段可依循、封存學員不可再排課，一律不順延
    if (!stu || !(requested ? canPostponeOnCancel(stu) : shouldAutoReschedule(stu))) return {};
    const occupied = calculateStudentStats(bookingsAfterCancel, stu).occupiedCount;
    if (occupied >= stu.credits) {
      return requested ? { message: '學員剩餘堂數已全數排定，沒有可補排的額度。' } : {};
    }

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
    return { added: res.postponedBooking ?? undefined, autoSwaps: res.autoSwaps, message: res.alertMsg };
  };

  /** 順延補排觸發的大教室讓位通知 */
  const buildPostponeSwapLogs = (added: BookingItem, swaps: AutoSwapItem[]) =>
    buildSwapLogItems(swaps, {
      byTeacherName: cleanName(added.teacherId),
      newStudentName: added.studentName,
      newLessonType: added.lessonType,
    });

  const buildPostponeLog = (cancelled: BookingItem, added: BookingItem): AuditLogItem =>
    buildLessonLog(
      [added],
      `因${formatLessonRef(cancelled)}取消，故自動延後預排 1 堂${formatLessonRef(added)}`,
      '系統預排', 'normal', { actor: '系統調配' }
    );

  // 所有「系統自動結案」一律走這裡：更新審核單狀態並寫入紀錄（每張審核單一筆）
  const autoCloseReviews = (items: { review: ReviewItem; status: 'approved' | 'rejected'; note: string }[]) => {
    if (items.length === 0) return;
    const byId = new Map(items.map(i => [i.review.id, i]));
    setReviews(prev => prev.map(r => {
      const hit = byId.get(r.id);
      return hit ? { ...r, status: hit.status, resolvedNote: hit.note, autoClosed: true } : r;
    }));
    pushLogs(items.map(({ review, note }) => {
      const ids = review.batchBookingIds?.length ? review.batchBookingIds : [review.bookingId];
      const lessons = bookings.filter(b => ids.includes(b.id)).sort(compareByStart);
      const result = `結果：${REVIEW_TAG}自動結案（${note}）\n事由：${review.reason}`;
      return lessons.length > 0
        ? buildLessonLog(lessons, `${result}${lessonList(lessons)}`, '自動結案', 'yellow')
        : buildLogItem(
            `原課堂：${review.time}\n${result}`,
            '自動結案', 'yellow', review.studentName, review.teacherId, undefined, undefined, cleanName(review.teacherId)
          );
    }));
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

    byApplicant.forEach((items, applicantId) => {
      const who = cleanName(applicantId);
      const sorted = [...items].sort(compareByStart);
      const names = Array.from(new Set(sorted.map(b => b.studentName))).join('、');
      logItems.push({
        ...buildLogItem(
          `${REVIEW_TAG}自動核准` +
          (sorted.length > 1 ? `\n${sorted.map(b => `${formatLessonRef(b)} ${b.studentName}`).join('\n')}` : '') +
          `\n結果：${AUTO_APPROVE_NOTE}`,
          '自動核准', 'yellow', names, applicantId, undefined, undefined, who
        ),
        title: formatLessonsTitle(who, names, sorted),
      });
      const byOwner = new Map<string, BookingItem[]>();
      sorted.forEach(b => {
        const owner = findOtherPriorityOwner({
          dateStr: b.date, startHour: b.startHour, startMin: b.startMin, durationMins: b.durationMins,
          roomType: b.roomType, teacherId: b.teacherId, priorityGrid,
        });
        if (owner) byOwner.set(owner, [...(byOwner.get(owner) || []), b]);
      });
      byOwner.forEach((owned, ownerId) => {
        logItems.push({
          ...buildLogItem(
            `優先時段提醒：${who} 老師在您優先時段的預約已自動核准${lessonList(owned)}\n結果：${AUTO_APPROVE_NOTE}`,
            '自動核准', 'yellow', '', ownerId, undefined, undefined, who
          ),
          title: formatLessonsTitle(who, '', owned),
        });
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
  const settlePreBookingReviews = (bookingIds: string[], bookingsAfter: BookingItem[]) => {
    autoCloseReviews(reviews.flatMap(review => {
      if (review.status !== 'pending') return [];
      const ids = review.batchBookingIds?.length ? review.batchBookingIds : [review.bookingId];
      if (!bookingIds.some(id => ids.includes(id))) return [];
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
    autoSwaps: AutoSwapItem[] = [],
    /** 取消時是否順延補排 1 堂（取消確認彈窗的選擇） */
    postpone = false
  ): string | undefined => {
    // 回傳錯誤訊息代表未寫入，由變更彈窗直接顯示
    const target = bookings.find(b => b.id === bookingId);
    if (!target) return '找不到此課堂，請關閉後重試';
    // 非優先審核中：審核完成前不可改期改室，僅可簽到或取消
    if (!isCancel && isPendingApproval(target)) {
      return '審核完成前無法變更，僅可簽名或取消';
    }
    // 狀態防護：已簽到 / 已取消的課堂不可再異動（取消另允許審核中課堂）
    if (isCancel ? !isSignableBooking(target) : !isActionableBooking(target)) {
      return '此課堂已簽到或已取消，無法再異動';
    }

    const finalLessonType = newLessonType || target.lessonType;

    const actorName = userRole === 'admin' ? 'Daisy' : cleanName(currentUserId);

    // 管理員直接變更「其他老師」的課表：寫入稽核紀錄，並通知操作管理員與被變更的老師
    const isAdminOverride = userRole === 'admin' && target.teacherId !== currentUserId;
    const logAdminOverride = (lesson: BookingItem, detail: string, action: '取消' | '改期' | '改室') => {
      const level = getAdminOverrideSeverity(action);
      const ownerName = cleanName(target.teacherId);
      pushLogs([
        buildLessonLog([lesson], `管理員 Daisy 協助 ${ownerName} 老師異動課表\n${detail}`,
          '管理員異動', level, { recipientId: ADMIN_ID, actor: 'Daisy' }),
        buildLessonLog([lesson], `管理員 Daisy 已協助變更您的課表\n${detail}`,
          '管理員異動', level, { actor: 'Daisy' }),
      ]);
    };

    // ================= 取消 =================
    // 一律直接生效：不扣學員堂數、釋出空位、依操作者選擇順延補排；24 小時內僅標註「超時取消」
    if (isCancel) {
      const isLateCancel = isWithin24Hours(target.date, target.startHour, target.startMin);
      const cancelPatch: Partial<BookingItem> = {
        status: 'cancelled_normal', isLateCancel, cancelledAt: formatTimestamp(),
      };
      const bookingsAfterCancel = bookings.map(b => b.id === bookingId ? { ...b, ...cancelPatch } : b);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...cancelPatch } : b));
      settlePreBookingReviews([bookingId], bookingsAfterCancel);

      const cancelLabel = isLateCancel ? LATE_CANCEL_LABEL : '一般取消';
      if (isAdminOverride) {
        logAdminOverride(target, `結果：${cancelLabel}（時段已釋出，學員堂數不扣）`, '取消');
      } else {
        pushLogs([buildLessonLog(
          [target], `結果：${cancelLabel}`, '取消',
          getSelfCancelSeverity(userRole === 'admin', isLateCancel), { actor: actorName }
        )]);
      }

      // 選擇順延時，取消生效後檢查額度，有空位才補排一堂（起點不早於今天）
      const doneText = isLateCancel ? `已取消課堂（${LATE_CANCEL_LABEL}）` : '已取消課堂';
      const postponed: ReturnType<typeof tryAutoPostpone> = postpone
        ? tryAutoPostpone(target, bookingsAfterCancel, true)
        : {};
      if (postponed.added) {
        const added = postponed.added;
        const swaps = postponed.autoSwaps ?? [];
        const addedTime = `${formatDateWithDay(added.date)} ${formatTimeStr(added.startHour, added.startMin)}`;
        setBookings(prev => applyAutoSwaps([...prev, added], swaps));
        submitPendingBookings([added], '取消後自動順延');
        pushLogs([...buildPostponeSwapLogs(added, swaps), buildPostponeLog(target, added)]);
        notifyPriorityOwners([added]);
        showToast(`${doneText}，並已為學員自動順延補排一堂課（${addedTime}）${swaps.length > 0 ? `；${swapSummary(swaps)}` : ''}`);
      } else {
        showToast(doneText);
        if (postpone) {
          systemAlert(`課堂已取消，但未順延補排。\n${postponed.message || '找不到可補排的固定時段。'}`);
        }
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
      !b || b.id === bookingId || b.roomType !== 'large' ||
      !isYieldableLesson(b) || !canRelocateToSmall(b, bookings, bookingId)
    );
    if (swapInvalid) {
      return '原大教室課堂的狀態已變動或小教室已無法容納，系統已中止調度，請重新操作。';
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
      return conflict.reason || '該時段已有預約';
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
      return '調度通知建立失敗，改期已中止，請重試';
    }

    const moved: BookingItem = {
      ...target,
      date: newDate,
      startHour: newHour,
      startMin: newMin,
      roomType: newRoom,
      lessonType: finalLessonType,
      // 僅日期或時間變動才記錄改期歷程；僅改教室 / 類別沿用原紀錄
      ...(timeUnchanged ? {} : {
        rescheduledInfo: {
          updatedAt: formatTimestamp(),
          originalDate: target.date,
          originalStartTime: formatTimeStr(target.startHour, target.startMin),
          originalRoomId: target.roomType,
        },
      }),
    };
    // 課表立即移至新時段（原時段釋出，新時段佔用）並同步移動被讓位的課堂
    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) return moved;
      return swapIds.has(b.id) ? { ...b, roomType: 'small' as const } : b;
    }));
    if (swapLogs.length > 0) setLogs(prev => [...swapLogs.slice().reverse(), ...prev]);
    const afterWriteNotice = swapLogs.length > 0 ? `；${swapSummary(autoSwaps)}` : '';

    // 標題只寫變更後的時段與教室，原定課程寫在內文
    const detail = `原定課程：${formatLessonRef(target)}\n結果：${changeType}完成`;
    if (isAdminOverride) {
      logAdminOverride(moved, detail, changeType);
    } else {
      pushLogs([buildLessonLog([moved], detail, changeType, userRole === 'admin' ? 'normal' : 'yellow', { actor: actorName })]);
    }
    if (!timeUnchanged || roomChanged) notifyPriorityOwners([moved]);
    showToast(`${userRole === 'admin' ? '管理員已變更預約' : `${changeType}完成！`}${afterWriteNotice}`);
  };

  // --- 逾期課堂系統代簽（單堂或全部）/ 全部系統取消 ---
  const handleSettle = (bookingIds: string[], action: SettlementAction) => {
    const isSign = action === 'system_sign';
    const actionName = isSign ? '系統代簽' : '系統取消';
    // 僅處理仍為「逾期未處理」且有權處理的課堂，避免重複扣堂
    const targets = bookings.filter(b =>
      bookingIds.includes(b.id) && classifyBookingLifecycle(b) === 'overdue' && canSettleBooking(b, userRole, currentUserId),
    ).sort(compareByStart);
    if (targets.length === 0) {
      showToast(`沒有可${actionName}的逾期課堂（已簽到、取消或無權限）`);
      return;
    }

    const settledAt = formatTimestamp();
    const patch: Partial<BookingItem> = isSign
      ? {
          status: 'confirmed',
          signed: true,
          signedAt: settledAt,
          isSystemSigned: true,
          systemSignedAt: settledAt,
          settlementType: 'system_deducted',
        }
      : {
          status: 'cancelled_normal',
          isSystemCancelled: true,
          systemCancelledAt: settledAt,
          cancelledAt: settledAt,
          // 已開課後才取消，統計上屬超時取消
          isLateCancel: true,
        };

    const creditDeltas: Record<string, number> = {};
    const entries = targets.map(b => {
      const stu = students.find(st => matchesStudent(st, b.studentId, b.studentName));
      const creditsDeducted = isSign && stu ? 1 : 0;
      if (stu && creditsDeducted) creditDeltas[stu.id] = (creditDeltas[stu.id] || 0) - creditsDeducted;
      const remain = stu ? stu.credits + (creditDeltas[stu.id] || 0) : 0;

      // 管理員代其他老師處理：操作者記為管理員，系統取消比照代為取消的分級
      const isAdminOverride = userRole === 'admin' && b.teacherId !== currentUserId;
      const log = buildLessonLog(
        [b],
        (isAdminOverride ? `管理員 Daisy 協助 ${cleanName(b.teacherId)} 老師處理逾期課堂\n` : '') +
          (isSign
            ? `逾期未處理課堂執行【系統代簽】，扣除 ${creditsDeducted} 堂，學員剩餘 ${remain} 堂`
            : '逾期未處理課堂執行【系統取消】，不扣堂數'),
        actionName,
        isSign
          ? 'yellow'
          : isAdminOverride ? getAdminOverrideSeverity('取消') : getSelfCancelSeverity(b.teacherId === ADMIN_ID, true),
        { remainingCredits: isSign && stu ? remain : undefined, actor: isAdminOverride ? 'Daisy' : undefined }
      );
      log.settlement = {
        action, bookingId: b.id, studentId: stu?.id, settledAt,
        snapshot: { ...b }, creditsDeducted,
      };
      return { booking: b, log };
    });

    const targetIds = new Set(targets.map(b => b.id));
    const apply = (b: BookingItem): BookingItem => targetIds.has(b.id) ? { ...b, ...patch } : b;

    // 系統取消：依學員開關逐堂順延補排
    let next = bookings.map(apply);
    const added: BookingItem[] = [];
    const swaps: AutoSwapItem[] = [];
    const postponeLogs: AuditLogItem[] = [];
    if (!isSign) {
      entries.forEach(({ booking, log }) => {
        const result = tryAutoPostpone(booking, next);
        if (!result.added || !log.settlement) return;
        added.push(result.added);
        swaps.push(...(result.autoSwaps ?? []));
        next = applyAutoSwaps([...next, result.added], result.autoSwaps ?? []);
        const postponeLog = buildPostponeLog(booking, result.added);
        postponeLogs.push(...buildPostponeSwapLogs(result.added, result.autoSwaps ?? []), postponeLog);
        log.settlement = { ...log.settlement, postponedBookingId: result.added.id, postponeLogId: postponeLog.id };
      });
    }

    setStudents(prev => prev.map(st =>
      creditDeltas[st.id] ? { ...st, credits: st.credits + creditDeltas[st.id] } : st
    ));
    setBookings(prev => applyAutoSwaps([...prev.map(apply), ...added], swaps));
    pushLogs([...postponeLogs, ...entries.map(e => e.log)]);
    settlePreBookingReviews(targets.map(b => b.id), next);
    submitPendingBookings(added, '取消後自動順延');
    notifyPriorityOwners(added);

    showToast(isSign
      ? `已系統代簽 ${targets.length} 堂，共扣除 ${entries.filter(e => e.log.settlement?.creditsDeducted).length} 堂`
      : `已系統取消 ${targets.length} 堂（不扣堂），自動順延補排 ${added.length} 堂`);
  };

  // --- 管理員撤銷系統代簽 / 系統取消：還原為逾期未處理、回補堂數、移除自動補排 ---
  const handleUndoSettlement = (logId: string) => {
    if (userRole !== 'admin') return;
    const log = logs.find(l => l.id === logId);
    const record = log?.settlement;
    if (!log || !record) return;
    if (log.revokedAt) {
      showToast('此操作已撤銷');
      return;
    }

    const current = bookings.find(b => b.id === record.bookingId);
    const stillSettled = !!current && (record.action === 'system_sign'
      ? current.signed && current.systemSignedAt === record.settledAt
      : current.status === 'cancelled_normal' && current.systemCancelledAt === record.settledAt);
    if (!current || !stillSettled) {
      showToast('此課堂在系統處理後已有後續變動，無法撤銷');
      return;
    }
    const postponed = bookings.find(b => b.id === record.postponedBookingId);
    if (postponed && !isSignableBooking(postponed)) {
      showToast('自動補排的課堂已簽到或取消，無法撤銷');
      return;
    }

    // 逾期課堂已在免審核期內，一律還原為 confirmed、未簽到
    const restored: BookingItem = { ...record.snapshot, status: 'confirmed', teacherNote: current.teacherNote };
    const remaining = bookings.filter(b => b.id !== postponed?.id);
    // 系統取消曾釋出時段：若已被其他預約使用則不可還原
    if (record.action === 'system_cancel' && checkGlobalConflict({
      dateStr: restored.date, startHour: restored.startHour, startMin: restored.startMin,
      durationMins: restored.durationMins || 50, roomType: restored.roomType, lessonType: restored.lessonType,
      teacherId: restored.teacherId, studentId: restored.studentId, studentName: restored.studentName,
      userRole: 'admin', existingBookings: remaining, teachersMap: teachers,
      studentsMap: Object.fromEntries(students.map(st => [st.id, st])), excludeBookingId: restored.id,
    }).hasConflict) {
      showToast('原時段已被其他預約使用，無法撤銷');
      return;
    }

    const next = remaining.map(b => b.id === restored.id ? restored : b);
    setBookings(prev => prev
      .filter(b => b.id !== postponed?.id)
      .map(b => b.id === restored.id ? restored : b));
    if (record.creditsDeducted > 0) {
      setStudents(prev => prev.map(st => st.id === record.studentId
        ? { ...st, credits: st.credits + record.creditsDeducted }
        : st));
    }
    // 補排課堂若曾送審，審核單一併結案
    if (postponed) settlePreBookingReviews([postponed.id], next);
    const revokedAt = formatTimestamp();
    setLogs(prev => prev.map(l =>
      l.id === logId || (!!record.postponeLogId && l.id === record.postponeLogId) ? { ...l, revokedAt } : l));

    showToast(
      `已撤銷${record.action === 'system_sign' ? '系統代簽' : '系統取消'}，課堂回到逾期未處理` +
      (record.creditsDeducted > 0 ? `，回補 ${record.creditsDeducted} 堂` : '') +
      (postponed ? '，並移除自動補排課堂' : '')
    );
  };

  // --- 清空學員所有尚未開課的預排（不順延補排，合併通知） ---
  const handleClearUpcoming = (studentId: string) => {
    const stu = students.find(s => s.id === studentId);
    if (!stu || (userRole !== 'admin' && stu.teacherId !== currentUserId)) return;
    const now = new Date();
    const targets = calculateStudentStats(bookings, stu, now).upcoming;
    if (targets.length === 0) {
      showToast('目前沒有尚未開課的預排');
      return;
    }

    const cancelledAt = formatTimestamp();
    const patches = new Map<string, Partial<BookingItem>>(targets.map(b => [b.id, {
      status: 'cancelled_normal', cancelledAt, isLateCancel: isWithin24Hours(b.date, b.startHour, b.startMin),
    }]));
    const apply = (b: BookingItem): BookingItem => {
      const patch = patches.get(b.id);
      return patch ? { ...b, ...patch } : b;
    };
    setBookings(prev => prev.map(apply));
    settlePreBookingReviews(targets.map(b => b.id), bookings.map(apply));

    // 每位任課老師一則合併通知（一般情況下僅一位）
    const byTeacher = new Map<string, BookingItem[]>();
    targets.forEach(b => byTeacher.set(b.teacherId, [...(byTeacher.get(b.teacherId) || []), b]));
    pushLogs(Array.from(byTeacher.entries()).map(([teacherId, items]) => {
      const isOverride = userRole === 'admin' && teacherId !== currentUserId;
      const lines = items.map(b =>
        `${formatLessonRef(b)}${patches.get(b.id)?.isLateCancel ? ` ${LATE_CANCEL_LABEL}` : ''}`);
      const tName = cleanName(teacherId);
      return {
        ...buildLogItem(
          `${isOverride ? '管理員 Daisy 已協助清空預排\n' : ''}清空所有預排：批次取消 ${items.length} 堂（不扣學員堂數、不順延補排）\n${lines.join('\n')}`,
          '清空預排',
          isOverride
            ? getAdminOverrideSeverity('取消')
            : getSelfCancelSeverity(userRole === 'admin', items.some(b => patches.get(b.id)?.isLateCancel)),
          stu.name, teacherId, undefined, undefined, userRole === 'admin' ? 'Daisy' : tName
        ),
        title: formatLessonsTitle(tName, stu.name, items),
      };
    }));
    showToast(`已清空 ${targets.length} 堂預排`);
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
    const reasonText = rev.reason ? `\n事由：${rev.reason}` : '';
    const decisionPatch: Partial<BookingItem> = isApproved
      ? { status: 'confirmed' }
      : { status: 'cancelled_normal', cancelReason: 'non_priority_rejected', cancelledAt: formatTimestamp() };
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
      pushLogs([buildLessonLog(
        [...targets].sort(compareByStart),
        `結果：${REVIEW_TAG}批次${resultText}${reasonText}${lessonList(targets)}`,
        '預約', isApproved ? 'yellow' : 'red', { reviewId }
      )]);
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
    pushLogs([buildLessonLog(
      [after], `結果：${REVIEW_TAG}${resultText}${reasonText}`,
      '預約', isApproved ? 'yellow' : 'red', { reviewId }
    )]);
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
    if (reviewed.length === 0) {
      showToast('找不到審核前的課堂紀錄，無法撤銷審核');
      return;
    }
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
    const logReset = () => pushLogs([buildLessonLog(
      [...reviewed].sort(compareByStart),
      `結果：撤銷審核（回歸待審）${lessonList(reviewed)}`,
      '預約', 'yellow'
    )]);

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
      // 上課筆記不屬於審核內容，撤銷時保留目前版本
      setBookings(prev => prev.map(b => snaps.has(b.id) ? { ...(snaps.get(b.id) as BookingItem), teacherNote: b.teacherNote } : b));
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
    setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...snapshot, teacherNote: b.teacherNote } : b));
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
    if (signedWhilePending) settlePreBookingReviews([bookingId], bookings.map(applySignature));

    // 5. 日誌記錄與彈窗提示分流
    const actionLabel = isLate ? '補簽' : '簽到';
    const logBadgeColor = isLate || signedWhilePending ? 'yellow' : 'normal';

    pushLogs([buildLessonLog(
      [targetBooking],
      `[${actionLabel}] -1堂  餘 ${afterC} 堂${signedWhilePending ? '\n審核完成前已到課簽到（此堂免審核）' : ''}`,
      actionLabel,
      logBadgeColor,
      { actor: tName, remainingCredits: afterC }
    )]);

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
                onSelectStudent={(id: string) => navigateToStudent(id, 1)}
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
                onSettle={handleSettle}
                priorityGrid={priorityGrid}
                onExecuteReschedule={handleExecuteReschedule}
                students={students} 
                onSign={handleSign} 
                onUpdateBookingNote={(bId: any, note: any) => { 
                  setBookings(prev => prev.map(b => b.id === bId ? { ...b, teacherNote: note } : b)); 
                  showToast('備註已更新'); 
                }} 
                showToast={showToast} 
                onSelectStudent={(id: string) => navigateToStudent(id, 2)} 
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
                  onSettle={handleSettle}
                  openGlobalBooking={openGlobalBooking}
                  onClearUpcoming={handleClearUpcoming}
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
                  onSelectStudent={(id: string) => navigateToStudent(id, 3)}
                  isCreateModalOpen={isCreateStudentOpen}
                  setIsCreateModalOpen={setIsCreateStudentOpen}
                  onAddBookings={handleAddBookings}
                  addLog={addLog}
                  onSmartBook={handleSmartBookingSubmit}
                  checkBooking={checkBooking}
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
                onUndoSettlement={handleUndoSettlement}
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
        {/* 全域共用新增預約彈窗 */}
        {bookingPreset && (
          <BookingModal
            initial={bookingPreset}
            students={modalStudents}
            canSelectTeacher={canSelectTeacher}
            teachers={teachers}
            validate={checkBooking}
            onSubmit={handleSmartBookingSubmit}
            onClose={() => setBookingPreset(null)}
          />
        )}

      </div>
    </div>
  );
}