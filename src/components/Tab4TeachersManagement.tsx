'use client';
import { genId } from '../utils/id';
import React, { useState, useMemo } from 'react';
import { Users, FileSpreadsheet, ChevronDown, ChevronUp, Mail, ArrowLeft, Edit3, X, UserPlus, Check, Lock } from 'lucide-react';
import { BookingStatusBadge } from './SignatureModals';
import { PRESET_COLORS, formatTimeStr, formatDateWithDay } from '../mockData';
import { deriveMonthKeys, deriveTeacherMonthKeys, formatMonthKey, calculateTeacherMonthlyStats, sumTeacherMonthStats, filterMonthBookings, monthKeyOf, compareByStart, REVIEW_TAG } from '../utils/bookingRules';
import type { TeacherMonthStats } from '../utils/bookingRules';
import type { TeacherProfile } from '../types';
import { systemAlert } from '../utils/systemAlert';
import { downloadCsv } from '../utils/csv';
import { buildTeacherStatsCsv } from '../utils/teacherStatsCsv';
import { useNow } from '../utils/useToday';

/** 授課統計表的數值欄（管理員老師列、一般老師月份列與合計列共用） */
const StatCells = ({ s }: { s: TeacherMonthStats }) => (
  <>
    <td className="py-2.5 px-1 text-slate-700">{s.count1v1}</td>
    <td className="py-2.5 px-1 text-slate-700">{s.count1v2}</td>
    <td className="py-2.5 px-1 font-black text-slate-900">{s.total}</td>
    <td className="py-2.5 px-1 text-slate-700">{s.unsettled}</td>
    <td className="py-2.5 px-1 text-slate-700">{s.upcoming}</td>
  </>
);

// 根據 Tab 5 的 priorityGrid 自動計算老師時段結論 (例如 W1 08:00-12:00 / W2 14:00-15:00)
export const generatePriorityConclusion = (teacherId: string, grid: Record<string, any>) => {
  if (!grid) return '無固定優先時段';
  const dayMap: Record<string, string> = { '一': 'W1', '二': 'W2', '三': 'W3', '四': 'W4', '五': 'W5', '六': 'W6', '日': 'W7' };
  const dayHours: Record<string, number[]> = {};

  Object.entries(grid).forEach(([slotKey, data]) => {
    if (data.all === teacherId || data.large === teacherId || data.small === teacherId) {
      const [d, hStr] = slotKey.split('-');
      const h = parseInt(hStr, 10);
      if (!dayHours[d]) dayHours[d] = [];
      if (!dayHours[d].includes(h)) dayHours[d].push(h);
    }
  });

  const dayOrder = ['一', '二', '三', '四', '五', '六', '日'];
  const conclusions: string[] = [];

  dayOrder.forEach(d => {
    if (dayHours[d] && dayHours[d].length > 0) {
      const sortedH = [...dayHours[d]].sort((a, b) => a - b);
      const ranges: string[] = [];
      let start = sortedH[0];
      let prev = sortedH[0];

      for (let i = 1; i < sortedH.length; i++) {
        if (sortedH[i] === prev + 1) {
          prev = sortedH[i];
        } else {
          ranges.push(`${String(start).padStart(2, '0')}:00-${String(prev + 1).padStart(2, '0')}:00`);
          start = sortedH[i];
          prev = sortedH[i];
        }
      }
      ranges.push(`${String(start).padStart(2, '0')}:00-${String(prev + 1).padStart(2, '0')}:00`);
      conclusions.push(`${dayMap[d] || d} ${ranges.join(', ')}`);
    }
  });

  return conclusions.length > 0 ? conclusions.join(' / ') : '無固定優先時段';
};

