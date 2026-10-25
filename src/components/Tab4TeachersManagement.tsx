'use client';
import React, { useState, useMemo } from 'react';
import { Users, FileSpreadsheet, ChevronDown, ChevronUp, Mail, ArrowLeft, Edit3, X, UserPlus, Check, Lock } from 'lucide-react';
import { PRESET_COLORS, formatTimeStr, formatDateWithDay } from '../mockData';

// 根據 Tab 5 的 priorityGrid 自動計算老師時段結論 (例如 W1 08:00-12:00 / W2 14:00-15:00)
export const generatePriorityConclusion = (teacherId: string, grid: Record<string, any>) => {
  if (!grid) return '無固定優先時段';
  const dayMap: Record<string, string> = { '一': 'W1', '二': 'W2', '三': 'W3', '四': 'W4', '五': 'W5', '六': 'W6', '日': 'W7' };
  const dayHours: Record<string, number[]> = {};

  Object.entries(grid).forEach(([slotKey, data]) => {
    if (data.large === teacherId || data.small === teacherId) {
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

const getMonthFromDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length >= 2) return `${parseInt(parts[1], 10)}月`;
  return '';
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
  priorityGrid,
  onSelectTeacher, 
  showToast,
  isAddTeacherOpen,
  setIsAddTeacherOpen
}: any) {
  const [selectedMonth, setSelectedMonth] = useState('10月');
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [colorPickerTarget, setColorPickerTarget] = useState<string | null>(null);
  const [expandStats, setExpandStats] = useState(false);

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

  // 模擬歷史統計資料
  const mockHistoryStats = [
    { month: '10月', v1: 12, v2: 10, total: 22, penalty: 1, normal: 2 },
    { month: '9月', v1: 14, v2: 8, total: 22, penalty: 0, normal: 1 },
    { month: '8月', v1: 10, v2: 12, total: 22, penalty: 1, normal: 0 },
    { month: '7月', v1: 15, v2: 10, total: 25, penalty: 0, normal: 2 },
    { month: '6月', v1: 12, v2: 12, total: 24, penalty: 2, normal: 1 },
    { month: '5月', v1: 14, v2: 10, total: 24, penalty: 0, normal: 0 },
    { month: '4月', v1: 10, v2: 15, total: 25, penalty: 0, normal: 1 },
  ];

  // 依照選擇的月份動態過濾 bookings
  const filteredBookings = bookings.filter((b: any) => {
    const isTarget = userRole === 'admin' || b.teacherId === currentUserId;
    return isTarget && getMonthFromDate(b.date) === selectedMonth;
  });

  const getTeacherStats = (tId: string) => {
    const list = filteredBookings.filter((b: any) => b.teacherId === tId);
    const count1v1 = list.filter((b: any) => b.lessonType === '1v1' && b.status === 'confirmed').length;
    const count1v2 = list.filter((b: any) => b.lessonType === '1v2' && b.status === 'confirmed').length;
    const total = count1v1 + count1v2;
    const normalCancel = list.filter((b: any) => b.status === 'cancelled_normal').length;
    const penalty = list.filter((b: any) => b.status === 'special_rejected').length;
    return { count1v1, count1v2, total, normalCancel, penalty };
  };

  const activeTeachers = Object.values(teachers).filter((t: any) => t.isActive);
  const archivedTeachers = Object.values(teachers).filter((t: any) => !t.isActive);

  // 儲存新增老師
  const handleSaveTeacher = () => {
    if (!newTeacherName.trim()) return alert('請輸入老師姓名');
    const selectedColor = PRESET_COLORS[newTeacherColorIndex] || PRESET_COLORS[0];
    
    if (usedColorsSet.has(selectedColor.color)) {
      return alert('該代表色已被其他活躍老師使用，請挑選其他顏色以利課表辨識！');
    }

    const newId = `t-${Date.now()}`;
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
              <option value="10月">2026 年 10 月</option>
              <option value="9月">2026 年 09 月</option>
              <option value="8月">2026 年 08 月</option>
            </select>
          </div>
          <button onClick={() => showToast(`已匯出 ${selectedMonth} 統計表 CSV`)} className="text-xs bg-slate-800 hover:bg-slate-700 transition text-white px-3 py-1.5 rounded-xl font-bold shadow-xs flex items-center gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> 匯出
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-[11px]">
                <th className="py-2.5 px-1 text-left font-sans">{userRole === 'admin' ? '老師' : '月份'}</th>
                <th className="py-2.5 px-1">1v1</th>
                <th className="py-2.5 px-1">1v2</th>
                <th className="py-2.5 px-1 font-black text-slate-900">總堂數</th>
                <th className="py-2.5 px-1">超時取消</th>
                <th className="py-2.5 px-1">正常取消</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {userRole === 'admin' ? (
                <>
                  {activeTeachers.map((t: any) => {
                    const s = getTeacherStats(t.id);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 transition">
                        <td className={`py-2.5 px-1 font-bold font-sans text-left ${t.text}`}>{t.name}</td>
                        <td className="py-2.5 px-1 text-slate-700">{s.count1v1}</td>
                        <td className="py-2.5 px-1 text-slate-700">{s.count1v2}</td>
                        <td className="py-2.5 px-1 font-black text-slate-900">{s.total}</td>
                        <td className="py-2.5 px-1 text-slate-700">{s.penalty}</td>
                        <td className="py-2.5 px-1 text-slate-700">{s.normalCancel}</td>
                      </tr>
                    );
                  })}
                </>
              ) : (
                mockHistoryStats.slice(0, expandStats ? mockHistoryStats.length : 5).map((s, idx) => (
                  <tr key={idx} className={s.month === selectedMonth ? "bg-rose-50/50" : "hover:bg-slate-50 transition"}>
                    <td className="py-2.5 px-1 text-left font-bold font-sans text-slate-900">
                      {s.month} {s.month === '10月' ? '(當月)' : ''}
                    </td>
                    <td className="py-2.5 px-1 text-slate-700">{s.v1}</td>
                    <td className="py-2.5 px-1 text-slate-700">{s.v2}</td>
                    <td className="py-2.5 px-1 font-black text-slate-900">{s.total}</td>
                    <td className="py-2.5 px-1 text-slate-700">{s.penalty}</td>
                    <td className="py-2.5 px-1 text-slate-700">{s.normal}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {userRole !== 'admin' && mockHistoryStats.length > 5 && (
            <button onClick={() => setExpandStats(!expandStats)} className="w-full text-center py-2 text-slate-400 hover:text-slate-600 font-bold text-[11px] mt-1 transition">
              {expandStats ? '收合紀錄 ▲' : '展開更早紀錄 ▼'}
            </button>
          )}
        </div>
      </div>

      {/* 流水帳明細 (標題連動月份、取消狀態完整補全) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
        <button onClick={() => setAccordionOpen(!accordionOpen)} className="w-full p-4 flex justify-between items-center text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 transition">
          <span className="flex items-center gap-1.5">📁 {selectedMonth}明細</span>
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
                <div key={b.id} className="py-2.5 flex justify-between items-center hover:bg-slate-50 transition px-1 rounded-lg">
                  <div>
                    <span className="font-bold text-slate-800">{formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)}</span>
                    <span className="ml-2 font-sans font-bold text-slate-600">
                      {b.studentName} {userRole === 'admin' && <span className={`text-[10px] ${t?.text}`}>({t?.name})</span>}
                    </span>
                  </div>
                  
                  {/* 精確狀態標籤 (涵蓋所有取消與完成類型) */}
                  {b.signed ? (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold shadow-2xs">
                      簽到完成
                    </span>
                  ) : b.status === 'cancelled_normal' ? (
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold shadow-2xs">
                      正常取消
                    </span>
                  ) : b.status === 'special_rejected' ? (
                    <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold shadow-2xs">
                      計罰取消
                    </span>
                  ) : b.status === 'special_approved' ? (
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold shadow-2xs">
                      免罰取消
                    </span>
                  ) : b.status === 'special_pending' ? (
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold shadow-2xs">
                      取消待審核
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full shadow-2xs">
                      尚未開始
                    </span>
                  )}
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
                        onClick={(e) => { e.stopPropagation(); setColorPickerTarget(colorPickerTarget === t.id ? null : t.id); }}
                        className={`w-4 h-4 rounded-full ${t.color} border-2 border-white shadow-2xs ring-1 ring-slate-200 flex items-center justify-center text-[8px] text-white transition hover:scale-110`}
                        title="點擊更換代表色"
                      >
                        ✎
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

                  {/* 代表色挑選器 (被使用的顏色自動鎖定禁用) */}
                  {colorPickerTarget === t.id && (
                    <div 
                      className="absolute top-full left-0 mt-1 p-2.5 bg-white rounded-2xl shadow-xl border border-slate-100 z-20" 
                      onClick={e => e.stopPropagation()}
                    >
                      {t.id === 't-daisy' ? (
                        <div className="text-xs font-bold text-amber-700 bg-amber-50 px-3 py-2 rounded-xl whitespace-nowrap">
                          ⭐ 管理者固定為黃色，不可更換
                        </div>
                      ) : (
                        <div className="grid grid-cols-5 gap-2">
                          {PRESET_COLORS.map(c => {
                            const isColorInUse = usedColorsSet.has(c.color) && t.color !== c.color;
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
                        className={`w-6 h-6 rounded-full ${c.color} border border-slate-200/80 flex items-center justify-center transition relative ${
                          isColorInUse 
                            ? 'cursor-not-allowed ring-1 ring-slate-300' 
                            : 'hover:scale-110 active:scale-95 shadow-2xs'
                        }`}
                        title={isColorInUse ? '該色已被其他老師使用' : c.label}
                      >
                        {/* 被使用時保持原色，只在中央加鎖頭標示 */}
                        {isColorInUse && (
                          <div className="absolute inset-0 bg-black/25 rounded-full flex items-center justify-center">
                            <Lock className="w-2.5 h-2.5 text-white drop-shadow-sm" />
                          </div>
                        )}
                      </button>
                            );
                          })}
                        </div>
                      )}
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
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95">
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
export function TeacherDetailView({ teacher, onBack, onUpdateTeacher, priorityGrid, showToast }: any) {
  const [email, setEmail] = useState(teacher.email);
  const [phone, setPhone] = useState(teacher.phone);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [expandStats, setExpandStats] = useState(false);

  // 反查該老師的優先排課時段
  const priorityScheduleText = useMemo(() => {
    return generatePriorityConclusion(teacher.id, priorityGrid);
  }, [teacher.id, priorityGrid]);

  const mockHistoryStats = [
    { month: '10月 (當月)', v1: 12, v2: 10, total: 22, penalty: 1, normal: 2 },
    { month: '9月', v1: 14, v2: 8, total: 22, penalty: 0, normal: 1 },
    { month: '8月', v1: 10, v2: 12, total: 22, penalty: 1, normal: 0 },
    { month: '7月', v1: 15, v2: 10, total: 25, penalty: 0, normal: 2 },
    { month: '6月', v1: 12, v2: 12, total: 24, penalty: 2, normal: 1 },
    { month: '5月', v1: 14, v2: 10, total: 24, penalty: 0, normal: 0 },
  ];

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
            <p>• Email: <span className="font-bold text-slate-800">{teacher.email}</span></p>
            <p>• 電話: <span className="font-bold text-slate-800">{teacher.phone}</span></p>
            {/* 優先排課時段已完整移至此處 */}
            <div className="pt-1 border-t border-slate-200/60 flex items-start gap-1">
              <span className="shrink-0">• 優先排課時段:</span>
              <span className="font-bold text-rose-600 font-sans">{priorityScheduleText}</span>
            </div>
          </div>
        )}
        
        <div className="pt-2 border-t border-slate-100">
          <button onClick={() => showToast(`已發送系統開通邀請信至 ${teacher.email}`)} className="w-full bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1 transition shadow-2xs">
            <Mail className="w-4 h-4" /> 寄送邀請信
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3">
        <h3 className="font-black text-slate-800 text-sm">個人歷史授課統計</h3>
        <table className="w-full text-center border-collapse text-xs font-mono">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <th className="py-2.5 text-left font-sans">月份</th>
              <th className="py-2.5">1v1</th>
              <th className="py-2.5">1v2</th>
              <th className="py-2.5 font-black text-slate-800">總堂數</th>
              <th className="py-2.5">超時</th>
              <th className="py-2.5">正常</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {mockHistoryStats.slice(0, expandStats ? mockHistoryStats.length : 5).map((s, idx) => (
              <tr key={idx} className={idx === 0 ? "bg-rose-50/50" : "hover:bg-slate-50 transition"}>
                <td className="py-2.5 text-left font-bold font-sans text-slate-900">{s.month}</td>
                <td className="py-2.5">{s.v1}</td>
                <td className="py-2.5">{s.v2}</td>
                <td className="py-2.5 font-black text-slate-900">{s.total}</td>
                <td className="py-2.5">{s.penalty}</td>
                <td className="py-2.5">{s.normal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mockHistoryStats.length > 5 && (
          <button onClick={() => setExpandStats(!expandStats)} className="w-full text-center py-2 text-slate-400 hover:text-slate-600 font-bold text-[11px] transition mt-1 bg-white border border-slate-100 rounded-xl shadow-2xs">
            {expandStats ? '收合紀錄 ▲' : '展開更早紀錄 ▼'}
          </button>
        )}
      </div>
    </div>
  );
}