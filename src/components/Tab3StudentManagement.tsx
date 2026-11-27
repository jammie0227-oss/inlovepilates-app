'use client';
import { genId } from '../utils/id';
import React, { useState, useMemo } from 'react';
import { Plus, X, Sparkles, UserPlus, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { 
  getExactTimestamp, 
  ScheduleEngine, 
  formatDateWithDay, 
  formatTimeStr, 
  ScheduleEngineResult 
} from '../mockData';

import { formatStudentSchedule, isArchivedStudent, archiveConfirmMessage, DAY_HOURS, BUSINESS_MINUTES, REVIEW_TAG, calculateStudentStats } from '../utils/bookingRules';
import BookingCheckCard from './BookingCheckCard';
import ScheduleRulesEditor, { type ScheduleSettings } from './ScheduleRulesEditor';
import { useNow } from '../utils/useToday';
import { systemAlert, systemConfirm } from '../utils/systemAlert';

// 維持原有引用相容：StudentDetailView 已拆分至獨立檔案
export { default as StudentDetailView } from './StudentDetailView';

// 封存切換開關：開啟＝已封存
function ArchiveToggle({ archived, name, onToggle }: { archived: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={archived}
      aria-label={`封存學員 ${name}`}
      title={archived ? '解除封存（恢復上課）' : '封存學員'}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className="shrink-0 p-1.5 -m-1.5 inline-flex items-center"
    >
      <span className={`relative inline-block w-8 h-[18px] rounded-full transition-colors ${archived ? 'bg-slate-500' : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${archived ? 'translate-x-3.5' : ''}`} />
      </span>
    </button>
  );
}

// ==========================================
// 1. 第一層：學生管理清單
// ==========================================
export default function Tab3StudentManagement({ 
  today,currentUserId, students, setStudents, onSelectStudent, isCreateModalOpen, setIsCreateModalOpen, onAddBookings, addLog, onSmartBook, showToast, teachers, bookings, onSign,
  userRole, priorityGrid, checkBooking, onUpdateStudent
}: any) {
  const now = useNow();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sortField, setSortField] = useState<'name' | 'next'>('name');
  const [sortDesc, setSortDesc] = useState(false);

  // 新增學員彈窗狀態
  const [createMode, setCreateMode] = useState<'trial' | 'regular'>('trial');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentPhone, setNewStudentPhone] = useState('');
  const [newStudentNote, setNewStudentNote] = useState('');
  const [newInitialCredits, setNewInitialCredits] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false); // 防連點送出鎖
  
  // 體驗課專屬欄位
  const todayStr = today;
  const [trialDate, setTrialDate] = useState(todayStr);
  const [trialHour, setTrialHour] = useState('14');
  const [trialMin, setTrialMin] = useState('00');
  const [trialRoom, setTrialRoom] = useState<'large' | 'small'>('small');
  const [trialLessonType, setTrialLessonType] = useState<'1v1' | '1v2'>('1v1');

  // 正式學員排課設定：固定每週時段 / 無固定時間、各時段類別與教室、取消順延開關
  const createRule = () => ({ id: genId('r'), freq: '每週' as const, day: '一' as const, time: '10:00', startDate: todayStr, lessonType: '1v1' as const, roomType: 'small' as const });
  const defaultSchedule = (): ScheduleSettings => ({ noRegularRule: false, rules: [createRule()], autoRescheduleOnCancel: true });
  const [schedule, setSchedule] = useState<ScheduleSettings>(defaultSchedule);

  // 新增完成後排課明細與一鍵複製 Modal
  const [scheduleModalResult, setScheduleModalResult] = useState<ScheduleEngineResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const hours = DAY_HOURS;
  const minutes = BUSINESS_MINUTES;

  const myStudents = useMemo(() => students.filter((s: any) => s.teacherId === currentUserId), [students, currentUserId]);

  const sortedActive = useMemo(() => {
    // 透過 Set 進行嚴格 ID 防呆去重，重複項直接濾除，解決報錯與雙重渲染
    const seenIds = new Set<string>();
    const list = myStudents.filter((s: any) => {
      if (isArchivedStudent(s)) return false;
      if (seenIds.has(s.id)) return false;
      seenIds.add(s.id);
      return true;
    });

    // 下堂課與逾期提示一律由共用堂數計算機推導；沒有預排者排在最後
    const rows = list.map((s: any) => ({ ...s, stats: calculateStudentStats(bookings, s, now) }));
    const nextKey = ({ stats: { nextLesson: next } }: any) => next
      ? `${next.date} ${formatTimeStr(next.startHour, next.startMin)}`
      : '9999';
    rows.sort((a: any, b: any) => {
      const valA = sortField === 'name' ? a.name : nextKey(a);
      const valB = sortField === 'name' ? b.name : nextKey(b);
      return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
    });
    return rows;
  }, [myStudents, bookings, now, sortField, sortDesc]);

  const archivedStudents = useMemo(() => myStudents.filter(isArchivedStudent), [myStudents]);

  // 體驗課時段：衝堂 / 教室調度 / 優先時段即時顯示於彈窗內
  const trialCheck = isCreateModalOpen && createMode === 'trial'
    ? checkBooking?.({
        date: trialDate,
        startHour: parseInt(trialHour, 10),
        startMin: parseInt(trialMin, 10),
        durationMins: 50,
        teacherId: currentUserId,
        studentId: '',
        studentName: newStudentName,
        roomType: trialRoom,
        lessonType: trialLessonType,
      }, { id: '', name: newStudentName, credits: 1 }) ?? null
    : null;

  // 列表開關：封存需確認，解除封存一鍵還原
  const handleToggleArchive = async (s: any) => {
    if (isArchivedStudent(s)) {
      onUpdateStudent({ id: s.id, status: 'active' });
      showToast(`學員 [${s.name}] 已恢復上課`);
      return;
    }
    const ok = await systemConfirm(archiveConfirmMessage(s.name, calculateStudentStats(bookings, s, now).upcomingCount));
    if (!ok) return;
    onUpdateStudent({ id: s.id, status: 'archived' });
    showToast(`學員 [${s.name}] 已移至封存`);
  };

  const handleSort = (field: 'name' | 'next') => {
    if (sortField === field) setSortDesc(!sortDesc);
    else { setSortField(field); setSortDesc(false); }
  };

  // 儲存新增學員（加入防重複送出鎖與隨機熵）
  const handleSaveNewStudent = async () => {
    if (isSubmitting) return;
    if (!newStudentName.trim()) return systemAlert('請輸入學員姓名');

    setIsSubmitting(true);

    // 附帶隨機熵字串，保證即便在同一毫秒建立，ID 也絕對唯一
    const newId = genId('s');
    const studentsMap = Object.fromEntries(students.map((s: any) => [s.id, s]));

    if (createMode === 'trial') {
      const trialH = parseInt(trialHour, 10);
      const trialM = parseInt(trialMin, 10);

      // 體驗課走全站統一預約入口（時間限制 / 教室調度 / 衝堂 / 非優先送審）
      const bookingOk = await onSmartBook(
        {
          date: trialDate,
          startHour: trialH,
          startMin: trialM,
          durationMins: 50,
          teacherId: currentUserId,
          studentId: newId,
          studentName: newStudentName,
          roomType: trialRoom,
          lessonType: trialLessonType,
        },
        { studentOverride: { id: newId, name: newStudentName, credits: 1 }, silentSuccess: true }
      );
      if (!bookingOk) {
        setIsSubmitting(false);
        return;
      }

      const trialPurchases = [{
        id: genId('p-init'),
        date: trialDate,
        credits: 1,
        price: 0,
        teacherName: teachers[currentUserId]?.name || 'Daisy',
        studentName: newStudentName,
        signedAt: getExactTimestamp()
      }];

      const newTrialStudent = {
        id: newId,
        name: newStudentName,
        phone: newStudentPhone || '未提供',
        teacherId: currentUserId,
        note: newStudentNote || '體驗學員',
        credits: 1,
        defaultLessonType: trialLessonType,
        lessonType: trialLessonType,
        isTrial: true,
        noRegularRule: true,
        rules: [],
        autoRescheduleOnCancel: false,
        status: 'active' as const,
        purchases: trialPurchases
      };

      setStudents((prev: any) => {
        if (prev.some((s: any) => s.id === newId)) return prev;
        return [newTrialStudent, ...prev];
      });
      addLog?.(`新增體驗學員：${newStudentName}（${trialLessonType}）`, '學員資料', 'gray', newStudentName, currentUserId);
      showToast(`已建立體驗學員 [${newStudentName}] 並同步排定課堂！`);
      closeModal();
    } else {
      const isNoRegular = schedule.noRegularRule;
      const newRules = isNoRegular ? [] : schedule.rules;
      const initialCreditsNum = Number(newInitialCredits) || 0;
      const initialPurchases = initialCreditsNum > 0 ? [{
        id: genId('p-init'),
        date: todayStr,
        credits: initialCreditsNum,
        price: 0,
        teacherName: teachers[currentUserId]?.name || 'Daisy',
        studentName: newStudentName,
        signedAt: getExactTimestamp()
      }] : [];

      const newRegularStudent = {
        id: newId,
        name: newStudentName,
        phone: newStudentPhone || '未提供',
        teacherId: currentUserId,
        note: newStudentNote,
        credits: initialCreditsNum,
        defaultLessonType: newRules[0]?.lessonType || '1v1',
        lessonType: newRules[0]?.lessonType || '1v1',
        isTrial: false,
        noRegularRule: isNoRegular,
        rules: newRules,
        autoRescheduleOnCancel: schedule.autoRescheduleOnCancel,
        status: 'active' as const,
        purchases: initialPurchases
      };

      setStudents((prev: any) => {
        if (prev.some((s: any) => s.id === newId)) return prev;
        return [newRegularStudent, ...prev];
      });

      addLog?.(`新增正式學員：${newStudentName}（初始 ${initialCreditsNum} 堂）`, '學員資料', 'gray', newStudentName, currentUserId);

      if (!isNoRegular && newRegularStudent.credits > 0) {
        const engine = new ScheduleEngine(bookings, teachers, studentsMap);
        const result = engine.generateSchedule({
          sid: newId,
          sName: newStudentName,
          teacherId: currentUserId,
          credits: newRegularStudent.credits,
          slots: newRules,
          startFromDate: todayStr,
          todayStr,
          priorityGrid: priorityGrid || {},
          userRole,
          mode: 'replace_future'
        });

        // 與學生頁自動排課一致：有待審課堂時送出前先確認
        if ((result.nonPriorityCount ?? 0) > 0 &&
          !await systemConfirm(`⚠️ 有 ${result.nonPriorityCount} 堂為其他老師優先時段（14 天前預約），排入後需經管理員審核，是否繼續進行排課？`)) {
          showToast(`正式學員 [${newStudentName}] 建立成功（尚未排課）`);
          closeModal();
          return;
        }

        if (result.newRecords.length > 0) {
          onAddBookings(result.newRecords);
        }

        setScheduleModalResult(result);
      } else {
        showToast(`正式學員 [${newStudentName}] 建立成功！`);
      }

      closeModal();
    }
  };

  const closeModal = () => {
    setNewStudentName('');
    setNewStudentPhone('');
    setNewStudentNote('');
    setSchedule(defaultSchedule());
    setIsSubmitting(false);
    setIsCreateModalOpen(false);
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

  return (
    <div className="space-y-4 h-full flex flex-col pb-6">
      <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xs">
        <table className="w-full text-left border-collapse text-xs relative">
          <thead className="sticky top-0 bg-slate-50 z-10">
            {/* 表頭徹底移除「類別」，僅保留 姓名、下堂課、剩餘堂數、封存開關 */}
            <tr className="text-slate-500 font-bold border-b border-slate-200 text-[11px] select-none">
              <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort('name')}>
                姓名 {sortField === 'name' ? (sortDesc ? '▼' : '▲') : ''}
              </th>
              <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort('next')}>
                下堂課 {sortField === 'next' ? (sortDesc ? '▼' : '▲') : ''}
              </th>
              <th className="py-3 px-3 text-right whitespace-nowrap">剩餘堂數</th>
              <th className="py-3 px-3 text-center whitespace-nowrap">封存</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {sortedActive.length === 0 && (
              <tr><td colSpan={4}className="text-center py-8 text-slate-400 font-sans font-bold">目前無學員資料</td></tr>
            )}
            {sortedActive.map((s: any) => {
              const next = s.stats.nextLesson;

              return (
                <tr key={s.id} onClick={() => onSelectStudent(s.id)} className="hover:bg-rose-50/50 transition cursor-pointer">
                  <td className="py-3.5 px-3 font-sans font-bold text-slate-800">
                    <div className="flex flex-col gap-0.5 items-start">
                      <div className="flex items-center gap-1.5">
                        <span>{s.name}</span>
                        {/* 逾期未簽紅點提示（優雅微型呼吸點，不破壞版面） */}
                        {s.stats.overdueCount > 0 && (
                          <span className="relative flex h-2 w-2" title="有逾期未簽到 / 待結算課堂">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-2xs"></span>
                          </span>
                        )}
                      </div>
                      {s.isTrial && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-bold">🌱 體驗客</span>}
                    </div>
                  </td>
                  <td className="py-3.5 px-3 font-sans font-bold text-slate-800">
                    <div className="flex flex-col gap-0.5">
                      <span>{next ? `${formatDateWithDay(next.date)} ${formatTimeStr(next.startHour, next.startMin)}` : '未排定'}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{formatStudentSchedule(s)}</span>
                    </div>
                  </td>
                  <td className={`py-3.5 px-3 text-right font-black ${s.credits <= 5 ? 'text-rose-600 bg-rose-50/60' : 'text-slate-800'}`}>
                    {s.credits}
                  </td>
                  {/* 整格攔截點擊，避免誤觸開關周圍時進入詳情頁 */}
                  <td className="py-3.5 px-3 text-center cursor-default" onClick={e => e.stopPropagation()}>
                    <ArchiveToggle archived={false} name={s.name} onToggle={() => handleToggleArchive(s)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 已封存學員名單 */}
      <div className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-2xs px-3 py-2">
        <button
          type="button"
          onClick={() => setArchivedOpen(!archivedOpen)}
          aria-expanded={archivedOpen}
          className="w-full flex justify-between items-center text-[11px] font-bold text-slate-400 py-1 hover:text-slate-600 transition"
        >
          <span>📥 已封存學員（{archivedStudents.length} 位）</span>
          {archivedOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {archivedOpen && (
          <div className="space-y-2 text-xs pt-2 pb-1 max-h-[35vh] overflow-y-auto">
            {archivedStudents.length === 0 && <p className="text-center py-2 text-slate-300 font-bold">目前沒有已封存學員</p>}
            {archivedStudents.map((s: any) => (
              <div key={s.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center gap-2 shadow-2xs">
                <button type="button" onClick={() => onSelectStudent(s.id)} className="font-bold text-slate-500 hover:underline text-left">
                  {s.name}
                  <span className="ml-2 text-[10px] text-slate-400 font-mono">剩餘 {s.credits} 堂</span>
                </button>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-bold">已封存</span>
                  <ArchiveToggle archived name={s.name} onToggle={() => handleToggleArchive(s)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新增學員彈窗 (體驗課衝堂檢測 / 正式學員各時段獨立類別) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95 max-h-[92vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5 shrink-0">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-rose-500" /> 新增學員
              </h3>
              <button onClick={closeModal} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 模式切換鈕 */}
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600 shrink-0">
              <button
                type="button"
                onClick={() => setCreateMode('trial')}
                className={`flex-1 py-1.5 rounded-lg transition ${createMode === 'trial' ? 'bg-white text-rose-600 font-black shadow-xs' : ''}`}
              >
                🌱 體驗課學員
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('regular')}
                className={`flex-1 py-1.5 rounded-lg transition ${createMode === 'regular' ? 'bg-white text-rose-600 font-black shadow-xs' : ''}`}
              >
                ⭐ 正式學員
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <div className="space-y-2">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">學員姓名 *</label>
                  <input
                    type="text"
                    value={newStudentName}
                    onChange={e => setNewStudentName(e.target.value)}
                    placeholder="例如：林小美"
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">聯絡電話</label>
                  <input
                    type="text"
                    value={newStudentPhone}
                    onChange={e => setNewStudentPhone(e.target.value)}
                    placeholder="例如：0912-345-678"
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">身體狀況 / 備註</label>
                  <input
                    type="text"
                    value={newStudentNote}
                    onChange={e => setNewStudentNote(e.target.value)}
                    placeholder="例如：腰椎曾開刀、產後修復中"
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 outline-none focus:ring-1 focus:ring-rose-400"
                  />
                </div>
              </div>

              {/* 模式 A: 體驗課專屬設定 (具備即時衝堂阻擋) */}
              {createMode === 'trial' && (
                <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-2.5">
                  <span className="font-black text-emerald-800 text-[11px] block">體驗時段設定 (自動排入 1 堂課)</span>
                  
                  {/* 第一行：預約日期 */}
                  <div>
                    <label className="font-bold text-slate-600 text-[10px]">預約日期</label>
                    <input
                      type="date"
                      value={trialDate}
                      onChange={e => setTrialDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                    />
                  </div>

                  {/* 第二行：時和分 (以 10 分鐘為單位) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-bold text-slate-600 text-[10px]">時 (Hour)</label>
                      <select
                        value={trialHour}
                        onChange={e => setTrialHour(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                      >
                        {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h < 10 ? `0${h}` : h}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 text-[10px]">分 (10 分鐘為單位)</label>
                      <select
                        value={trialMin}
                        onChange={e => setTrialMin(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                      >
                        {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* 第三行：教室選擇 (帶圓點色彩提示) 與 課程種類 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-bold text-slate-600 text-[10px]">教室選擇</label>
                      <select
                        value={trialRoom}
                        onChange={(e: any) => setTrialRoom(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                      >
                        <option value="small">🟢 小教室</option>
                        <option value="large">🟣 大教室</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-slate-600 text-[10px]">課程種類</label>
                      <select
                        value={trialLessonType}
                        onChange={(e: any) => setTrialLessonType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                      >
                        <option value="1v1">1v1 單人</option>
                        <option value="1v2">1v2 雙人</option>
                      </select>
                    </div>
                  </div>

                  <BookingCheckCard result={trialCheck} userRole={userRole} teachers={teachers} />
                </div>
              )}

              {/* 模式 B: 正式學員多時段排課規則 (各時段獨立種類 1v1 / 1v2) */}
              {createMode === 'regular' && (
                <div className="space-y-3 border-t border-slate-100 pt-2.5">
                  <div>
                    <label className="font-bold text-slate-600 block mb-1">初始購買堂數</label>
                    <input
                      type="number"
                      value={newInitialCredits}
                      onChange={e => setNewInitialCredits(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono"
                    />
                  </div>

                  <ScheduleRulesEditor value={schedule} onChange={setSchedule} today={todayStr} createRule={createRule} />
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-2 shrink-0 border-t border-slate-100">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl font-bold text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isSubmitting || trialCheck?.ok === false}
                onClick={handleSaveNewStudent}
                className={`flex-1 transition text-white py-2.5 rounded-xl font-bold shadow-xs ${
                  isSubmitting || trialCheck?.ok === false ? 'bg-slate-400 cursor-not-allowed' : 'bg-rose-500 hover:bg-rose-600'
                }`}
              >
                {isSubmitting ? '建立中...' : '建立學員'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 排課結果確認與一鍵複製 Modal */}
      {scheduleModalResult && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" /> 排課完成確認
              </h3>
              <button onClick={() => setScheduleModalResult(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-900 font-bold leading-tight">
              {scheduleModalResult.message}
            </div>

            {(scheduleModalResult.nonPriorityCount ?? 0) > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-800 font-bold leading-snug">
                ⏳ 其中 {scheduleModalResult.nonPriorityCount} 堂為{REVIEW_TAG}，需經管理員核准，核准前標示為待審核。
              </div>
            )}

            {/* 課表文字預覽區 */}
            <div className="max-h-52 overflow-y-auto p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px] whitespace-pre-wrap select-all text-slate-700">
              {scheduleModalResult.copyText}
            </div>

            <div className="pt-1 flex flex-col gap-2">
              <button
                onClick={() => handleCopyScheduleText(scheduleModalResult.copyText)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-black transition shadow-xs flex items-center justify-center gap-1.5"
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                {isCopied ? '已複製課表！' : '一鍵複製課表'}
              </button>
              <button
                onClick={() => setScheduleModalResult(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 py-2 rounded-xl font-bold transition text-[11px]"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