// ==========================================
// 1. 第一層：老師管理主頁 (全館統計 / 清單)
// ==========================================
export default function Tab4TeachersManagement({ 
  userRole, 
  currentUserId, 
  teachers, 
  setTeachers, 
  bookings, 
  today,
  priorityGrid,
  onSelectTeacher, 
  showToast,
  isAddTeacherOpen,
  setIsAddTeacherOpen
}: any) {
  const now = useNow();
  const isAdmin = userRole === 'admin';
  // 查詢月份選單（新到舊，一定包含當月）：管理員取全館課堂月份；一般老師取自己的全部課堂月份
  const monthKeys = useMemo(
    () => deriveMonthKeys(isAdmin ? bookings : bookings.filter((b: any) => b.teacherId === currentUserId), today),
    [bookings, today, isAdmin, currentUserId],
  );
  const currentMonthKey = monthKeys.includes(monthKeyOf(today)) ? monthKeyOf(today) : monthKeys[0];
  const [pickedMonth, setSelectedMonth] = useState<string | null>(null);
  const selectedMonth = pickedMonth && monthKeys.includes(pickedMonth) ? pickedMonth : currentMonthKey;
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [colorPickerTarget, setColorPickerTarget] = useState<string | null>(null);

  // 新增老師表單狀態
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherPhone, setNewTeacherPhone] = useState('');
  const [newTeacherColorIndex, setNewTeacherColorIndex] = useState(0);

  // 取得目前已被活躍老師使用的代表色集合 (互斥鎖定，避免撞色)
  const usedColorsSet = useMemo(() => {
    const set = new Set<string>();
    Object.values(teachers).forEach((t: any) => {
      if (t.isActive) set.add(t.color);
    });
    return set;
  }, [teachers]);

  // 明細列表：與統計表同一月份範圍（一般老師僅自己的課堂）
  const filteredBookings = filterMonthBookings(bookings, selectedMonth, isAdmin ? undefined : currentUserId)
    .sort(compareByStart);

  // 老師與管理員共用同一個堂數計算機
  const statsFor = (tId: string, monthKey: string = selectedMonth) =>
    calculateTeacherMonthlyStats(bookings, monthKey, tId, now);

  const activeTeachers = Object.values(teachers).filter((t: any) => t.isActive);
  // 一般老師：以查詢月份 M 為基準的 M-4 ～ M+1 各月統計（新到舊），合計僅加總表內月份
  const myMonthRows = isAdmin
    ? []
    : deriveTeacherMonthKeys(bookings, selectedMonth, currentUserId)
        .map(k => ({ key: k, stats: statsFor(currentUserId, k) }));
  const myTotals = sumTeacherMonthStats(myMonthRows.map(r => r.stats));
  const archivedTeachers = Object.values(teachers).filter((t: any) => !t.isActive);
  // 管理員統計表：在職老師，加上當月仍有課堂的已封存老師（堂數不可因封存而消失）
  const statTeachers = (Object.values(teachers) as TeacherProfile[]).filter(
    t => t.isActive || filterMonthBookings(bookings, selectedMonth, t.id).length > 0,
  );

  // 匯出目前查詢月份的對帳 CSV：一般老師僅自己的資料，管理員為全館
  const handleExport = () => {
    const rows = isAdmin
      ? statTeachers.map(t => ({ label: t.isActive ? t.name : `${t.name}（已封存）`, stats: statsFor(t.id) }))
      : myMonthRows.map(r => ({ label: r.key.replace('-', '/'), stats: r.stats }));
    downloadCsv(
      `授課統計對帳_${selectedMonth}.csv`,
      buildTeacherStatsCsv({ isAdmin, monthKey: selectedMonth, rows, bookings, teachers, currentUserId, now }),
    );
    showToast(`已匯出 ${formatMonthKey(selectedMonth)} 統計表 CSV`);
  };

  // 儲存新增老師
  const handleSaveTeacher = () => {
    if (!newTeacherName.trim()) return systemAlert('請輸入老師姓名');
    const selectedColor = PRESET_COLORS[newTeacherColorIndex] || PRESET_COLORS[0];
    
    if (usedColorsSet.has(selectedColor.color)) {
      return systemAlert('該代表色已被其他活躍老師使用，請挑選其他顏色以利課表辨識！');
    }

    const newId = genId('t');
    const newTeacherProfile = {
      id: newId,
      name: newTeacherName,
      email: newTeacherEmail || `${newTeacherName.toLowerCase()}@inlovepilates.com`,
      phone: newTeacherPhone || '未提供',
      color: selectedColor.color,
      bgLight: selectedColor.bgLight,
      border: selectedColor.border,
      text: selectedColor.text,
      priorityText: '',
      isActive: true
    };

    setTeachers((prev: any) => ({
      ...prev,
      [newId]: newTeacherProfile
    }));

    showToast(`成功建立老師帳號 [${newTeacherName}]！`);
    setNewTeacherName('');
    setNewTeacherEmail('');
    setNewTeacherPhone('');
    if (setIsAddTeacherOpen) setIsAddTeacherOpen(false);
  };

  return (
    <div className="space-y-4 pb-20">
      
      {/* 授課統計表 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-slate-800">
              {userRole === 'admin' ? '全館授課統計' : '個人授課統計'}
            </h2>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 font-bold outline-none focus:ring-1 focus:ring-rose-400 transition shadow-2xs"
            >
              {monthKeys.map(k => <option key={k} value={k}>{formatMonthKey(k)}</option>)}
            </select>
          </div>
          <button onClick={handleExport} className="text-xs bg-slate-800 hover:bg-slate-700 transition text-white px-3 py-1.5 rounded-xl font-bold shadow-xs flex items-center gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> 匯出
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-[11px]">
                <th className="py-2.5 px-1 text-left font-sans">{isAdmin ? '老師' : '月份'}</th>
                <th className="py-2.5 px-1">1v1</th>
                <th className="py-2.5 px-1">1v2</th>
                <th className="py-2.5 px-1 font-black text-slate-900 whitespace-nowrap">總堂數</th>
                <th className="py-2.5 px-1">未結堂數</th>
                <th className="py-2.5 px-1">預排堂數</th>
                {isAdmin && <th className="py-2.5 px-1">取消堂數</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!isAdmin && myMonthRows.map(({ key, stats }) => (
                <tr key={key} className={key === selectedMonth ? 'bg-rose-50/50' : 'hover:bg-slate-50 transition'}>
                  <td className="py-2.5 px-2 font-bold text-left text-slate-900 whitespace-nowrap">{key.replace('-', '/')}</td>
                  <StatCells s={stats} />
                </tr>
              ))}
              {!isAdmin && (
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-black">
                  <td className="py-2.5 px-2 text-left font-sans text-slate-900 whitespace-nowrap">合計</td>
                  <StatCells s={myTotals} />
                </tr>
              )}
              {isAdmin && statTeachers.map((t: any) => {
                const s = statsFor(t.id);
                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition">
                    {/* 補齊代表色圓點與字體樣式，與下方清單完全統一 */}
                    <td className="py-2.5 px-2 font-bold font-sans text-left">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${t.color} shrink-0 shadow-2xs`} />
                        <span className={`font-black ${t.text}`}>{t.name}</span>
                        {!t.isActive && <span className="text-[9px] text-slate-400 font-bold">已封存</span>}
                      </div>
                    </td>
                    <StatCells s={s} />
                    <td className="py-2.5 px-1 text-slate-700">
                      <span className="font-black">{s.cancelled}</span>
                      <span className="block text-[10px] text-slate-400 font-sans whitespace-nowrap">
                        正常 {s.normalCancel}・<span className="text-rose-600">超時 {s.lateCancel}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-400 font-bold pt-2">未結堂數：已開課但尚未簽到、未取消（逾期待處理）</p>
          <p className="text-[10px] text-slate-400 font-bold">預排堂數：尚未開課的預約（含{REVIEW_TAG}）</p>
          {!isAdmin && (
            <p className="text-[10px] text-slate-400 font-bold">合計：上表所列月份（全部逾期課堂請見個人課表「逾期未處理」）</p>
          )}
        </div>
      </div>

      {/* 流水帳明細 (標題連動月份、取消狀態完整補全) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
        <button onClick={() => setAccordionOpen(!accordionOpen)} className="w-full p-4 flex justify-between items-center text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 transition">
          <span className="flex items-center gap-1.5">📁 {formatMonthKey(selectedMonth)} 明細</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-mono">{filteredBookings.length} 筆</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${accordionOpen ? 'rotate-180' : ''}`} />
          </div>
        </button>
        {accordionOpen && (
          <div className="p-3 border-t border-slate-100 divide-y divide-slate-100 text-xs font-mono max-h-80 overflow-y-auto">
            {filteredBookings.length === 0 && <p className="text-center text-slate-300 py-4 font-sans font-bold">該月份無上課明細</p>}
            {filteredBookings.map((b: any) => {
              const t = teachers[b.teacherId];
              return (
                <div key={b.id} className="py-2.5 flex flex-wrap justify-between items-center gap-x-2 gap-y-1 hover:bg-slate-50 transition px-1 rounded-lg">
                  <div className="min-w-0">
                    <span className="font-bold text-slate-800">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                    <span className="ml-2 font-sans font-bold text-slate-600">
                      {b.studentName} {userRole === 'admin' && (
                        <span className="inline-flex items-center gap-1 ml-1">
                          <span className={`w-2 h-2 rounded-full ${t?.color} shrink-0`} />
                          <span className={`text-[10px] font-bold ${t?.text}`}>({t?.name})</span>
                        </span>
                      )}
                    </span>
                  </div>
                  
                  {/* 精確狀態標籤：全站統一由 BookingStatusBadge 渲染 */}
                  <div className="ml-auto">
                    <BookingStatusBadge booking={b} showLessonState />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 
        管理員專屬：老師清單 
        (多餘新增按鈕已移除，Daisy 不顯示封存鈕，優先時段移至詳細檔案呈現)
      */}
      {userRole === 'admin' && (
        <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3">
          <div className="border-b border-slate-100 pb-2">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-1.5">
              <Users className="w-4 h-4 text-rose-500" /> 老師帳號清單
            </h3>
          </div>

          <div className="space-y-2 text-xs">
            {activeTeachers.map((t: any) => {
              const isDaisy = t.id === 't-daisy';

              return (
                <div key={t.id} className="p-3 border border-slate-200 rounded-xl hover:border-rose-200 transition bg-white relative shadow-2xs">
                  <div className="flex justify-between items-center cursor-pointer" onClick={() => onSelectTeacher(t.id)}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          // 管理者 Daisy 點擊直接跳 Toast，不開選色彈窗
                          if (isDaisy) {
                            showToast('管理者代表色固定為黃色，不可更換');
                            return;
                          }
                          setColorPickerTarget(colorPickerTarget === t.id ? null : t.id); 
                        }}
                        className={`w-5 h-5 rounded-full ${t.color} border-2 border-white shadow-2xs ring-1 ring-slate-200 flex items-center justify-center text-[9px] text-white transition ${
                          isDaisy ? 'cursor-default' : 'hover:scale-110 active:scale-95'
                        }`}
                        title={isDaisy ? '管理者代表色固定為黃色' : '點擊更換代表色'}
                      >
                        {isDaisy ? <Lock className="w-2.5 h-2.5 text-white drop-shadow-xs" /> : '✎'}
                      </button>
                      <span className={`font-black ${t.text} text-sm`}>{t.name}</span>
                      {isDaisy && (
                        <span className="text-[9px] bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-md font-bold">
                          管理者
                        </span>
                      )}
                    </div>

                    {/* Daisy (管理者) 不顯示封存鈕 */}
                    {!isDaisy && (
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setTeachers((prev: any) => ({ ...prev, [t.id]: { ...prev[t.id], isActive: false } })); 
                          showToast(`${t.name} 老師已移至封存`); 
                        }}
                        className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-slate-100 text-slate-500 hover:bg-slate-200 transition shadow-2xs"
                      >
                        ⚪ 封存
                      </button>
                    )}
                  </div>

                  {/* 代表色挑選器 (僅限一般老師開啟，被佔用顏色帶白色鎖頭，當前顏色帶勾號) */}
                  {colorPickerTarget === t.id && !isDaisy && (
                    <div 
                      className="absolute top-full left-0 mt-1 p-3 bg-white rounded-2xl shadow-xl border border-slate-200 z-30 animate-in zoom-in-95" 
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="text-[10px] text-slate-400 font-bold mb-1.5 flex justify-between items-center">
                        <span>更換代表色</span>
                        <span>鎖定代表已被佔用</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {PRESET_COLORS.map(c => {
                          const isColorInUse = usedColorsSet.has(c.color) && t.color !== c.color;
                          const isCurrentColor = t.color === c.color;

                          return (
                            <button
                              key={c.color}
                              type="button"
                              disabled={isColorInUse}
                              onClick={() => {
                                setTeachers((prev: any) => ({
                                  ...prev,
                                  [t.id]: { ...prev[t.id], color: c.color, bgLight: c.bgLight, border: c.border, text: c.text }
                                }));
                                setColorPickerTarget(null);
                                showToast(`已更新 ${t.name} 之代表色為 ${c.name}`);
                              }}
                              className={`w-7 h-7 rounded-full ${c.color} border border-slate-200/80 flex items-center justify-center transition relative ${
                                isColorInUse 
                                  ? 'cursor-not-allowed ring-1 ring-slate-300' 
                                  : isCurrentColor
                                    ? 'ring-2 ring-slate-800 scale-105 shadow-sm'
                                    : 'hover:scale-110 active:scale-95 shadow-2xs'
                              }`}
                              title={isColorInUse ? `${c.name}（已被其他老師使用）` : c.label}
                            >
                              {/* 被其他老師使用時：保持 100% 飽和度 + 半透明黑底 + 白色鎖頭 */}
                              {isColorInUse ? (
                                <div className="absolute inset-0 bg-black/25 rounded-full flex items-center justify-center">
                                  <Lock className="w-3 h-3 text-white drop-shadow-sm" />
                                </div>
                              ) : isCurrentColor ? (
                                <Check className="w-3.5 h-3.5 stroke-[3] text-white drop-shadow-sm" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 已封存老師名單 */}
          <div className="pt-2">
            <button onClick={() => setArchivedOpen(!archivedOpen)} className="w-full flex justify-between items-center text-[11px] font-bold text-slate-400 mb-2 py-1 hover:text-slate-600 transition">
              <span>📥 已封存老師 ({archivedTeachers.length})</span>
              {archivedOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {archivedOpen && (
              <div className="space-y-2 text-xs">
                {archivedTeachers.map((t: any) => (
                  <div key={t.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center grayscale opacity-80 shadow-2xs">
                    <span className="font-bold text-slate-600">{t.name}</span>
                    <button
                      onClick={() => { 
                        setTeachers((prev: any) => ({ ...prev, [t.id]: { ...prev[t.id], isActive: true } })); 
                        showToast(`${t.name} 老師已重新啟用`); 
                      }}
                      className="text-[10px] bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-bold hover:bg-emerald-200 transition shadow-2xs"
                    >
                      🟢 重新啟用
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 新增老師 Modal (代表色互斥防撞色) */}
      {isAddTeacherOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-rose-500" /> 新增老師帳號
              </h3>
              <button onClick={() => setIsAddTeacherOpen && setIsAddTeacherOpen(false)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-600 block mb-1">老師姓名 *</label>
                <input
                  type="text"
                  value={newTeacherName}
                  onChange={e => setNewTeacherName(e.target.value)}
                  placeholder="例如：Emily"
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 shadow-2xs"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 block mb-1">登入 Email</label>
                <input
                  type="text"
                  value={newTeacherEmail}
                  onChange={e => setNewTeacherEmail(e.target.value)}
                  placeholder="例如：emily@inlovepilates.com"
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 shadow-2xs"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 block mb-1">聯絡電話</label>
                <input
                  type="text"
                  value={newTeacherPhone}
                  onChange={e => setNewTeacherPhone(e.target.value)}
                  placeholder="例如：0912-888-999"
                  className="w-full border border-slate-200 rounded-xl p-2 bg-slate-50 font-bold outline-none focus:ring-1 focus:ring-rose-400 shadow-2xs"
                />
              </div>

<div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-bold text-slate-600">選擇代表色</label>
                  <span className="text-[10px] text-slate-400">鎖定標示代表已被使用</span>
                </div>
                <div className="grid grid-cols-5 gap-2.5 p-2.5 bg-slate-50 rounded-2xl border border-slate-200">
                  {PRESET_COLORS.map((c, idx) => {
                    const isColorInUse = usedColorsSet.has(c.color);
                    const isSelected = newTeacherColorIndex === idx;

                    return (
                      <button
                        key={c.color}
                        type="button"
                        disabled={isColorInUse}
                        onClick={() => setNewTeacherColorIndex(idx)}
                        className={`w-7 h-7 rounded-full ${c.color} flex items-center justify-center text-white transition relative ${
                          isColorInUse 
                            ? 'cursor-not-allowed ring-1 ring-slate-300' 
                            : isSelected 
                              ? 'ring-2 ring-slate-800 scale-105 shadow-sm' 
                              : 'hover:scale-105 active:scale-95 shadow-2xs'
                        }`}
                        title={isColorInUse ? `${c.name}（已被其他老師使用）` : c.label}
                      >
                        {/* 被佔用時：保持 100% 飽和原色，中央覆蓋微透黑底與白色鎖頭 */}
                        {isColorInUse ? (
                          <div className="absolute inset-0 bg-black/25 rounded-full flex items-center justify-center">
                            <Lock className="w-3 h-3 text-white drop-shadow-sm" />
                          </div>
                        ) : isSelected ? (
                          <Check className="w-3.5 h-3.5 stroke-[3] text-white drop-shadow-sm" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddTeacherOpen && setIsAddTeacherOpen(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 transition py-2.5 rounded-xl font-bold text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveTeacher}
                className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs"
              >
                建立老師
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 2. 第二層：老師檔案內頁 (優先排課時段移至此處資訊欄完整呈現)
// ==========================================
export function TeacherDetailView({ teacher, onBack, onUpdateTeacher, priorityGrid, showToast, bookings = [], today }: any) {
  const [email, setEmail] = useState(teacher.email || '');
  const [phone, setPhone] = useState(teacher.phone);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [expandStats, setExpandStats] = useState(false);

  // 反查該老師的優先排課時段
  const priorityScheduleText = useMemo(() => {
    return generatePriorityConclusion(teacher.id, priorityGrid);
  }, [teacher.id, priorityGrid]);

  const monthKeys = useMemo(() => deriveMonthKeys(bookings, today), [bookings, today]);
  const currentMonthKey = monthKeyOf(today);
  const now = useNow();
  const historyStats = useMemo(
    () => monthKeys.map(k => ({ key: k, stats: calculateTeacherMonthlyStats(bookings, k, teacher.id, now) })),
    [bookings, monthKeys, teacher.id, now],
  );

  // 收合時至少列到當月（未來月份較多時，當月仍看得到）
  const collapsedCount = Math.max(5, historyStats.findIndex(h => h.key === currentMonthKey) + 1);

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 pb-20">
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
        <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500 mr-1 transition"><ArrowLeft className="w-5 h-5"/></button>
        <span className="text-xs font-bold text-slate-400">老師檔案</span>
      </div>

      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full shadow-2xs ${teacher.color}`} /> {teacher.name} 老師
          </h2>
          <button onClick={() => setIsEditingInfo(!isEditingInfo)} className="text-rose-500 font-bold hover:bg-rose-50 px-2 py-1 rounded transition flex items-center gap-0.5">
            <Edit3 className="w-3.5 h-3.5" /> {isEditingInfo ? '取消編輯' : '編輯資料'}
          </button>
        </div>

        {isEditingInfo ? (
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-slate-500 font-bold">Email (登入帳號)</label>
              <input type="text" value={email} onChange={e=>setEmail(e.target.value)} className="w-full border border-slate-200 rounded-xl p-2.5 mt-1 outline-none font-bold text-slate-800 focus:ring-1 focus:ring-rose-400 transition shadow-2xs"/>
            </div>
            <div>
              <label className="text-slate-500 font-bold">電話號碼</label>
              <input type="text" value={phone} onChange={e=>setPhone(e.target.value)} className="w-full border border-slate-200 rounded-xl p-2.5 mt-1 outline-none font-bold text-slate-800 focus:ring-1 focus:ring-rose-400 transition shadow-2xs"/>
            </div>
            <div className="pt-2">
              <button onClick={() => { onUpdateTeacher({ ...teacher, email, phone }); setIsEditingInfo(false); showToast('已儲存老師資料變更'); }} className="w-full bg-slate-800 hover:bg-slate-700 transition text-white font-bold px-4 py-2.5 rounded-xl shadow-xs">
                儲存變更
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-slate-600 font-mono bg-slate-50 p-3 rounded-xl border border-slate-100 shadow-2xs">
            <p>• Email: <span className="font-bold text-slate-800">{teacher.email || '未提供'}</span></p>
            <p>• 電話: <span className="font-bold text-slate-800">{teacher.phone}</span></p>
            {/* 優先排課時段已完整移至此處 */}
            <div className="pt-1 border-t border-slate-200/60 flex items-start gap-1">
              <span className="shrink-0">• 優先排課時段:</span>
              <span className="font-bold text-rose-600 font-sans">{priorityScheduleText}</span>
            </div>
          </div>
        )}
        
        <div className="pt-2 border-t border-slate-100">
          <button onClick={() => showToast(teacher.email ? '已記錄老師資料，將於 Supabase Auth 串接後啟用信件開通' : '尚未填寫 Email，請先編輯資料後再寄送')} className="w-full bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1 transition shadow-2xs">
            <Mail className="w-4 h-4" /> 寄送邀請信
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3">
        <h3 className="font-black text-slate-800 text-sm">個人歷史授課統計</h3>
        <div className="overflow-x-auto">
        <table className="w-full text-center border-collapse text-xs font-mono">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <th className="py-2.5 text-left font-sans">月份</th>
              <th className="py-2.5">1v1</th>
              <th className="py-2.5">1v2</th>
              <th className="py-2.5 font-black text-slate-800">總堂數</th>
              <th className="py-2.5">未結</th>
              <th className="py-2.5">預排</th>
              <th className="py-2.5">超時</th>
              <th className="py-2.5">正常</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {historyStats.slice(0, expandStats ? historyStats.length : collapsedCount).map(({ key, stats: s }) => {
              const isCurrent = key === currentMonthKey;
              return (
                <tr key={key} className={isCurrent ? "bg-rose-50/50" : "hover:bg-slate-50 transition"}>
                  <td className="py-2.5 text-left font-bold font-sans text-slate-900">{formatMonthKey(key)}{isCurrent ? ' (當月)' : ''}</td>
                  <StatCells s={s} />
                  <td className="py-2.5">{s.lateCancel}</td>
                  <td className="py-2.5">{s.normalCancel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {historyStats.length > collapsedCount && (
          <button onClick={() => setExpandStats(!expandStats)} className="w-full text-center py-2 text-slate-400 hover:text-slate-600 font-bold text-[11px] transition mt-1 bg-white border border-slate-100 rounded-xl shadow-2xs">
            {expandStats ? '收合紀錄 ▲' : '展開更早紀錄 ▼'}
          </button>
        )}
      </div>
    </div>
  );
}