'use client';
import React, { useState, useMemo } from 'react';
import { Bell, Download, CheckCheck, RotateCcw, ChevronDown, ChevronUp, BookOpen, Edit3, Calendar, X, Lock } from 'lucide-react';
import { formatDateWithDay, formatTimeStr } from '../mockData';
import { formatTimestamp, getLogSeverity, isLogReadBy, isLogVisibleTo, isPendingApproval, setLogReadBy, noticeToPlainText, REVIEW_TAG, ROOM_NAME } from '../utils/bookingRules';
import { NoticeText, RoomDot } from './RoomDot';

export default function Tab5RulesAndAudit({ 
  userRole, 
  currentUserId, 
  teachers, 
  priorityGrid, 
  setPriorityGrid, 
  bookings = [],
  reviews, 
  onReview, 
  onReset, 
  onUndoSettlement,
  logs, 
  setLogs, 
  studioRules, 
  setStudioRules, 
  showToast, 
  onRuleUpdate
}: any) {
  const [slotModal, setSlotModal] = useState<string | null>(null);
  // 指派彈窗草稿：同一時段「不限教室 / 大教室 / 小教室」只能擇一
  const [slotDraft, setSlotDraft] = useState({ all: '', large: '', small: '' });
  const openSlotModal = (slotKey: string) => {
    const cur = priorityGrid[slotKey] || {};
    setSlotDraft({
      all: cur.all || '',
      large: cur.all ? '' : cur.large || '',
      small: cur.all || cur.large ? '' : cur.small || '',
    });
    setSlotModal(slotKey);
  };
  const [expandLogs, setExpandLogs] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'red' | 'yellow' | 'gray'>('all');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [noticeCardOpen, setNoticeCardOpen] = useState(true);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [isEditingRules, setIsEditingRules] = useState(false);
  const [rulesDraft, setRulesDraft] = useState(studioRules || '');

  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

  const activeTeachers = useMemo(() => {
    return Object.values(teachers).filter((t: any) => t.isActive);
  }, [teachers]);

  // 日誌權限過濾：管理員看全館，一般老師只看自己的通知與全館廣播
  const displayLogs = useMemo(() => {
    const targetLogs = logs.filter((l: any) => isLogVisibleTo(l, userRole, currentUserId));
    // 依操作時間由新到舊；同一分鐘維持寫入順序（新紀錄在前）。ID 含隨機字元，不可用於排序
    return targetLogs.sort((a: any, b: any) => (b.time || '').localeCompare(a.time || ''));
  }, [logs, userRole, currentUserId]);

  // 需要已讀確認的通知：黃色 / 紅色（灰階一般紀錄不計未讀、不顯示已讀切換）
  const isRoomSwapNotice = (l: any) => getLogSeverity(l) !== 'gray';

  const severityCounts = useMemo(() => {
    const c = { all: displayLogs.length, red: 0, yellow: 0, gray: 0 };
    displayLogs.forEach((l: any) => { c[getLogSeverity(l)]++; });
    return c;
  }, [displayLogs]);

  const filteredLogs = useMemo(
    () => severityFilter === 'all' ? displayLogs : displayLogs.filter((l: any) => getLogSeverity(l) === severityFilter),
    [displayLogs, severityFilter]
  );

  // 僅黃、紅通知計未讀（依目前檢視者各自計算）
  const unreadCount = useMemo(() => {
    return displayLogs.filter((l: any) => !isLogReadBy(l, currentUserId) && isRoomSwapNotice(l)).length;
  }, [displayLogs, currentUserId]);

  // 只變更目前檢視者的已讀狀態
  const markRead = (ids: Set<string>, read: boolean) =>
    setLogs((prev: any) => prev.map((l: any) =>
      ids.has(l.id) ? setLogReadBy(l, currentUserId, read, Object.keys(teachers)) : l));

  const pendingReviews = useMemo(() => reviews.filter((r: any) => r.status === 'pending'), [reviews]);

  const toggleReviewExpand = (id: string) => {
    setExpandedReviews(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleLogExpand = (id: string) => {
    setExpandedLogIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 清洗名稱：去除「老師」贅字與「學員」假名
  const getCleanNames = (l: any) => {
    const rawTeacher = l.teacherName || l.actor || 'Daisy';
    const teacherClean = rawTeacher.replace(/ 老師|老師|\(管理者\)/g, '').trim();

    let studentClean = l.studentName || '';
    if (studentClean === '學員' || studentClean === '-') {
      studentClean = '';
    }
    return { teacherClean, studentClean };
  };

  const exportCSV = (type: 'month' | 'all') => {
    const currentMonth = formatTimestamp().slice(0, 7); // YYYY/MM
    const logsToExport = type === 'all' 
      ? displayLogs 
      : displayLogs.filter((l: any) => l.time.startsWith(currentMonth));

    if (logsToExport.length === 0) return showToast('該範圍內無資料可匯出');

    let csv = "時間,類別,老師,學生,剩餘堂數,詳細內容\n";
    logsToExport.forEach((l: any) => { 
      const { teacherClean, studentClean } = getCleanNames(l);
      const rem = l.remainingCredits !== undefined ? l.remainingCredits : '';
      const detail = noticeToPlainText(
        [l.title, l.detail || l.action, l.revokedAt ? `已撤銷（${l.revokedAt}）` : ''].filter(Boolean).join('\n')
      );
      csv += `${l.time},${l.typeStr},${teacherClean},${studentClean},${rem},"${detail.replace(/"/g, '""')}"\n`; 
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `InLovePilates_AuditLogs_${type === 'month' ? 'CurrentMonth' : 'All'}_${Date.now()}.csv`; 
    a.click();
    
    setExportMenuOpen(false);
    showToast(`已匯出 ${type === 'month' ? '當月' : '全部'} 系統復盤報表 (CSV)`);
  };

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      
      {/* 1. 審核區塊 (管理員可見) */}
      {userRole === 'admin' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-black text-slate-800 flex items-center gap-1.5">
              <Bell className="w-5 h-5 text-rose-500" /> {REVIEW_TAG}
            </h2>
            <span className="text-xs px-2.5 py-1 bg-rose-100 text-rose-700 font-bold rounded-full shadow-2xs">
              待審：{pendingReviews.length}
            </span>
          </div>
          
          {pendingReviews.length === 0 ? (
            <div className="bg-white p-4 rounded-3xl border border-slate-200 text-center text-xs text-slate-400 font-bold shadow-2xs">
              目前無待審核項目
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingReviews.map((item: any) => {
                const isExpanded = !!expandedReviews[item.id];
                const isLargeRoom = !!item.room?.includes('大');
                const cleanTeacher = (item.teacherName || '老師').replace(/ 老師|老師/g, '').trim();

                return (
                  <div 
                    key={item.id} 
                    className="bg-white p-3.5 rounded-3xl border border-rose-200 shadow-2xs space-y-2 transition hover:shadow-md"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <div 
                        onClick={() => toggleReviewExpand(item.id)}
                        className="flex items-center flex-wrap gap-1.5 min-w-0 text-xs font-bold text-slate-800 cursor-pointer select-none"
                      >
                        <span className="text-sm font-black text-rose-600">{cleanTeacher}</span>
                        {item.studentName && item.studentName !== '學員' && (
                          <span className="text-slate-700 font-sans font-bold">({item.studentName})</span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-rose-50 text-rose-700 border border-rose-200">
                          {REVIEW_TAG}
                        </span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />}
                      </div>

                      <div className="flex gap-1.5 shrink-0">
                        <button 
                          onClick={() => onReview(item.id, 'approved')} 
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-[11px] font-black transition shadow-2xs active:scale-95"
                        >
                          核准
                        </button>
                        <button 
                          onClick={() => onReview(item.id, 'rejected')} 
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-xl text-[11px] font-black transition shadow-2xs active:scale-95"
                        >
                          駁回
                        </button>
                      </div>
                    </div>

                    {/* 批次單中已成立（簽到或自動核准）的課堂提示 */}
                    {(item.batchBookingIds?.length ?? 0) > 0 && (bookings as any[]).some(b => item.batchBookingIds.includes(b.id) && b.status === 'confirmed') && (
                      <div className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        部分課堂已簽到或自動核准：核准 / 駁回僅影響仍待審的課堂。
                      </div>
                    )}

                    {/* 展開詳細內容：清楚標註「🟣 大教室 / 🟢 小教室」文字與異動目標 */}
                    {isExpanded ? (
                      <div className="p-2.5 bg-slate-50 rounded-xl text-xs text-slate-700 space-y-2 border border-slate-100 animate-in fade-in duration-150">
                        <p className="font-medium"><span className="text-slate-400 font-sans">事由：</span>{item.reason}</p>
                        
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-800 pt-1 border-t border-slate-200/60">
                          {/* 原課堂資訊（帶完整教室名稱） */}
                          <div className="flex items-center gap-1">
                            <span className="text-slate-400 font-sans">原課堂：</span>
                            <span className="font-bold text-slate-700 font-sans">
                              <RoomDot room={isLargeRoom ? 'large' : 'small'} /> {ROOM_NAME[isLargeRoom ? 'large' : 'small']}
                            </span>
                            <span className="font-bold ml-1">{item.time}</span>
                            <span className="font-sans font-black text-slate-900 ml-1">{item.studentName || ''}</span>
                            <span className="bg-slate-200/80 text-slate-700 px-1.5 py-0.2 rounded text-[10px] font-bold font-sans">
                              {item.lessonType || '1v1'}
                            </span>
                          </div>

                          {item.batchBookingIds?.length > 0 && (
                            <div className="w-full font-sans text-slate-700 space-y-0.5">
                              <div className="text-slate-400">批次課堂（核准 / 駁回整批一次套用）：</div>
                              {(bookings as any[])
                                .filter(b => item.batchBookingIds.includes(b.id))
                                .sort((a, b) => a.date.localeCompare(b.date) || (a.startHour * 60 + a.startMin) - (b.startHour * 60 + b.startMin))
                                .map(b => (
                                  <div key={b.id} className="font-mono text-[11px]">
                                    <RoomDot room={b.roomType} /> {formatDateWithDay(b.date)} {formatTimeStr(b.startHour, b.startMin)} ({b.lessonType})
                                    {b.signed ? ' · 已簽到' : isPendingApproval(b) ? '' : b.status === 'confirmed' ? ' · 已核准' : ' · 已取消'}
                                  </div>
                                ))}
                            </div>
                          )}

                          <div className="flex items-center gap-1 text-amber-700 font-bold font-sans">
                            <span className="text-slate-400">類型：</span>
                            <span className="font-normal text-slate-600">{REVIEW_TAG}（核准後生效、駁回則釋出時段）</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div 
                        onClick={() => toggleReviewExpand(item.id)}
                        className="text-[11px] text-slate-500 truncate cursor-pointer hover:text-slate-700 pl-1"
                      >
                        {item.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. 通知區塊 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-black text-slate-800 flex items-center gap-1.5 text-sm">
              <Bell className="w-4 h-4 text-sky-600" /> 通知
            </h3>
            {unreadCount > 0 && (
              <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">
                未讀 {unreadCount}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            {/* 匯出 CSV：純 Icon */}
            {userRole === 'admin' && (
              <div className="relative">
                <button 
                  onClick={() => setExportMenuOpen(!exportMenuOpen)} 
                  className="p-1.5 text-slate-600 hover:text-emerald-700 border border-slate-200 hover:bg-slate-50 rounded-xl shadow-2xs transition"
                  title="匯出 CSV 報表"
                >
                  <Download className="w-4 h-4 text-emerald-600" />
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 mt-1 w-28 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden divide-y divide-slate-100 animate-in zoom-in-95">
                    <button 
                      onClick={() => exportCSV('month')} 
                      className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition"
                    >
                      當月紀錄
                    </button>
                    <button 
                      onClick={() => exportCSV('all')} 
                      className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition"
                    >
                      全部紀錄
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* All已讀：純 Icon */}
            <button 
              onClick={() => { 
                markRead(new Set(displayLogs.map((l: any) => l.id)), true);
                showToast('已全部標記為已讀'); 
              }} 
              className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-slate-200 rounded-xl transition shadow-2xs"
              title="全部標記為已讀"
            >
              <CheckCheck className="w-4 h-4" />
            </button>

            {/* 右上角收合 */}
            <button 
              onClick={() => setNoticeCardOpen(!noticeCardOpen)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg transition"
              title={noticeCardOpen ? '縮合通知' : '展開通知'}
            >
              {noticeCardOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {noticeCardOpen && (
          <div className="space-y-2 animate-in fade-in duration-150">
            {/* 三級分類篩選：全部 / 重要 / 提醒 / 一般 */}
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              {([
                ['all', '全部', 'bg-slate-800 text-white border-slate-800', 'bg-white text-slate-600 border-slate-200'],
                ['red', '🔴 重要', 'bg-rose-500 text-white border-rose-500', 'bg-rose-50 text-rose-700 border-rose-200'],
                ['yellow', '🟡 提醒', 'bg-amber-500 text-white border-amber-500', 'bg-amber-50 text-amber-700 border-amber-200'],
                ['gray', '⚪ 一般', 'bg-slate-500 text-white border-slate-500', 'bg-slate-50 text-slate-600 border-slate-200'],
              ] as const).map(([key, label, on, off]) => (
                <button
                  key={key}
                  onClick={() => { setSeverityFilter(key); setExpandLogs(false); }}
                  className={`px-2.5 py-1 rounded-full border transition shadow-2xs ${severityFilter === key ? on : off}`}
                >
                  {label} {severityCounts[key]}
                </button>
              ))}
            </div>

            {filteredLogs.length === 0 && (
              <p className="text-center text-slate-300 py-4 font-bold font-sans">無相關通知紀錄</p>
            )}
            
            {filteredLogs.slice(0, expandLogs ? filteredLogs.length : 5).map((l: any) => {
              const severity = getLogSeverity(l);
              const isNormal = severity === 'gray';
              const isExpanded = !!expandedLogIds[l.id];
              const { teacherClean, studentClean } = getCleanNames(l);
              const detailContent = l.detail || l.action;
              const isRead = isLogReadBy(l, currentUserId);

              return (
                <div 
                  key={l.id} 
                  onClick={() => toggleLogExpand(l.id)} 
                  className={`p-2.5 rounded-2xl border transition cursor-pointer ${
                    isNormal 
                      ? 'bg-slate-50 border-slate-200 hover:bg-slate-100/70' 
                      : severity === 'red' 
                        ? 'bg-rose-50/80 border-rose-200 hover:bg-rose-100/60' 
                        : 'bg-amber-50/80 border-amber-200 hover:bg-amber-100/60'
                  } ${
                    !isNormal && isRead ? 'opacity-60 grayscale-[25%]' : 'shadow-2xs font-bold'
                  }`}
                >
                  {/* 第一行：時間  類別  老師名  學生名 (無老師與學員贅字) */}
                  <div className="flex justify-between items-center text-[11px] gap-2">
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0 flex-1 font-mono">
                      <span className={`w-2 h-2 rounded-full shrink-0 shadow-2xs ${
                        severity === 'red' ? 'bg-rose-500' : 
                        severity === 'yellow' ? 'bg-amber-500' : 
                        'bg-slate-400'
                      }`} />
                      <span className="text-slate-400 text-[10px] shrink-0">{l.time}</span>
                      <span className="font-black text-slate-800 bg-slate-200/60 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                        {l.typeStr}
                      </span>
                      {/* 有標題的通知由第二行顯示老師與學員；僅在操作者不是標題中的老師時保留操作者 */}
                      {(!l.title || !l.title.startsWith(teacherClean)) && (
                        <span className="font-bold text-slate-700 font-sans break-words min-w-0">{teacherClean}</span>
                      )}
                      {studentClean && !l.title && (
                        <span className="font-black text-slate-900 font-sans break-words min-w-0">{studentClean}</span>
                      )}
                      {l.revokedAt && (
                        <span className="text-[10px] font-black text-slate-500 bg-white border border-slate-300 px-1.5 py-0.5 rounded shrink-0">已撤銷</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                      {/* Undo：管理員撤銷審核結果按鈕 */}
                      {userRole === 'admin' && l.reviewId && (
                        <button 
                          onClick={() => { 
                            onReset(l.reviewId!); 
                          }} 
                          className="bg-white border border-slate-300 p-1.5 rounded-lg text-slate-600 hover:bg-slate-50 transition shadow-2xs active:scale-95"
                          title="Undo 撤銷審核"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* 核心校正：只有「系統安排調度」或「改室」才需要已讀／未讀切換，其餘紀錄不需顯示 */}
                      {isRoomSwapNotice(l) && (
                        <button 
                          onClick={() => markRead(new Set([l.id]), !isRead)}
                          className={`text-[10px] px-2 py-0.5 rounded-md font-bold border transition ${
                            isRead ? 'text-slate-400 bg-white/70 border-transparent' : 'text-blue-600 bg-blue-50 border-blue-200 shadow-2xs animate-pulse'
                          }`}
                        >
                          {isRead ? '已讀' : '未讀'}
                        </button>
                      )}

                      <span className="text-slate-400 text-[10px]">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </span>
                    </div>
                  </div>

                  {/* 第二行：通知標題（含教室色點）與撤銷按鈕 */}
                  {(l.title || (userRole === 'admin' && l.settlement && !l.revokedAt)) && (
                    <div className="mt-1.5 pl-4 flex items-center justify-between gap-2">
                      <p className={`text-xs font-black break-words min-w-0 ${l.revokedAt ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {l.title && <NoticeText text={l.title} />}
                      </p>
                      {userRole === 'admin' && l.settlement && !l.revokedAt && (
                        <button
                          onClick={e => { e.stopPropagation(); onUndoSettlement(l.id); }}
                          className="shrink-0 whitespace-nowrap bg-white border border-slate-300 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition shadow-2xs active:scale-95 flex items-center gap-1"
                          title="Undo 撤銷"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> 撤銷
                        </button>
                      )}
                    </div>
                  )}

                  {/* 點擊展開的詳細內容 */}
                  {isExpanded && detailContent && (
                    <div className="mt-2 pt-2 border-t border-slate-200/60 text-[11px] leading-relaxed text-slate-600 pl-4 font-mono whitespace-pre-line animate-in fade-in duration-100">
                      <NoticeText text={detailContent} />
                    </div>
                  )}
                </div>
              );
            })}

            {filteredLogs.length > 5 && (
              <button 
                onClick={() => setExpandLogs(!expandLogs)} 
                className="w-full text-center py-2 text-slate-400 hover:text-slate-600 font-bold text-[11px] bg-white border border-slate-100 rounded-xl shadow-2xs transition mt-1"
              >
                {expandLogs ? '收合紀錄 ▲' : `展開其餘通知 (${filteredLogs.length - 5} 筆) ▼`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. 優先排課 */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xs overflow-hidden">
        <button
          onClick={() => setPriorityOpen(!priorityOpen)}
          className="w-full p-4 flex flex-col gap-2 bg-white hover:bg-slate-50 transition text-left"
        >
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="text-sm font-black text-slate-800">優先排課</span>
            </div>
            {priorityOpen ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold text-slate-600">
            {activeTeachers.map((t: any) => (
              <span key={t.id} className="flex items-center gap-1 shrink-0">
                <span className={`w-2 h-2 rounded-full ${t.color}`} />
                <span>{t.name}</span>
              </span>
            ))}
            <span className="text-slate-300">|</span>
            <span className="text-slate-400 font-normal">左格: 大教室 / 右格: 小教室 / 長條: 不限教室</span>
          </div>
        </button>
        
        {priorityOpen && (
          <div className="p-3 pt-0 border-t border-slate-100 space-y-3">
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs mt-2 w-full">
              <table className="w-full text-center border-collapse text-xs table-fixed">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold text-[10px]">
                    <th className="py-2 border-r border-slate-200 w-7 font-mono">時</th>
                    {days.map(d => (
                      <th key={d} className="py-2 border-r border-slate-200 font-black text-slate-800 last:border-r-0">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[10px] font-mono">
                  {hours.map(h => (
                    <tr key={h} className="hover:bg-slate-50 transition">
                      <td className="py-1.5 bg-slate-50/70 font-bold border-r border-slate-200 text-slate-400">
                        {h}
                      </td>
                      {days.map(d => {
                        const slotKey = `${d}-${h}`;
                        const slotData = priorityGrid[slotKey] || {};
                        const allT = slotData.all ? teachers[slotData.all] : null;
                        const largeT = slotData.large ? teachers[slotData.large] : null;
                        const smallT = slotData.small ? teachers[slotData.small] : null;

                        return (
                          <td 
                            key={d} 
                            onClick={() => { if (userRole === 'admin') openSlotModal(slotKey); }} 
                            className={`py-1.5 px-0.5 border-r border-slate-100 last:border-r-0 transition ${
                              userRole === 'admin' ? 'cursor-pointer hover:bg-rose-50/80' : ''
                            }`}
                          >
                            {allT ? (
                              <div className="flex justify-center items-center">
                                <span
                                  className={`w-5 h-2 rounded-full ${allT.color} shadow-2xs ring-1 ring-white`}
                                  title={`不限教室: ${allT.name}`}
                                />
                              </div>
                            ) : (
                            <div className="grid grid-cols-2 gap-0.5 w-full max-w-[24px] mx-auto items-center justify-center">
                              <div className="flex justify-end items-center">
                                {largeT ? (
                                  <span 
                                    className={`w-2 h-2 rounded-full ${largeT.color} shadow-2xs ring-1 ring-white`} 
                                    title={`大教室: ${largeT.name}`} 
                                  />
                                ) : smallT ? (
                                  <span title="小教室已設優先" className="flex"><Lock className="w-2 h-2 text-slate-300" /></span>
                                ) : null}
                              </div>
                              <div className="flex justify-start items-center">
                                {largeT ? (
                                  <span title="大教室已設優先" className="flex"><Lock className="w-2 h-2 text-slate-300" /></span>
                                ) : smallT ? (
                                  <span 
                                    className={`w-2 h-2 rounded-full ${smallT.color} shadow-2xs ring-1 ring-white`} 
                                    title={`小教室: ${smallT.name}`} 
                                  />
                                ) : null}
                              </div>
                            </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 4. 館內管理規範 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
          <h3 className="font-black text-slate-800 flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-emerald-600" /> 館內排課與使用規範
          </h3>
          {userRole === 'admin' && (
            <button 
              onClick={() => {
                if (isEditingRules) {
                  if (rulesDraft !== studioRules) {
                    setStudioRules(rulesDraft);
                    onRuleUpdate(`館內排課與使用規範已更新\n${rulesDraft || '（已清空）'}`);
                  }
                  showToast('館內規範已儲存更新');
                }
                setIsEditingRules(!isEditingRules);
              }} 
              className="text-rose-500 font-bold hover:bg-rose-50 px-2 py-1 rounded transition flex items-center gap-0.5"
            >
              <Edit3 className="w-3.5 h-3.5" /> {isEditingRules ? '儲存規範' : '編輯規範'}
            </button>
          )}
        </div>
        
        {isEditingRules ? (
          <textarea
            value={rulesDraft}
            onChange={e => setRulesDraft(e.target.value)}
            rows={4}
            className="w-full border border-slate-200 rounded-xl p-2.5 bg-slate-50 text-slate-700 outline-none focus:ring-1 focus:ring-rose-400 font-sans leading-relaxed shadow-2xs"
          />
        ) : (
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl text-slate-600 whitespace-pre-line leading-relaxed font-sans">
            {studioRules || '尚無設定館內規範'}
          </div>
        )}
      </div>

      {/* 指派優先老師彈窗 */}
      {slotModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-bold text-slate-800">指派優先時段 ({slotModal})</h3>
              <button onClick={() => setSlotModal(null)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400">
                <X className="w-4 h-4"/>
              </button>
            </div>
            
            <div className="space-y-3.5">
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">🏠 不限教室（依課程決定）優先老師</label>
                <select
                  value={slotDraft.all}
                  disabled={!!slotDraft.large || !!slotDraft.small}
                  onChange={e => setSlotDraft(d => ({ ...d, all: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white outline-none focus:ring-1 focus:ring-rose-400 transition shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <option value="">{slotDraft.large ? '大教室已設優先' : slotDraft.small ? '小教室已設優先' : '(無 / 留空)'}</option>
                  {activeTeachers.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-purple-700 block mb-1.5 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-2xs"></span> 🏛️ 大教室優先老師
                </label>
                <select 
                  value={slotDraft.large} 
                  disabled={!!slotDraft.all || !!slotDraft.small}
                  onChange={e => setSlotDraft(d => ({ ...d, large: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white outline-none focus:ring-1 focus:ring-purple-400 transition shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <option value="">{slotDraft.all ? '已設不限教室' : slotDraft.small ? '小教室已設優先' : '(無 / 留空)'}</option>
                  {activeTeachers.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="font-bold text-emerald-700 block mb-1.5 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-2xs"></span> 🧘 小教室優先老師
                </label>
                <select 
                  value={slotDraft.small} 
                  disabled={!!slotDraft.all || !!slotDraft.large}
                  onChange={e => setSlotDraft(d => ({ ...d, small: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white outline-none focus:ring-1 focus:ring-emerald-400 transition shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <option value="">{slotDraft.all ? '已設不限教室' : slotDraft.large ? '大教室已設優先' : '(無 / 留空)'}</option>
                  {activeTeachers.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex gap-2 pt-3 border-t border-slate-100">
              <button 
                onClick={() => setSlotModal(null)} 
                className="flex-1 bg-slate-100 py-2.5 rounded-xl font-bold hover:bg-slate-200 transition text-slate-600"
              >
                取消
              </button>
              <button 
                onClick={() => {
                  const aVal = slotDraft.all;
                  const lVal = aVal ? '' : slotDraft.large;
                  const sVal = aVal || lVal ? '' : slotDraft.small;
                  const cur = priorityGrid[slotModal] || {};
                  const changed = (cur.all || '') !== aVal || (cur.large || '') !== lVal || (cur.small || '') !== sVal;
                  if (changed) {
                    onRuleUpdate(`優先時段設定修改\n${slotModal}：${aVal ? `不限教室 ${teachers[aVal]?.name || '無'}` : `大教室 ${teachers[lVal]?.name || '無'}、小教室 ${teachers[sVal]?.name || '無'}`}`);
                  }
                  setPriorityGrid((prev: any) => ({ 
                    ...prev, 
                    [slotModal]: { all: aVal || undefined, large: lVal || undefined, small: sVal || undefined } 
                  }));
                  setSlotModal(null);
                  showToast('優先時段已更新');
                }} 
                className="flex-1 bg-rose-500 hover:bg-rose-600 transition text-white py-2.5 rounded-xl font-bold shadow-xs"
              >
                儲存指派
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}