'use client';
import { genId } from '../utils/id';
import React, { useState, useMemo } from 'react';
import { Plus, Edit3, Clock, PenTool, ZoomIn, X, AlertCircle, History, CreditCard, Sparkles, FileText, AlertTriangle, Copy, Check, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { 
  formatTimeStr, 
  getExactTimestamp, 
  ScheduleEngine, 
  formatDateWithDay, 
  ScheduleEngineResult 
} from '../mockData';

import { BookingStatusBadge, CanvasPad, CanvasPadModal, SignatureZoomModal } from './SignatureModals';
import BookingEditModal, { BookingEditConfirmPayload } from './BookingEditModal';
import ScheduleRulesEditor, { type ScheduleSettings } from './ScheduleRulesEditor';
import { getStudentBookingPreset, formatStudentSchedule, isFlexibleSchedule, isTaughtBooking, REVIEW_TAG, isOverdueUnsettled, getSignatureWindowStatus, isPendingApproval, occupiesQuota, matchesStudent, getScheduleQuota, isArchivedStudent, archiveConfirmMessage, compareByStart } from '../utils/bookingRules';
import { systemAlert, systemConfirm } from '../utils/systemAlert';
import { useNow } from '../utils/useToday';

export default function StudentDetailView({ 
  today,student, onBack, bookings, onUpdateStudent, onPurchase, onSign, onUpdateBookingNote, onAddBookings, onExecuteReschedule, openGlobalBooking, onClearUpcoming, showToast, addLog, currentUserId, teachers, userRole,
  students, priorityGrid,
  externalBuyModalOpen, setExternalBuyModalOpen
}: any) {
  const [expandHistory, setExpandHistory] = useState(false);
  const [expandUpcoming, setExpandUpcoming] = useState(false);
  
  const [signModalId, setSignModalId] = useState<{ id: string; studentName: string } | null>(null);
  
  // 變更預約狀態 (三行新排版 + 逾期事由備註)
  const [editingBooking, setEditingBooking] = useState<any>(null);

  // 購課彈窗狀態與單堂換算
  const [localBuyModalOpen, setLocalBuyModalOpen] = useState(false);
  const isBuyOpen = externalBuyModalOpen || localBuyModalOpen;
  const closeBuyModal = () => {
    setLocalBuyModalOpen(false);
    if (setExternalBuyModalOpen) setExternalBuyModalOpen(false);
  };

  const [buyCredits, setBuyCredits] = useState(10);
  const [buyPrice, setBuyPrice] = useState(22000);
  const unitPrice = useMemo(() => {
    return buyCredits > 0 ? Math.round(buyPrice / buyCredits) : 0;
  }, [buyCredits, buyPrice]);

  // 合約詳細檢視彈窗
  const [selectedContract, setSelectedContract] = useState<any | null>(null);

  // 規則編輯狀態 (每個時段均可自訂種類 1v1 / 1v2 與教室)
  // 排課規則編輯草稿；非 null 即開啟彈窗
  const [ruleDraft, setRuleDraft] = useState<ScheduleSettings | null>(null);
  
  // 自動排課確認與一鍵複製彈窗
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);
  const [scheduleResultModal, setScheduleResultModal] = useState<ScheduleEngineResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  
  const [zoomedSignature, setZoomedSignature] = useState<{ url: string, time: string } | null>(null);
  
  const studentBookings = bookings.filter((b: any) => matchesStudent(student, b.studentId, b.studentName));
  
  const now = useNow();
  // 逾期未處理（已開課、未簽、未取消）與預排互斥，口徑同 Tab 2 / Tab 4
  const overdueBookings = studentBookings.filter((b: any) => isOverdueUnsettled(b, now));
  const upcomingAndScheduled = studentBookings.filter((b: any) => occupiesQuota(b) && !isOverdueUnsettled(b, now)).sort(compareByStart);
  // 歷史紀錄只列已簽到（含補簽 / 系統代簽）與已取消；逾期未處理僅出現在上方逾期區塊
  const historyLessons = studentBookings.filter((b: any) => isTaughtBooking(b) || b.status === 'cancelled_normal')
    .sort((a: any, b: any) => compareByStart(b, a)); // 最新在前，收合時顯示最近 5 堂
  const purchases = [...(student.purchases || [])].sort((a: any, b: any) => b.date.localeCompare(a.date));

  // 堂數透支檢核：預排堂數超過剩餘堂數
  // 已佔用額度統一以 occupiesQuota 計算（含審核中，且未簽）
  const occupiedQuotaCount = studentBookings.filter(occupiesQuota).length;
  const isCreditsOverdrawn = occupiedQuotaCount > student.credits;
  const overdrawnCount = occupiedQuotaCount - student.credits;

  // 自動排課額度明細（歷史簽到已於簽到當下扣堂，不重複扣除）
  const quota = getScheduleQuota(bookings, student, now);

  const todayStr = today;
  const isFlexible = isFlexibleSchedule(student);

  const createRule = () => {
    const preset = getStudentBookingPreset(student, userRole);
    return { id: genId('r'), freq: '每週' as const, day: '一' as const, time: '10:00', startDate: todayStr, lessonType: preset.lessonType, roomType: preset.roomType };
  };

  const handleOpenRuleModal = () => {
    setRuleDraft({
      noRegularRule: isFlexible,
      rules: isFlexible ? [] : student.rules.map((r: any) => ({ ...r })),
      autoRescheduleOnCancel: !isFlexible && student.autoRescheduleOnCancel,
    });
  };

  const handleSaveRules = () => {
    if (!ruleDraft) return;
    const rules = ruleDraft.noRegularRule ? [] : ruleDraft.rules;
    onUpdateStudent({
      id: student.id,
      rules,
      defaultLessonType: rules[0]?.lessonType || student.defaultLessonType || '1v1',
      noRegularRule: ruleDraft.noRegularRule,
      autoRescheduleOnCancel: ruleDraft.autoRescheduleOnCancel,
    });
    setRuleDraft(null);
    showToast('排課時段規則已更新儲存');
  };

  // 續課簽署確認
  const handleConfirmPurchase = (studentSignUrl: string) => {
    const newPurchase = {
      id: genId('p'),
      date: todayStr,
      credits: Number(buyCredits),
      price: Number(buyPrice),
      teacherName: teachers[currentUserId]?.name || 'Daisy',
      studentName: student.name,
      studentSign: studentSignUrl,
      signedAt: getExactTimestamp()
    };

    const updatedCredits = student.credits + Number(buyCredits);
    // 以函數式更新增加堂數並附加購課紀錄，避免用過期的 student 快照覆蓋其他堂數異動
    onPurchase(student.id, newPurchase);

    addLog(
      `購課簽約：[${student.name}] 購買 ${buyCredits} 堂 (NT$ ${buyPrice.toLocaleString()}) · 堂數由 ${student.credits} 堂 ➔ 增為 ${updatedCredits} 堂 · 承辦：${teachers[currentUserId]?.name || 'Daisy'}`, 
      '購課', 
      'normal', 
      student.name,
      currentUserId,
      undefined,
      updatedCredits,
      teachers[currentUserId]?.name || 'Daisy'
    );
    closeBuyModal();
    showToast(`續課成功！已增加 ${buyCredits} 堂，目前剩餘 ${updatedCredits} 堂`);
  };

  // 試算兩種排課方式（僅在彈窗開啟時，不寫入資料）：90 天上限與需送審堂數直接顯示於彈窗內
  const schedulePreview = useMemo(() => {
    const none = { horizonWarning: false, append_remaining: 0, replace_future: 0 };
    if (!autoScheduleOpen || student.credits <= 0) return none;
    try {
      const engine = new ScheduleEngine(bookings, teachers, Object.fromEntries([[student.id, student]]));
      const run = (mode: 'append_remaining' | 'replace_future') => engine.generateSchedule({
        sid: student.id, sName: student.name, teacherId: student.teacherId,
        credits: student.credits, slots: student.rules, startFromDate: todayStr, todayStr,
        priorityGrid: priorityGrid || {},
        userRole, mode, maxWeeksLimit: 16,
        targetCount: mode === 'append_remaining' ? quota.availableToSchedule : quota.replaceTotal
      });
      const append = run('append_remaining');
      const replace = run('replace_future');
      return {
        horizonWarning: userRole !== 'admin' && (!!append.hitHorizonLimit || !!replace.hitHorizonLimit),
        append_remaining: append.nonPriorityCount ?? 0,
        replace_future: replace.nonPriorityCount ?? 0,
      };
    } catch { return none; }
  }, [autoScheduleOpen, userRole, student, bookings, teachers, todayStr, priorityGrid, quota.availableToSchedule, quota.replaceTotal]);

  // 執行自動排課（支援模式：'append_remaining' 接續排課 或 'replace_future' 重整未來）
  const handleRunAutoSchedule = (mode: 'append_remaining' | 'replace_future', startFromToday: boolean = true) => {
    if (student.credits <= 0) return systemAlert('學員剩餘堂數不足，請先購買續課');

    const engine = new ScheduleEngine(
      bookings, 
      teachers, 
      Object.fromEntries([[student.id, student]])
    );

    const baseReDate = startFromToday ? todayStr : (student.rules[0]?.startDate || todayStr);

    const result = engine.generateSchedule({
      sid: student.id,
      sName: student.name,
      teacherId: student.teacherId,
      credits: student.credits,
      slots: student.rules,
      startFromDate: baseReDate,
      todayStr,
      priorityGrid: priorityGrid || {},
      userRole,
      mode,
      maxWeeksLimit: 16,
      targetCount: mode === 'append_remaining' ? quota.availableToSchedule : quota.replaceTotal
    });

    if (result.success) {
      // 依據引擎判斷，保留安全保護區（已簽到、已逾期、已取消），僅替換或追加純預約
      const cleanBookings = bookings.filter((b: any) => !result.removedBookingIds.includes(b.id));
      onAddBookings(result.newRecords, cleanBookings, mode);
      setAutoScheduleOpen(false);
      setScheduleResultModal(result);

      // 未排入提醒已直接顯示於「排課完成確認」彈窗內
    } else {
      systemAlert(result.message || '無符合規則之課堂可排入');
    }
  };

  const handleCopyScheduleText = (text: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
      showToast('課表已複製至剪貼簿！');
    } else {
      showToast('剪貼簿權限受限，請手動複製文字');
    }
  };

  const openRescheduleModal = (b: any) => setEditingBooking(b);

  // 封存 / 解除封存：負責老師本人或管理員可操作
  const isArchived = isArchivedStudent(student);
  const canArchive = userRole === 'admin' || student.teacherId === currentUserId;

  const canClearUpcoming = userRole === 'admin' || student.teacherId === currentUserId;

  const handleClearUpcoming = async () => {
    const ok = await systemConfirm(
      `確定要清空學員「${student.name}」所有尚未開課的 ${upcomingAndScheduled.length} 堂預排嗎？\n` +
      '清空後這些課堂會標記為已取消（不扣學員堂數），且不會自動順延補排。\n開課前 24 小時內的課堂會標註超時取消。',
      '清空所有預排'
    );
    if (ok) onClearUpcoming(student.id);
  };

  const handleArchive = async () => {
    const ok = await systemConfirm(archiveConfirmMessage(student.name, upcomingAndScheduled.length));
    if (!ok) return;
    onUpdateStudent({ id: student.id, status: 'archived' });
    showToast(`學員 [${student.name}] 已移至封存`);
  };

  const handleRestore = () => {
    onUpdateStudent({ id: student.id, status: 'active' });
    showToast(`學員 [${student.name}] 已恢復上課`);
  };

  // 取消 / 改期一律交給 page 的 handleExecuteReschedule（含衝堂檢查、讓位、取消後自動順延）
  const handleConfirmReschedule = (p: BookingEditConfirmPayload) => {
    if (!editingBooking) return;
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
    <div className="space-y-3.5 animate-in fade-in slide-in-from-right-4 duration-200 pb-20">
      
      {isArchived && (
        <div className="bg-slate-100 border border-slate-300 p-3 rounded-2xl text-xs text-slate-600 flex items-center justify-between gap-2 shadow-2xs">
          <span className="font-bold flex items-center gap-1.5">
            <Archive className="w-4 h-4 shrink-0" /> 此學員已封存，無法新增預約或自動排課
          </span>
          {canArchive && (
            <button onClick={handleRestore} className="shrink-0 whitespace-nowrap bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-xl text-[11px] font-bold hover:bg-emerald-200 transition shadow-2xs flex items-center gap-1">
              <ArchiveRestore className="w-3.5 h-3.5" /> 解除封存（恢復上課）
            </button>
          )}
        </div>
      )}

      {/* 頂部排課規則與筆記卡片 */}
      <div className="bg-white p-3.5 rounded-3xl border border-slate-200 shadow-2xs space-y-2.5">
        <div className="flex justify-between items-start gap-2 font-bold text-slate-600 text-xs">
          <div className="min-w-0 space-y-1">
            <span className="inline-block font-mono text-[11px] bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl shadow-2xs">
              {formatStudentSchedule(student)}
            </span>
            <span className="block text-[10px] text-slate-400">
              取消自動順延補排：{!isFlexible && student.autoRescheduleOnCancel ? '開啟' : '關閉'}
            </span>
          </div>
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            <button 
              onClick={handleOpenRuleModal} 
              className="p-1 hover:bg-rose-50 rounded-lg text-rose-500 transition shadow-2xs border border-slate-100"
              title="編輯排課規則"
            >
              <Edit3 className="w-3.5 h-3.5"/>
            </button>
            {!isArchived && !isFlexible && (
              <button 
                onClick={() => setAutoScheduleOpen(true)} 
                className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1 border border-indigo-100 hover:bg-indigo-100 transition shadow-2xs"
              >
                <Sparkles className="w-3 h-3"/> 自動排課
              </button>
            )}
            {canClearUpcoming && (
              <button
                onClick={handleClearUpcoming}
                disabled={upcomingAndScheduled.length === 0}
                className="bg-white text-rose-600 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1 border border-rose-200 hover:bg-rose-50 transition shadow-2xs disabled:text-slate-300 disabled:border-slate-200 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                <Trash2 className="w-3 h-3"/> 清空所有預排
              </button>
            )}
          </div>
        </div>
        
        {/* 筆記備註框 */}
        <div className="relative pt-0.5">
          <input
            type="text"
            defaultValue={student.note || ''}
            placeholder="輸入學員身體狀況備註 (點擊外側自動儲存)..."
            onBlur={e => onUpdateStudent({ id: student.id, note: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-rose-400 transition shadow-2xs font-medium"
          />
          <Edit3 className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* 堂數衝突透支警示 */}
      {isCreditsOverdrawn && (
        <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl text-xs text-rose-800 flex items-center gap-2 shadow-2xs animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 animate-bounce" />
          <span className="font-bold">
            堂數衝突提醒：目前已佔用 {occupiedQuotaCount} 堂，剩餘 {student.credits} 堂（透支 {overdrawnCount} 堂），{isFlexible ? '請調整預排' : '請點擊「自動排課」重排'}以符合剩餘額度！
          </span>
        </div>
      )}

      {/* 預排課程 (卡片右上角新增「+」臨時排課按鈕) */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="font-black text-slate-800 flex items-center gap-1.5 text-sm">
            <Clock className="w-4 h-4 text-sky-600" /> 預排課程
          </h3>
          {!isArchived && (
            <button 
              onClick={() => openGlobalBooking({ studentId: student.id })}
              className="w-7 h-7 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl text-rose-600 flex items-center justify-center font-bold transition shadow-2xs active:scale-95"
              title="臨時預約排課"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="space-y-2">
          {upcomingAndScheduled.length === 0 && <p className="text-slate-300 text-center py-2 font-sans font-bold">無預排課程</p>}
          {upcomingAndScheduled.map((b: any, idx: number) => (
            <div key={b.id} className={`p-3 bg-slate-50 hover:bg-slate-100/80 transition rounded-2xl border border-slate-200 space-y-2 font-sans shadow-2xs ${idx > 0 && !expandUpcoming ? 'hidden' : ''}`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shadow-2xs ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                  <span className="font-black text-slate-800 font-mono text-sm">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                  <span className="text-slate-400 font-bold text-[11px]">({b.lessonType})</span>
                  {isPendingApproval(b) && (
                    <span className="shrink-0 whitespace-nowrap text-[10px] bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-black">{REVIEW_TAG}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => openRescheduleModal(b)} className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold border border-slate-200 bg-white hover:bg-slate-50 transition">{isPendingApproval(b) ? '取消' : '變更'}</button>
                  <button onClick={() => setSignModalId({ id: b.id, studentName: student.name })} className="bg-rose-500 hover:bg-rose-600 transition text-white px-3 py-1.5 rounded-xl font-black text-[11px] flex items-center gap-1 shadow-xs"><PenTool className="w-3 h-3"/> 簽名</button>
                </div>
              </div>
              <div className="relative pt-0.5">
                <input
                  type="text"
                  defaultValue={b.teacherNote || ''}
                  onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                  placeholder="填寫上課狀況備註..."
                  className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-slate-700 outline-none focus:ring-1 focus:ring-rose-400 transition"
                />
                <Edit3 className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400 pointer-events-none" />
              </div>
            </div>
          ))}
          {upcomingAndScheduled.length > 1 && (
            <button onClick={() => setExpandUpcoming(!expandUpcoming)} className="w-full text-center py-1.5 text-slate-400 font-bold text-[11px] hover:text-slate-600 transition bg-white border border-slate-100 rounded-xl shadow-2xs mt-1">
              {expandUpcoming ? '收合預排 ▲' : `展開其餘預排 (${upcomingAndScheduled.length - 1} 堂) ▼`}
            </button>
          )}
        </div>
      </div>
      {/* 該學員專屬的逾期待處理課堂 */}
      {overdueBookings.length > 0 && (
        <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-300 shadow-2xs space-y-3 mt-4">
          <h4 className="text-amber-900 font-black text-xs flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600" /> ⚠️ 此學員有 {overdueBookings.length} 堂逾期未處理課堂
          </h4>
          <div className="space-y-2">
            {overdueBookings.map((b: any) => (
              <div key={b.id} className="p-3 bg-white rounded-xl border border-amber-200 flex justify-between items-center shadow-2xs">
                <div>
                  <span className="font-mono font-bold text-slate-800 text-sm">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                  <span className="ml-2 text-xs text-slate-500 font-sans">{b.roomType === 'large' ? '大教室' : '小教室'} ({b.lessonType})</span>
                </div>
                <div className="flex gap-1.5 shrink-0 whitespace-nowrap">
                  <button onClick={() => openRescheduleModal(b)} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl font-bold transition">變更</button>
                  <button onClick={() => setSignModalId({ id: b.id, studentName: student.name })} className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-xl font-bold transition shadow-xs">{getSignatureWindowStatus(b, now) === 'late_over_1h' ? '補簽' : '簽名'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* 購課合約紀錄 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-4 text-xs">
        <h3 className="font-black text-slate-800 flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-rose-500" /> 購課合約紀錄</h3>
        <div className="space-y-2 divide-y border-t border-slate-100 pt-2">
          {purchases.length === 0 && <p className="text-slate-300 text-center py-2 font-sans font-bold">尚無購課紀錄</p>}
          {purchases.map((p: any) => (
            <div key={p.id} className="pt-2 flex justify-between items-center font-mono">
              <div className="flex flex-col">
                <span className="font-bold text-slate-800">{formatDateWithDay(p.date)} 購買 {p.credits} 堂</span>
                <span className="text-[10px] text-slate-400">NT$ {p.price?.toLocaleString()}</span>
              </div>
              <button
                onClick={() => setSelectedContract(p)}
                className="flex items-center gap-1 text-[10px] text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg font-bold hover:bg-rose-100 transition shadow-2xs"
              >
                <ZoomIn className="w-3.5 h-3.5" /> 檢視合約
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 歷史上課紀錄 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <h3 className="font-black text-slate-800 flex items-center gap-1.5"><History className="w-4 h-4 text-slate-600" /> 歷史上課紀錄</h3>
        <div className="space-y-2">
          {historyLessons.length === 0 && <p className="text-slate-300 text-center py-2 font-sans font-bold">無歷史紀錄</p>}
          {historyLessons.slice(0, expandHistory ? historyLessons.length : 5).map((b: any) => (
            <div key={b.id} className="p-3 bg-slate-50 rounded-xl space-y-2 text-xs text-slate-600 border border-slate-200 hover:bg-slate-100 transition shadow-2xs">
              <div className="flex justify-between items-center font-mono">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shadow-2xs ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                  <span className="font-bold text-slate-800">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                  <span className="text-[10px] text-slate-400 font-bold">({b.lessonType})</span>
                </div>
                {/* 簽到與結算多元狀態標籤 */}
                <BookingStatusBadge 
                  booking={b} 
                  onZoomSignature={setZoomedSignature} 
                />
              </div>
              {(b.settlementType === 'system_deducted' || b.isSystemSigned) && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 space-y-0.5">
                  <p className="font-bold">⚡ 系統代結對帳憑證</p>
                  <p>代結時間：<span className="font-mono">{b.systemSignedAt || b.signedAt || '—'}</span></p>
                  <p>事由備註：{b.overdueReason || '—'}</p>
                </div>
              )}
              <div className="relative">
                <input
                  type="text"
                  defaultValue={b.teacherNote || ''}
                  onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                  placeholder="歷史上課狀況筆記..."
                  className="w-full bg-white/80 border border-slate-200 rounded-lg pl-7 pr-2 py-1 text-[11px] text-slate-600 outline-none focus:ring-1 focus:ring-rose-400 transition"
                />
                <Edit3 className="w-3.5 h-3.5 absolute left-2 top-1.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
          ))}
          {historyLessons.length > 5 && (
            <button onClick={() => setExpandHistory(!expandHistory)} className="w-full text-center py-2 text-slate-400 font-bold text-[11px] hover:text-slate-600 transition bg-white border border-slate-100 rounded-xl shadow-2xs mt-2">
              {expandHistory ? '收合紀錄 ▲' : `展開更多歷史紀錄 ▼`}
            </button>
          )}
        </div>
      </div>

      {/* 封存學員 */}
      {canArchive && !isArchived && (
        <button onClick={handleArchive} className="w-full py-2.5 rounded-2xl text-xs font-bold bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 transition shadow-2xs flex items-center justify-center gap-1.5">
          <Archive className="w-4 h-4" /> 封存學員
        </button>
      )}

      {/* 變更 / 取消預約 Modal (共用元件) */}
      <BookingEditModal
        booking={editingBooking}
        cancelOnly={!!editingBooking && isPendingApproval(editingBooking)}
        userRole={userRole}
        today={today}
        bookings={bookings}
        studentName={student.name}
        priorityGrid={priorityGrid}
        teachers={teachers}
        students={students}
        onClose={() => setEditingBooking(null)}
        onConfirm={handleConfirmReschedule}
      />

      {/* 購課簽約彈窗 (含自動計算單堂價格) */}
      {isBuyOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-rose-500" /> 學員購課簽署 ({student.name})
              </h3>
              <button onClick={closeBuyModal} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400"><X className="w-4 h-4"/></button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">購買堂數</label>
                  <input
                    type="number"
                    value={buyCredits}
                    onChange={e => setBuyCredits(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">合約總金額 (NT$)</label>
                  <input
                    type="number"
                    value={buyPrice}
                    onChange={e => setBuyPrice(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none font-mono"
                  />
                </div>
              </div>

              {/* 單堂自動試算卡片 */}
              <div className="p-2.5 bg-rose-50/70 border border-rose-200 rounded-xl flex justify-between items-center">
                <span className="font-bold text-rose-800">單堂平均金額：</span>
                <span className="font-black font-mono text-sm text-rose-600">NT$ {unitPrice.toLocaleString()} / 堂</span>
              </div>

              <div>
                <label className="font-bold text-slate-600 block mb-1">學員手寫簽署確認</label>
                <CanvasPad
                  onCancel={closeBuyModal}
                  onConfirm={(signUrl) => handleConfirmPurchase(signUrl)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 詳細合約紀錄檢視 Modal */}
      {selectedContract && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={() => setSelectedContract(null)}>
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-rose-500" /> 購課合約存根
              </h3>
              <button onClick={() => setSelectedContract(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400"><X className="w-4 h-4"/></button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2 font-mono text-slate-700">
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-400 font-sans">承辦老師：</span>
                <span className="font-black text-slate-800 font-sans">{selectedContract.teacherName || teachers[currentUserId]?.name || 'Daisy'}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-400 font-sans">簽約學員：</span>
                <span className="font-black text-slate-800 font-sans">{selectedContract.studentName || student.name}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-400 font-sans">簽署時間：</span>
                <span className="font-bold text-slate-800">{selectedContract.signedAt || selectedContract.date.replace(/-/g, '/')}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-400 font-sans">購買方案：</span>
                <span className="font-black text-rose-600">{selectedContract.credits} 堂課</span>
              </div>
              <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                <span className="text-slate-400 font-sans">合約總價：</span>
                <span className="font-black text-slate-900">NT$ {selectedContract.price?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">單堂均價：</span>
                <span className="font-black text-slate-900">NT$ {Math.round(selectedContract.price / selectedContract.credits)?.toLocaleString()} / 堂</span>
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-600 block mb-1.5">學員簽署存根：</span>
              <div className="p-2 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center">
                {selectedContract.studentSign ? (
                  <img src={selectedContract.studentSign} alt="學員簽名" className="w-full h-24 object-contain bg-white rounded-xl shadow-2xs" />
                ) : (
                  <span className="text-slate-400 py-6">無手寫影像檔</span>
                )}
              </div>
            </div>

            <button
              onClick={() => setSelectedContract(null)}
              className="w-full bg-slate-800 hover:bg-slate-700 transition text-white py-2.5 rounded-xl font-bold shadow-xs"
            >
              關閉合約
            </button>
          </div>
        </div>
      )}

      {/* 排課時段規則設定 Modal */}
      {ruleDraft && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-2 shrink-0">
              <h3 className="text-sm font-black text-slate-800">排課時段規則</h3>
              <button onClick={() => setRuleDraft(null)} className="p-1 hover:bg-slate-100 rounded-lg transition"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1">
              <ScheduleRulesEditor value={ruleDraft} onChange={setRuleDraft} today={todayStr} createRule={createRule} />
            </div>
            
            <div className="pt-2 flex gap-2 shrink-0 border-t border-slate-100">
              <button onClick={() => setRuleDraft(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl font-bold text-slate-600">取消</button>
              <button onClick={handleSaveRules} className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs">儲存設定</button>
            </div>
          </div>
        </div>
      )}

      {/* 自動排課確認 Modal（統一狀況 A 與狀況 B 之二選一介面） */}
      {autoScheduleOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 animate-in zoom-in-95 text-xs">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" /> 自動排課
              </h3>
              <button onClick={() => setAutoScheduleOpen(false)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {/* 預設時段摘要 */}
              {(student.rules || []).some((r: any) => r.freq !== '不固定') && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-[11px] font-bold">
                  <div className="text-slate-500">預設排課時段：</div>
                  {(student.rules || []).filter((r: any) => r.freq !== '不固定').map((r: any) => (
                    <div key={r.id} className="text-slate-700">
                      {r.freq === '隔週' || r.freq === 'EOW' ? '隔週' : '每週'} {r.lessonType || '1v1'} {r.roomType === 'large' ? '大教室' : '小教室'} 週{r.day} {r.time}
                    </div>
                  ))}
                </div>
              )}

              {/* 堂數明細 */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-700">
                  <span>學生剩餘：</span>
                  <span className="font-black text-rose-600 text-sm">{quota.totalRemaining} 堂</span>
                </div>
                <div className="flex justify-between gap-2 text-slate-500 text-[11px]">
                  <span>1. 歷史簽到：<span className="block text-[10px] text-slate-400 font-sans">僅顯示紀錄參考，不重複扣除</span></span>
                  <span className="font-bold text-slate-700 shrink-0">{quota.signedCount} 堂</span>
                </div>
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>2. 逾期紀錄：</span>
                  <span className="font-bold text-slate-700">{quota.overdueCount} 堂</span>
                </div>
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>3. 待審核預約：</span>
                  <span className="font-bold text-amber-600">{quota.pendingCount} 堂</span>
                </div>
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>4. 已經預排：</span>
                  <span className="font-bold text-indigo-600">{quota.confirmedFutureCount} 堂</span>
                </div>
                <div className="flex justify-between text-slate-700 text-[11px] border-t border-slate-200 pt-1.5">
                  <span>5. 剩餘可排：</span>
                  <span className="font-black text-emerald-600">{quota.availableToSchedule} 堂</span>
                </div>
              </div>

              {/* 既有有效預約明細列表（若有預排課堂） */}
              {upcomingAndScheduled.length > 0 && (
                <div>
                  <label className="font-bold text-slate-600 block mb-1 text-[11px]">已排定的未來課堂清單：</label>
                  <div className="max-h-28 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-1">
                    {upcomingAndScheduled.map((b: any) => (
                      <div key={b.id} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="flex items-center gap-1 text-slate-700">
                          <span className={`w-1.5 h-1.5 rounded-full ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                          {formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}
                        </span>
                        <span className="text-slate-400 font-sans font-bold">
                          {isPendingApproval(b) && <span className="text-amber-600 mr-1">{REVIEW_TAG}</span>}
                          ({b.lessonType})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {schedulePreview.horizonWarning && (
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 font-bold text-[11px] leading-relaxed">
                  ⚠️ 場租老師最多只能預約未來 3 個月內的教室，超出日期的剩餘堂數將暫不排入（待日後日期開放再補排）。
                </div>
              )}

              <p className="text-slate-500 leading-relaxed text-[11px]">
                請選擇排課方式：
              </p>
            </div>

            {/* 統一二選一按鈕 */}
            <div className="pt-1 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleRunAutoSchedule('append_remaining')}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-bold transition shadow-xs text-left px-3.5 flex flex-col"
              >
                <span className="text-xs font-black">1. 接續順延排課 {quota.availableToSchedule} 堂</span>
                <span className="text-[10px] text-indigo-100 font-normal">
                  保留原本的 {quota.pendingCount + quota.confirmedFutureCount} 堂課，把剩下的 {quota.availableToSchedule} 堂往後接續排完
                </span>
                {schedulePreview.append_remaining > 0 && (
                  <span className="mt-1 text-[10px] font-black bg-amber-100 text-amber-900 rounded-lg px-2 py-1">
                    ⚠️ 其中 {schedulePreview.append_remaining} 堂為其他老師優先時段（14 天前預約），排入後需經管理員審核
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleRunAutoSchedule('replace_future')}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl font-bold transition shadow-xs text-left px-3.5 flex flex-col"
              >
                <span className="text-xs font-black">2. 全部重新排課 {quota.replaceTotal} 堂</span>
                <span className="text-[10px] text-slate-300 font-normal">
                  清空還沒上的課（待審核課堂保留），從今天開始重新排滿 {quota.replaceTotal} 堂
                </span>
                {schedulePreview.replace_future > 0 && (
                  <span className="mt-1 text-[10px] font-black bg-amber-100 text-amber-900 rounded-lg px-2 py-1">
                    ⚠️ 其中 {schedulePreview.replace_future} 堂為其他老師優先時段（14 天前預約），排入後需經管理員審核
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setAutoScheduleOpen(false)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 py-2 rounded-xl font-bold transition text-center text-xs mt-0.5"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 排課結果確認與一鍵複製 Modal */}
      {scheduleResultModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" /> 排課完成確認
              </h3>
              <button onClick={() => setScheduleResultModal(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-900 font-bold leading-tight">
              {scheduleResultModal.message}
            </div>

            {(scheduleResultModal.nonPriorityCount ?? 0) > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-800 font-bold leading-snug">
                ⏳ 其中 {scheduleResultModal.nonPriorityCount} 堂為{REVIEW_TAG}，需經管理員核准，核准前標示為待審核。
              </div>
            )}

            {(scheduleResultModal.remainingUnscheduled ?? 0) > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-800 font-bold leading-snug">
                ⚠️ 剩餘 {scheduleResultModal.remainingUnscheduled} 堂因為{scheduleResultModal.hitHorizonLimit ? '超過 3 個月可排課日期' : '時段衝突'}，故沒有排入。
              </div>
            )}

            {(scheduleResultModal.skippedReasons?.length ?? 0) > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 leading-snug space-y-1">
                <div className="font-black">未排入的時段明細：</div>
                <ul className="max-h-28 overflow-y-auto space-y-0.5 list-disc pl-4 text-[11px] font-medium">
                  {scheduleResultModal.skippedReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}

            {(scheduleResultModal.suggestedRoomSwaps?.length ?? 0) > 0 && (
              <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-sky-900 leading-snug space-y-1">
                <div className="font-black">🔄 因衝堂已自動改排至其他教室：</div>
                <ul className="max-h-24 overflow-y-auto space-y-0.5 list-disc pl-4 text-[11px] font-medium">
                  {scheduleResultModal.suggestedRoomSwaps!.map((w, i) => (
                    <li key={i}>{w.date} {w.time}：{w.reason || `已改排至${w.targetRoom === 'large' ? '大教室' : '小教室'}`}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 課表文字預覽區 */}
            <div className="max-h-52 overflow-y-auto p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] whitespace-pre-wrap select-all text-slate-700">
              {scheduleResultModal.copyText}
            </div>

            <div className="pt-1 flex flex-col gap-2">
              <button
                onClick={() => handleCopyScheduleText(scheduleResultModal.copyText)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-black transition shadow-xs flex items-center justify-center gap-1.5"
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                {isCopied ? '已複製課表！' : '一鍵複製課表'}
              </button>
              <button
                onClick={() => setScheduleResultModal(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 py-2 rounded-xl font-bold transition text-[11px]"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手動確認手寫簽名 Modal（外層彈窗由 CanvasPadModal 自行提供） */}
      {signModalId && (
        <CanvasPadModal
          signModalTarget={signModalId}
          bookings={bookings}
          onClose={() => setSignModalId(null)}
          onSign={onSign}
          getExactTimestamp={getExactTimestamp}
        />
      )}
      {/* 放大檢視簽名憑證 Modal */}
      <SignatureZoomModal
        zoomedSignature={zoomedSignature}
        onClose={() => setZoomedSignature(null)}
      />
    </div>
  );
}