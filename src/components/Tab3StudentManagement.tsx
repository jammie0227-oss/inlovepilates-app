'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Edit3, Clock, PenTool, ZoomIn, X, AlertCircle, History, CreditCard, Sparkles, UserPlus, FileText, AlertTriangle, Copy, Check } from 'lucide-react';
import { 
  formatTimeStr, 
  getExactTimestamp, 
  ScheduleEngine, 
  formatDateWithDay, 
  checkGlobalConflict, 
  ScheduleEngineResult 
} from '../mockData';

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

// 輔助函式：格式化多重規則 (包含個別時段獨立的類別標示)
const formatRules = (rules: any[]) => {
  if (!rules || rules.length === 0) return '未設定';
  if (rules.every(r => r.freq === '不固定')) return '不固定排課';
  const dayMap: Record<string, string> = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '日': '7' };
  return rules.filter(r => r.freq !== '不固定').map(r => {
    const f = r.freq === '每週' || r.freq === 'W' ? 'W' : r.freq === '隔週' ? 'EOW' : '';
    const typeLabel = r.lessonType ? `(${r.lessonType})` : '';
    return `${f}${dayMap[r.day] || r.day} ${r.time}${typeLabel}`;
  }).join(' / ');
};

// ==========================================
// 1. 第一層：學生管理清單
// ==========================================
export default function Tab3StudentManagement({ 
  currentUserId, students, setStudents, onSelectStudent, isCreateModalOpen, setIsCreateModalOpen, onAddBookings, showToast, teachers, bookings
}: any) {
  const [sortField, setSortField] = useState<'name' | 'next'>('name');
  const [sortDesc, setSortDesc] = useState(false);

  // 新增學員彈窗狀態
  const [createMode, setCreateMode] = useState<'trial' | 'regular'>('trial');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentPhone, setNewStudentPhone] = useState('');
  const [newStudentNote, setNewStudentNote] = useState('');
  const [newInitialCredits, setNewInitialCredits] = useState(10);
  
  // 體驗課專屬欄位
  const todayStr = '2026-10-24';
  const [trialDate, setTrialDate] = useState(todayStr);
  const [trialHour, setTrialHour] = useState('14');
  const [trialMin, setTrialMin] = useState('00');
  const [trialRoom, setTrialRoom] = useState<'large' | 'small'>('small');
  const [trialLessonType, setTrialLessonType] = useState<'1v1' | '1v2'>('1v1');

  // 正式學員多時段排課規則 (各時段獨立指定 1v1/1v2 類別與教室)
  const [newRules, setNewRules] = useState<any[]>([
    { id: `r-${Date.now()}`, freq: '每週', day: '一', time: '10:00', startDate: todayStr, lessonType: '1v1', roomType: 'small' }
  ]);

  // 新增完成後排課明細與一鍵複製 Modal
  const [scheduleModalResult, setScheduleModalResult] = useState<ScheduleEngineResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const minutes = ['00', '10', '20', '30', '40', '50'];

  const myStudents = useMemo(() => students.filter((s: any) => s.teacherId === currentUserId), [students, currentUserId]);

  const sortedActive = useMemo(() => {
    const list = [...myStudents.filter((s: any) => s.status === 'active')];
    list.sort((a, b) => {
      let valA = sortField === 'name' ? a.name : (a.nextLesson || '9999-12-31');
      let valB = sortField === 'name' ? b.name : (b.nextLesson || '9999-12-31');
      return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
    });
    return list;
  }, [myStudents, sortField, sortDesc]);

  const handleSort = (field: 'name' | 'next') => {
    if (sortField === field) setSortDesc(!sortDesc);
    else { setSortField(field); setSortDesc(false); }
  };

  const handleUpdateNewRule = (index: number, key: string, val: string) => {
    const updated = [...newRules];
    updated[index] = { ...updated[index], [key]: val };
    if (key === 'lessonType' && val === '1v2') {
      updated[index].roomType = 'large';
    }
    setNewRules(updated);
  };

  const handleUpdateNewTime = (index: number, type: 'h' | 'm', val: string) => {
    const updated = [...newRules];
    const [h, m] = (updated[index].time || '10:00').split(':');
    if (type === 'h') updated[index].time = `${val}:${m}`;
    if (type === 'm') updated[index].time = `${h}:${val}`;
    setNewRules(updated);
  };

  // 儲存新增學員
  const handleSaveNewStudent = () => {
    if (!newStudentName.trim()) return alert('請輸入學員姓名');

    const newId = `s-${Date.now()}`;
    const studentsMap = Object.fromEntries(students.map((s: any) => [s.id, s]));

    if (createMode === 'trial') {
      // 1. 體驗課衝堂檢測 (嚴格阻擋並具體提示衝突對象)
      const trialH = parseInt(trialHour, 10);
      const trialM = parseInt(trialMin, 10);

      const conflict = checkGlobalConflict({
        dateStr: trialDate,
        startHour: trialH,
        startMin: trialM,
        durationMins: 50,
        roomType: trialRoom,
        teacherId: currentUserId,
        existingBookings: bookings,
        teachersMap: teachers,
        studentsMap
      });

      if (conflict.hasConflict) {
        return alert(`體驗課衝堂警告：${conflict.reason}\n請更換時段或指定另一間教室！`);
      }

      const trialLessonTime = `${formatDateWithDay(trialDate)} ${trialHour}:${trialMin}`;
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
        status: 'active' as const,
        nextLesson: trialLessonTime,
        purchases: []
      };

      const newBooking = {
        id: `b-${Date.now()}`,
        studentId: newId,
        studentName: newStudentName,
        teacherId: currentUserId,
        date: trialDate,
        startHour: trialH,
        startMin: trialM,
        durationMins: 50,
        lessonType: trialLessonType as any,
        roomType: trialRoom,
        status: 'confirmed' as const,
        signed: false
      };

      setStudents((prev: any) => [newTrialStudent, ...prev]);
      onAddBookings([newBooking]);
      showToast(`已建立體驗學員 [${newStudentName}] 並同步排定課堂！`);
      closeModal();
    } else {
      // 2. 正式學員建立與自動排課
      const isNoRegular = newRules.every(r => r.freq === '不固定');
      const newRegularStudent = {
        id: newId,
        name: newStudentName,
        phone: newStudentPhone || '未提供',
        teacherId: currentUserId,
        note: newStudentNote,
        credits: Number(newInitialCredits) || 0,
        defaultLessonType: newRules[0]?.lessonType || '1v1',
        lessonType: newRules[0]?.lessonType || '1v1',
        isTrial: false,
        noRegularRule: isNoRegular,
        rules: newRules,
        status: 'active' as const,
        nextLesson: isNoRegular ? '不固定排課' : `週${newRules[0]?.day} ${newRules[0]?.time}`,
        purchases: []
      };

      setStudents((prev: any) => [newRegularStudent, ...prev]);

      if (!isNoRegular && newRegularStudent.credits > 0) {
        const engine = new ScheduleEngine(bookings, teachers, studentsMap);
        const result = engine.generateSchedule({
          sid: newId,
          sName: newStudentName,
          teacherId: currentUserId,
          credits: newRegularStudent.credits,
          slots: newRules,
          startFromDate: todayStr
        });

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
            {/* 表頭徹底移除「類別」，僅保留 姓名、下堂課、剩餘堂數 */}
            <tr className="text-slate-500 font-bold border-b border-slate-200 text-[11px] select-none">
              <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort('name')}>
                姓名 {sortField === 'name' ? (sortDesc ? '▼' : '▲') : ''}
              </th>
              <th className="py-3 px-3 cursor-pointer hover:bg-slate-100 transition" onClick={() => handleSort('next')}>
                下堂課 {sortField === 'next' ? (sortDesc ? '▼' : '▲') : ''}
              </th>
              <th className="py-3 px-3 text-right">剩餘堂數</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {sortedActive.length === 0 && (
              <tr><td colSpan={3} className="text-center py-8 text-slate-400 font-sans font-bold">目前無學員資料</td></tr>
            )}
            {sortedActive.map((s: any) => (
              <tr key={s.id} onClick={() => onSelectStudent(s.id)} className="hover:bg-rose-50/50 transition cursor-pointer">
                <td className="py-3.5 px-3 font-sans font-bold text-slate-800">
                  <div className="flex flex-col gap-0.5 items-start">
                    <span>{s.name}</span>
                    {s.isTrial && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.2 rounded font-bold">🌱 體驗客</span>}
                  </div>
                </td>
                <td className="py-3.5 px-3 font-sans font-bold text-slate-800">
                  <div className="flex flex-col gap-0.5">
                    <span>{s.nextLesson || '未排定'}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{formatRules(s.rules)}</span>
                  </div>
                </td>
                {/* 堂數內容純寫數字，不寫「4堂」 */}
                <td className={`py-3.5 px-3 text-right font-black ${s.credits <= 5 ? 'text-rose-600 bg-rose-50/60' : 'text-slate-800'}`}>
                  {s.credits}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
                        {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
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

                  <div className="space-y-2">
                    <label className="font-bold text-slate-700 block">排課時段規則列表</label>
                    {newRules.map((r, index) => {
                      const [hStr, mStr] = (r.time || '10:00').split(':');
                      return (
                        <div key={index} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 relative shadow-2xs">
                          {newRules.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setNewRules(newRules.filter((_, i) => i !== index))}
                              className="absolute top-2 right-2 p-1 bg-white border border-slate-200 rounded text-slate-400 hover:text-rose-500 transition"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                          
                          {/* 第一行：頻率、種類、教室 */}
                          <div className="grid grid-cols-3 gap-1.5">
                            <div>
                              <label className="font-bold text-slate-600 text-[10px]">頻率</label>
                              <select
                                value={r.freq}
                                onChange={e => handleUpdateNewRule(index, 'freq', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                              >
                                <option value="每週">每週</option>
                                <option value="隔週">隔週</option>
                                <option value="不固定">不固定 (不自動排)</option>
                              </select>
                            </div>
                            <div>
                              <label className="font-bold text-slate-600 text-[10px]">課程種類</label>
                              <select
                                value={r.lessonType || '1v1'}
                                onChange={e => handleUpdateNewRule(index, 'lessonType', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                              >
                                <option value="1v1">1v1 單人</option>
                                <option value="1v2">1v2 雙人</option>
                              </select>
                            </div>
                            <div>
                              <label className="font-bold text-slate-600 text-[10px]">指定教室</label>
                              <select
                                value={r.roomType || 'small'}
                                onChange={e => handleUpdateNewRule(index, 'roomType', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                              >
                                <option value="small">🟢 小</option>
                                <option value="large">🟣 大</option>
                              </select>
                            </div>
                          </div>

                          {/* 第二行：星期、時、分、起始日 */}
                          {r.freq !== '不固定' && (
                            <>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="font-bold text-slate-600 text-[10px]">星期</label>
                                  <select
                                    value={r.day}
                                    onChange={e => handleUpdateNewRule(index, 'day', e.target.value)}
                                    className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                                  >
                                    {['一', '二', '三', '四', '五', '六', '日'].map(d => <option key={d} value={d}>週{d}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="font-bold text-slate-600 text-[10px]">時</label>
                                  <select
                                    value={hStr}
                                    onChange={e => handleUpdateNewTime(index, 'h', e.target.value)}
                                    className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                                  >
                                    {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="font-bold text-slate-600 text-[10px]">分</label>
                                  <select
                                    value={mStr}
                                    onChange={e => handleUpdateNewTime(index, 'm', e.target.value)}
                                    className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                                  >
                                    {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="font-bold text-slate-600 text-[10px]">起始排課日</label>
                                <input
                                  type="date"
                                  value={r.startDate || todayStr}
                                  onChange={e => handleUpdateNewRule(index, 'startDate', e.target.value)}
                                  className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => setNewRules([...newRules, { id: `r-${Date.now()}`, freq: '每週', day: '一', time: '10:00', startDate: todayStr, lessonType: '1v1', roomType: 'small' }])}
                      className="w-full border border-dashed border-slate-300 text-slate-500 font-bold py-2 rounded-xl hover:bg-slate-50 transition flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> 新增時段
                    </button>
                  </div>
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
                onClick={handleSaveNewStudent}
                className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs"
              >
                建立學員
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 排課結果確認與一鍵複製 Modal */}
      {scheduleModalResult && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
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

// ==========================================
// 2. 第二層：學員詳細內頁
// ==========================================
export function StudentDetailView({ 
  student, onBack, bookings, onUpdateStudent, onSign, onUpdateBookingNote, onAddBookings, onExecuteReschedule, showToast, addLog, currentUserId, teachers, userRole,
  externalBuyModalOpen, setExternalBuyModalOpen
}: any) {
  const [expandHistory, setExpandHistory] = useState(false);
  const [expandUpcoming, setExpandUpcoming] = useState(false);
  
  const [signModalId, setSignModalId] = useState<{ id: string; studentName: string } | null>(null);
  
  // 變更預約狀態 (三行新排版)
  const [editingBooking, setEditingBooking] = useState<any>(null);
  const [editDate, setEditDate] = useState('2026-10-24');
  const [editHour, setEditHour] = useState('10');
  const [editMin, setEditMin] = useState('00');
  const [editRoom, setEditRoom] = useState<'large' | 'small'>('small');
  const [editLessonType, setEditLessonType] = useState<'1v1' | '1v2'>('1v1');

  // 預排課程卡片右上角「+」臨時排課彈窗狀態
  const [isQuickBookModalOpen, setIsQuickBookModalOpen] = useState(false);
  const initialPreset = getStudentBookingPreset(student, userRole);
  const [quickBookForm, setQuickBookForm] = useState({
    date: '2026-10-24',
    hour: '14',
    minute: '00',
    roomType: initialPreset.roomType,
    lessonType: initialPreset.lessonType
  });

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
  const [isEditingRuleModal, setIsEditingRuleModal] = useState(false);
  const [tempRules, setTempRules] = useState<any[]>([]);
  
  // 自動排課確認與一鍵複製彈窗
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);
  const [scheduleResultModal, setScheduleResultModal] = useState<ScheduleEngineResult | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  
  const [zoomedSignature, setZoomedSignature] = useState<{ url: string, time: string } | null>(null);
  
  const studentBookings = bookings.filter((b: any) => b.studentId === student.id || b.studentName === student.name);
  
  const upcomingAndScheduled = studentBookings.filter((b: any) => b.status === 'confirmed' && (b.date >= '2026-10-24' && !b.signed)).sort((a: any, b: any) => a.date.localeCompare(b.date));
  const historyLessons = studentBookings.filter((b: any) => b.status === 'confirmed' && (b.date < '2026-10-24' || b.signed)).sort((a: any, b: any) => a.date.localeCompare(b.date));
  const overdueBookings = studentBookings.filter((b: any) => b.status === 'confirmed' && b.date < '2026-10-24' && !b.signed);
  const purchases = [...(student.purchases || [])].sort((a: any, b: any) => b.date.localeCompare(a.date));

  // 堂數透支檢核：預排堂數超過剩餘堂數
  const isCreditsOverdrawn = upcomingAndScheduled.length > student.credits;
  const overdrawnCount = upcomingAndScheduled.length - student.credits;

  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const minutes = ['00', '10', '20', '30', '40', '50'];
  const todayStr = '2026-10-24';
  const isAnyRulePast = student.rules?.some((r: any) => r.startDate <= todayStr && r.freq !== '不固定');

  // 判斷原預約變更時間是否小於 24 小時
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
      editDate === originalDate &&
      parseInt(editHour, 10) === originalH &&
      editMin === originalM &&
      editRoom === originalRoom &&
      editLessonType === originalType
    );
  }, [editingBooking, editDate, editHour, editMin, editRoom, editLessonType]);

  const handleOpenRuleModal = () => {
    const preset = getStudentBookingPreset(student, userRole);
    setTempRules(
      student.rules?.length > 0 
        ? [...student.rules] 
        : [{ id: `r-${Date.now()}`, freq: '每週', day: '一', time: '10:00', startDate: todayStr, lessonType: preset.lessonType, roomType: preset.roomType }]
    );
    setIsEditingRuleModal(true);
  };

  const handleUpdateTempRule = (index: number, key: string, val: string) => {
    const newRules = [...tempRules];
    newRules[index] = { ...newRules[index], [key]: val };
    if (key === 'lessonType' && val === '1v2') {
      newRules[index].roomType = 'large';
    }
    setTempRules(newRules);
  };

  const handleUpdateTempTime = (index: number, type: 'h' | 'm', val: string) => {
    const newRules = [...tempRules];
    const [h, m] = (newRules[index].time || '10:00').split(':');
    if (type === 'h') newRules[index].time = `${val}:${m}`;
    if (type === 'm') newRules[index].time = `${h}:${val}`;
    setTempRules(newRules);
  };

  const handleSaveRules = () => {
    onUpdateStudent({ 
      ...student, 
      rules: tempRules,
      defaultLessonType: tempRules[0]?.lessonType || student.defaultLessonType || '1v1',
      noRegularRule: tempRules.every(r => r.freq === '不固定')
    });
    setIsEditingRuleModal(false);
    showToast('排課時段規則已更新儲存');
  };

  // 執行臨時預約排課
  const handleSubmitQuickBook = () => {
    const h = parseInt(quickBookForm.hour, 10);
    const m = parseInt(quickBookForm.minute, 10);

    const conflict = checkGlobalConflict({
      dateStr: quickBookForm.date,
      startHour: h,
      startMin: m,
      durationMins: 50,
      roomType: quickBookForm.roomType,
      teacherId: currentUserId,
      studentId: student.id,
      existingBookings: bookings,
      teachersMap: teachers,
      studentsMap: Object.fromEntries([[student.id, student]])
    });

    if (conflict.hasConflict) {
      return alert(`衝堂警告：${conflict.reason}`);
    }

    const newBk = {
      id: `b-${Date.now()}`,
      date: quickBookForm.date,
      startHour: h,
      startMin: m,
      durationMins: 50,
      teacherId: currentUserId,
      studentName: student.name,
      studentId: student.id,
      roomType: quickBookForm.roomType as any,
      lessonType: quickBookForm.lessonType as any,
      status: 'confirmed' as const,
      signed: false
    };

    onAddBookings([newBk]);
    addLog(
      `新增預約：[${student.name}] ${formatDateWithDay(quickBookForm.date)} ${formatTimeStr(h, m)} ${quickBookForm.roomType === 'large' ? '大教室' : '小教室'} (${quickBookForm.lessonType}) · 老師：${teachers[currentUserId]?.name || 'Daisy'}`,
      '預約',
      'normal',
      student.name,
      currentUserId,
      undefined,
      `預約  ${teachers[currentUserId]?.name || 'Daisy'}  ${student.name}  ${getExactTimestamp().slice(5, 16)}`
    );

    setIsQuickBookModalOpen(false);
    showToast(`已成功為 [${student.name}] 建立預約！`);
  };

  // 續課簽署確認
  const handleConfirmPurchase = (studentSignUrl: string) => {
    const newPurchase = {
      id: `p-${Date.now()}`,
      date: todayStr,
      credits: Number(buyCredits),
      price: Number(buyPrice),
      teacherName: teachers[currentUserId]?.name || 'Daisy',
      studentName: student.name,
      studentSign: studentSignUrl,
      signedAt: getExactTimestamp()
    };

    const updatedCredits = student.credits + Number(buyCredits);
    onUpdateStudent({
      ...student,
      credits: updatedCredits,
      purchases: [newPurchase, ...(student.purchases || [])]
    });

    addLog(
      `購課簽約：[${student.name}] 購買 ${buyCredits} 堂 (NT$ ${buyPrice.toLocaleString()}) · 堂數由 ${student.credits} 堂 ➔ 增為 ${updatedCredits} 堂 · 承辦：${teachers[currentUserId]?.name || 'Daisy'}`, 
      '購課', 
      'normal', 
      student.name,
      currentUserId,
      undefined,
      `購課  ${teachers[currentUserId]?.name || 'Daisy'}  ${student.name}  ${getExactTimestamp().slice(5, 16)}`
    );
    closeBuyModal();
    showToast(`續課成功！已增加 ${buyCredits} 堂，目前剩餘 ${updatedCredits} 堂`);
  };

  // 執行自動排課 (指定日期之後全部重排，嚴格不超額)
  const handleRunAutoSchedule = (startFromToday: boolean) => {
    if (student.credits <= 0) return alert('學員剩餘堂數不足，請先購買續課');
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
      maxWeeksLimit: 12
    });

    if (result.success) {
      // 覆寫更新課表：移除舊的未來未簽到預排，換上新生成的預排
      const cleanBookings = bookings.filter((b: any) => !result.removedBookingIds.includes(b.id));
      onAddBookings(result.newRecords, cleanBookings);
      setAutoScheduleOpen(false);
      setScheduleResultModal(result);
    } else {
      alert(result.message || '無符合規則之課堂可排入');
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

  const openRescheduleModal = (b: any) => {
    setEditingBooking(b);
    setEditDate(b.date);
    setEditHour(String(b.startHour));
    setEditMin(b.startMin < 10 ? `0${b.startMin}` : String(b.startMin));
    setEditRoom(b.roomType || 'small');
    setEditLessonType(b.lessonType || '1v1');
  };

  const handleConfirmReschedule = (isCancel: boolean) => {
    if (!editingBooking) return;
    if (!isCancel && isRescheduleUnchanged) return;

    onExecuteReschedule(
      editingBooking.id,
      editDate,
      parseInt(editHour, 10),
      parseInt(editMin, 10),
      editRoom,
      isCancel,
      editLessonType
    );
    setEditingBooking(null);
  };

  return (
    <div className="space-y-3.5 animate-in fade-in slide-in-from-right-4 duration-200 pb-20">
      
      {/* 頂部排課規則與筆記卡片 */}
      <div className="bg-white p-3.5 rounded-3xl border border-slate-200 shadow-2xs space-y-2.5">
        <div className="flex justify-between items-center font-bold text-slate-600 text-xs">
          <span className="font-mono text-[11px] bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl shadow-2xs">
            {formatRules(student.rules)}
          </span>
          <div className="flex items-center gap-1.5">
            <button 
              onClick={handleOpenRuleModal} 
              className="p-1 hover:bg-rose-50 rounded-lg text-rose-500 transition shadow-2xs border border-slate-100"
              title="編輯排課規則"
            >
              <Edit3 className="w-3.5 h-3.5"/>
            </button>
            <button 
              onClick={() => setAutoScheduleOpen(true)} 
              className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1 border border-indigo-100 hover:bg-indigo-100 transition shadow-2xs"
            >
              <Sparkles className="w-3 h-3"/> 自動排課
            </button>
          </div>
        </div>
        
        {/* 筆記備註框 */}
        <div className="relative pt-0.5">
          <input
            type="text"
            defaultValue={student.note || ''}
            placeholder="輸入學員身體狀況備註 (點擊外側自動儲存)..."
            onBlur={e => onUpdateStudent({ ...student, note: e.target.value })}
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
            堂數衝突提醒：目前已預排 {upcomingAndScheduled.length} 堂，剩餘 {student.credits} 堂（透支 {overdrawnCount} 堂），請點擊「自動排課」重排以符合剩餘額度！
          </span>
        </div>
      )}

      {/* 逾期未簽到提醒 */}
      {overdueBookings.length > 0 && (
        <div className="bg-amber-50 p-3.5 rounded-3xl border border-amber-300 shadow-2xs space-y-2">
          <div className="flex items-center gap-1.5 text-amber-900 font-black text-xs">
            <AlertCircle className="w-4 h-4 text-amber-600" /> ⏰ 逾期未簽到提醒 ({overdueBookings.length} 堂)
          </div>
          <div className="space-y-1.5">
            {overdueBookings.map((b: any) => (
              <div key={b.id} className="p-2.5 bg-white rounded-xl border border-amber-200 flex justify-between items-center text-xs shadow-2xs">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${b.roomType === 'large' ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                  <span className="text-slate-700 font-mono font-bold">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openRescheduleModal(b)} className="text-[11px] bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg font-bold transition">變更</button>
                  <button onClick={() => setSignModalId({ id: b.id, studentName: student.name })} className="text-[11px] bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg font-bold transition shadow-xs">簽名</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 預排課程 (卡片右上角新增「+」臨時排課按鈕) */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="font-black text-slate-800 flex items-center gap-1.5 text-sm">
            <Clock className="w-4 h-4 text-sky-600" /> 預排課程
          </h3>
          <button 
            onClick={() => {
              const preset = getStudentBookingPreset(student, userRole);
              setQuickBookForm({
                date: '2026-10-24',
                hour: '14',
                minute: '00',
                roomType: preset.roomType,
                lessonType: preset.lessonType
              });
              setIsQuickBookModalOpen(true);
            }}
            className="w-7 h-7 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl text-rose-600 flex items-center justify-center font-bold transition shadow-2xs active:scale-95"
            title="臨時預約排課"
          >
            <Plus className="w-4 h-4" />
          </button>
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
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => openRescheduleModal(b)} className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold border border-slate-200 bg-white hover:bg-slate-50 transition">變更</button>
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
                {/* 簽名縮圖 */}
                {b.signatureData?.startsWith('data:image') ? (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomedSignature({ url: b.signatureData!, time: b.signedAt || '' });
                    }}
                    className="border border-emerald-300 rounded p-0.5 bg-white cursor-pointer hover:bg-emerald-50 transition shadow-2xs"
                    title="點擊放大簽名"
                  >
                    <img src={b.signatureData} alt="簽名" className="h-4 w-10 object-contain" />
                  </div>
                ) : (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full shadow-2xs">✓ 已簽名</span>
                )}
              </div>
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

      {/* ========================================================
          臨時新增預約 Modal (標準三行規格，學員鎖定當前學員)
      ======================================================== */}
      {isQuickBookModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-rose-500" /> 新增預約 ({student.name})
              </h3>
              <button onClick={() => setIsQuickBookModalOpen(false)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {/* 學員資訊 (純顯示) */}
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center">
                <span className="font-bold text-slate-700">學員：{student.name}</span>
                <span className="font-mono text-rose-600 font-bold">剩餘 {student.credits} 堂</span>
              </div>

              {/* 第一行：預約日期 */}
              <div>
                <label className="text-slate-600 font-bold block mb-1">預約日期</label>
                <input 
                  type="date" 
                  value={quickBookForm.date} 
                  onChange={(e) => setQuickBookForm({ ...quickBookForm, date: e.target.value })} 
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800" 
                />
              </div>

              {/* 第二行：時和分 (以 10 分鐘為一單位) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 font-bold block mb-1">時 (Hour)</label>
                  <select 
                    value={quickBookForm.hour} 
                    onChange={(e) => setQuickBookForm({ ...quickBookForm, hour: e.target.value })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                  >
                    {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 font-bold block mb-1">分 (10 分鐘為單位)</label>
                  <select 
                    value={quickBookForm.minute} 
                    onChange={(e) => setQuickBookForm({ ...quickBookForm, minute: e.target.value })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                  >
                    {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* 第三行：教室選擇 (帶圓點色標) 與 課程種類 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 font-bold block mb-1">教室選擇</label>
                  <select 
                    value={quickBookForm.roomType} 
                    onChange={(e) => setQuickBookForm({ ...quickBookForm, roomType: e.target.value as any })} 
                    className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                  >
                    <option value="large">🟣 大教室</option>
                    <option value="small">🟢 小教室</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 font-bold block mb-1">課程種類</label>
                  <select 
                    value={quickBookForm.lessonType} 
                    onChange={(e) => setQuickBookForm({ ...quickBookForm, lessonType: e.target.value as any })} 
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
                onClick={() => setIsQuickBookModalOpen(false)} 
                className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl font-bold text-slate-600"
              >
                取消
              </button>
              <button 
                onClick={handleSubmitQuickBook} 
                className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs"
              >
                確認預約
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          變更預約 Modal (三行緊湊規格 + 前後無差異灰階禁用防呆)
      ======================================================== */}
      {editingBooking && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 animate-in zoom-in-95 border border-slate-100 text-xs">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800">變更 / 取消預約 ({student.name})</h3>
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
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                />
              </div>

              {/* 第二行：時和分 (以 10 分鐘為單位) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">時 (Hour)</label>
                  <select
                    value={editHour}
                    onChange={e => setEditHour(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                  >
                    {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">分 (10 分鐘為單位)</label>
                  <select
                    value={editMin}
                    onChange={e => setEditMin(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 font-mono text-slate-800"
                  >
                    {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* 第三行：教室選擇與類別 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-600 block mb-1">教室選擇</label>
                  <select
                    value={editRoom}
                    onChange={(e: any) => setEditRoom(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                  >
                    <option value="large">🟣 大教室</option>
                    <option value="small">🟢 小教室</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-600 block mb-1">課程類別</label>
                  <select
                    value={editLessonType}
                    onChange={(e: any) => setEditLessonType(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 text-slate-800"
                  >
                    <option value="1v1">1v1 單人</option>
                    <option value="1v2">1v2 雙人</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 若異動小於 24 小時且為一般老師，醒目註明 */}
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

      {/* 購課簽約彈窗 (含自動計算單堂價格) */}
      {isBuyOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95">
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
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
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
                <span className="font-bold text-slate-800">{selectedContract.signedAt || `${selectedContract.date} 14:00:00`}</span>
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
      {isEditingRuleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-2 shrink-0">
              <h3 className="text-sm font-black text-slate-800">排課時段規則</h3>
              <button onClick={() => setIsEditingRuleModal(false)} className="p-1 hover:bg-slate-100 rounded-lg transition"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <div className="space-y-3">
                <label className="font-bold text-slate-800 block">排課時段列表</label>
                {tempRules.length === 0 && <p className="text-slate-400 text-center py-2">目前無排課規則</p>}
                
                {tempRules.map((r, index) => {
                  const [hStr, mStr] = (r.time || '10:00').split(':');
                  return (
                    <div key={index} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 relative shadow-2xs">
                      {tempRules.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setTempRules(tempRules.filter((_, i) => i !== index))}
                          className="absolute top-2 right-2 p-1 bg-white border border-slate-200 rounded text-slate-400 hover:text-rose-500 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      
                      {/* 第一行：頻率、種類、教室 */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <div>
                          <label className="font-bold text-slate-600 text-[10px]">頻率</label>
                          <select
                            value={r.freq}
                            onChange={(e) => handleUpdateTempRule(index, 'freq', e.target.value)}
                            className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                          >
                            <option value="每週">每週</option>
                            <option value="隔週">隔週</option>
                            <option value="不固定">不固定 (不自動排)</option>
                          </select>
                        </div>
                        <div>
                          <label className="font-bold text-slate-600 text-[10px]">課程種類</label>
                          <select
                            value={r.lessonType || '1v1'}
                            onChange={e => handleUpdateTempRule(index, 'lessonType', e.target.value)}
                            className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                          >
                            <option value="1v1">1v1 單人</option>
                            <option value="1v2">1v2 雙人</option>
                          </select>
                        </div>
                        <div>
                          <label className="font-bold text-slate-600 text-[10px]">指定教室</label>
                          <select
                            value={r.roomType || 'small'}
                            onChange={e => handleUpdateTempRule(index, 'roomType', e.target.value)}
                            className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                          >
                            <option value="small">🟢 小</option>
                            <option value="large">🟣 大</option>
                          </select>
                        </div>
                      </div>
                      
                      {/* 第二行：星期、時、分、起始日 */}
                      {r.freq !== '不固定' && (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="font-bold text-slate-600 text-[10px]">星期</label>
                              <select
                                value={r.day}
                                onChange={(e) => handleUpdateTempRule(index, 'day', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none"
                              >
                                {['一', '二', '三', '四', '五', '六', '日'].map(d => <option key={d} value={d}>週{d}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="font-bold text-slate-600 text-[10px]">時</label>
                              <select
                                value={hStr}
                                onChange={(e) => handleUpdateTempTime(index, 'h', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                              >
                                {hours.map(h => <option key={h} value={h < 10 ? `0${h}` : String(h)}>{h}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="font-bold text-slate-600 text-[10px]">分</label>
                              <select
                                value={mStr}
                                onChange={(e) => handleUpdateTempTime(index, 'm', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                              >
                                {minutes.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="font-bold text-slate-600 text-[10px]">起始排課日</label>
                            <input
                              type="date"
                              value={r.startDate || todayStr}
                              onChange={(e) => handleUpdateTempRule(index, 'startDate', e.target.value)}
                              className="w-full border border-slate-200 rounded-lg p-1.5 bg-white font-bold outline-none font-mono"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const preset = getStudentBookingPreset(student, userRole);
                    setTempRules([...tempRules, { id: `r-${Date.now()}`, freq: '每週', day: '一', time: '10:00', startDate: todayStr, lessonType: preset.lessonType, roomType: preset.roomType }]);
                  }}
                  className="w-full border border-dashed border-slate-300 text-slate-500 font-bold py-2 rounded-xl hover:bg-slate-50 transition flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> 新增時段
                </button>
              </div>
            </div>
            
            <div className="pt-2 flex gap-2 shrink-0 border-t border-slate-100">
              <button onClick={() => setIsEditingRuleModal(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl font-bold text-slate-600">取消</button>
              <button onClick={handleSaveRules} className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs">儲存設定</button>
            </div>
          </div>
        </div>
      )}

      {/* 自動排課確認 Modal */}
      {autoScheduleOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-indigo-600" /> 自動排課</h3>
              <button onClick={() => setAutoScheduleOpen(false)} className="p-1 hover:bg-slate-100 rounded-lg transition"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                依據學員剩餘 <span className="font-black text-rose-600">{student.credits}</span> 堂額度進行預排（將自動重排基準日後未簽到課程，防止超額）：
              </p>
              <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-900 font-mono space-y-1.5 border border-indigo-100 shadow-2xs">
                <p className="font-bold">規則：{formatRules(student.rules)}</p>
              </div>
              {isAnyRulePast && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 font-bold shadow-2xs">
                  ⚠️ 系統偵測到部分規則「起始日」早於或等於今日。請問要強制從今日起算重排，還是保留原設定？
                </div>
              )}
            </div>
            <div className="pt-2 flex flex-col gap-2">
              {isAnyRulePast ? (
                <>
                  <button onClick={() => handleRunAutoSchedule(true)} className="w-full bg-indigo-600 hover:bg-indigo-700 transition text-white py-2.5 rounded-xl text-xs font-black shadow-xs">強制從今日起排</button>
                  <button onClick={() => handleRunAutoSchedule(false)} className="w-full bg-slate-800 hover:bg-slate-700 transition text-white py-2.5 rounded-xl text-xs font-black shadow-xs">照原設定日排</button>
                  <button onClick={() => setAutoScheduleOpen(false)} className="w-full bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl text-xs font-bold text-slate-600 mt-1">取消排課</button>
                </>
              ) : (
                <div className="flex gap-2 w-full">
                  <button onClick={() => setAutoScheduleOpen(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl text-xs font-bold text-slate-600">取消</button>
                  <button onClick={() => handleRunAutoSchedule(false)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 transition text-white py-2.5 rounded-xl text-xs font-black shadow-xs">執行排課</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 排課結果確認與一鍵複製 Modal */}
      {scheduleResultModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs animate-in zoom-in-95">
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

      {/* 手動確認手寫簽名 Modal */}
      {signModalId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-1.5"><PenTool className="w-4 h-4 text-rose-500" /> 手寫簽名 ({signModalId.studentName})</h3>
              <button onClick={() => setSignModalId(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400"><X className="w-4 h-4"/></button>
            </div>
            <CanvasPad 
              onCancel={() => setSignModalId(null)} 
              onConfirm={(url) => { onSign(signModalId.id, url, getExactTimestamp()); setSignModalId(null); }} 
            />
          </div>
        </div>
      )}

      {/* 放大檢視簽名憑證 Modal */}
      {zoomedSignature && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={() => setZoomedSignature(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl text-center border animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <h3 className="text-xs font-black text-slate-800 mb-3">簽名存根檢視</h3>
            <div className="p-2 bg-slate-50 rounded-2xl border border-slate-200">
              <img src={zoomedSignature.url} alt="憑證" className="w-full h-32 object-contain bg-white rounded-xl shadow-2xs" />
            </div>
            <p className="text-[10px] font-mono text-slate-500 font-bold mt-2">簽署時間：{zoomedSignature.time}</p>
            <button className="w-full bg-slate-800 hover:bg-slate-700 transition text-white py-2 rounded-xl text-xs font-bold mt-4 shadow-xs" onClick={() => setZoomedSignature(null)}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}