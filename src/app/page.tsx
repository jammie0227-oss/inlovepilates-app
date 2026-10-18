'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, 
  Bell, 
  BarChart3, 
  Users, 
  FileText, 
  Plus, 
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
  Phone,
  Copy,
  ArrowLeft,
  Mail,
  X,
  Check,
  FileSpreadsheet,
  Trash2,
  Lock,
  Sparkles,
  BookOpen,
  User as UserIcon,
  AlertCircle,
  PenTool,
  Clock,
  History,
  Save,
  Edit3,
  ZoomIn,
  CheckCheck,
  ExternalLink
} from 'lucide-react';

// ==========================================
// 1. 純 JavaScript 核心自動排課邏輯引擎 (ScheduleEngine)
// ==========================================
class ScheduleEngine {
  existingRecords: any[];

  constructor(existingRecords = []) {
    this.existingRecords = existingRecords.filter((r: any) => r.status !== 'cancelled_normal');
  }

  formatDate(d: Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  checkConflict(fullDateTime: string, roomType: string) {
    const match = this.existingRecords.find(r => `${r.date} ${r.time}` === fullDateTime && r.roomType === roomType);
    if (match) {
      return { isConflict: true, conflictRecord: match };
    }
    return { isConflict: false };
  }

  generateSchedule({
    sid,
    credits,
    slots = [],
    conflictPolicy = 'skip',
    maxWeeksLimit = 12 // 一般老師上限 3 個月 (12 週)
  }: any) {
    if (!slots || slots.length === 0 || credits <= 0) {
      return { success: false, newRecords: [], conflictsFound: [], message: '無效的排課規則或剩餘堂數不足' };
    }

    let earliestStartStr = "2099-12-31";
    slots.forEach((s: any) => {
      if (s.startDate && s.startDate < earliestStartStr) earliestStartStr = s.startDate;
    });
    if (earliestStartStr === "2099-12-31") earliestStartStr = this.formatDate(new Date());

    const startDateObj = new Date(`${earliestStartStr}T00:00:00`);
    const maxAllowedDate = new Date(startDateObj);
    maxAllowedDate.setDate(maxAllowedDate.getDate() + maxWeeksLimit * 7);

    const newRecords: any[] = [];
    const conflictsFound: any[] = [];
    let scheduledCount = 0;
    let currentDate = new Date(`${earliestStartStr}T00:00:00`);
    let safetyLoop = 0;
    let hitMaxLimit = false;

    while (scheduledCount < credits && safetyLoop < 1000) {
      safetyLoop++;
      if (currentDate > maxAllowedDate) {
        hitMaxLimit = true;
        break;
      }

      const dayOfWeekStr = ['日', '一', '二', '三', '四', '五', '六'][currentDate.getDay()];
      const dateStr = this.formatDate(currentDate);
      const matchedSlots = slots.filter((s: any) => s.day === dayOfWeekStr);

      for (const slot of matchedSlots) {
        if (scheduledCount >= credits) break;

        if (dateStr >= slot.startDate) {
          const fullDateTime = `${dateStr} ${slot.time}`;
          const conflictCheck = this.checkConflict(fullDateTime, slot.roomType || 'small');

          if (conflictCheck.isConflict) {
            conflictsFound.push({ date: fullDateTime, conflictWith: conflictCheck.conflictRecord });
            if (conflictPolicy === 'skip') {
              continue;
            } else if (conflictPolicy === 'cancel') {
              return { success: false, newRecords: [], conflictsFound, message: `在 [${fullDateTime}] 發現撞期，排課終止。` };
            }
          }

          newRecords.push({
            id: `auto-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            sid,
            date: dateStr,
            time: slot.time,
            lessonType: slot.lessonType || '1v1',
            roomType: slot.roomType || 'small',
            status: 'confirmed'
          });
          scheduledCount++;
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      success: true,
      newRecords,
      conflictsFound,
      hitMaxLimit,
      message: hitMaxLimit 
        ? `因 3 個月 (12週) 權限限制，已預排 ${newRecords.length} 堂課，剩餘 ${credits - newRecords.length} 堂需由 Daisy 管理員審查。`
        : `成功依規則自動排入 ${newRecords.length} 堂課程！`
    };
  }
}

// ==========================================
// 2. 系統型別宣告
// ==========================================
interface TeacherProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  color: string;
  bgLight: string;
  border: string;
  text: string;
  priorityText: string;
  isActive: boolean;
}

interface BookingItem {
  id: string;
  date: string;
  startHour: number;
  startMin: number;
  durationMins: number;
  teacherId: string;
  studentName?: string;
  studentId?: string;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
  status: 'confirmed' | 'cancelled_normal' | 'special_pending' | 'special_approved' | 'special_rejected';
  signed?: boolean;
  signatureData?: string;
  signedAt?: string;
  reason?: string;
  teacherNote?: string;
}

interface ReviewItem {
  id: string;
  bookingId: string;
  teacherId: string;
  teacherName: string;
  date: string;
  time: string;
  room: string;
  lessonType: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  phone: string;
}

interface StudentRule {
  id: string;
  freq: string;
  day: string;
  time: string;
  startDate: string;
  roomType: 'large' | 'small';
  lessonType: '1v1' | '1v2';
}

interface PurchaseRecord {
  id: string;
  date: string;
  credits: number;
  amountText: string;
}

interface StudentItem {
  id: string;
  name: string;
  phone: string;
  teacherId: string;
  note: string;
  credits: number;
  lessonType: '1v1' | '1v2';
  isTrial: boolean;
  noRegularRule: boolean;
  rules: StudentRule[];
  status: 'active' | 'archived';
  nextLesson?: string;
  purchases: PurchaseRecord[];
}

interface AuditLogItem {
  id: string;
  time: string;
  actor: string;
  action: string;
  category: 'red' | 'yellow' | 'normal';
  read: boolean;
  teacherId?: string;
  reviewId?: string;
}

const PRESET_COLORS = [
  { label: '琥珀', color: 'bg-amber-400',  bgLight: 'bg-amber-50',  border: 'border-amber-400',  text: 'text-amber-700',  dot: '#f59e0b' },
  { label: '橙色', color: 'bg-orange-400', bgLight: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700', dot: '#f97316' },
  { label: '萊姆', color: 'bg-lime-500',   bgLight: 'bg-lime-50',   border: 'border-lime-500',   text: 'text-lime-700',   dot: '#84cc16' },
  { label: '翠綠', color: 'bg-teal-400',   bgLight: 'bg-teal-50',   border: 'border-teal-400',   text: 'text-teal-700',   dot: '#2dd4bf' },
  { label: '天藍', color: 'bg-sky-400',    bgLight: 'bg-sky-50',    border: 'border-sky-400',    text: 'text-sky-700',    dot: '#38bdf8' },
  { label: '靛藍', color: 'bg-indigo-400', bgLight: 'bg-indigo-50', border: 'border-indigo-400', text: 'text-indigo-700', dot: '#6366f1' },
  { label: '紫色', color: 'bg-violet-400', bgLight: 'bg-violet-50', border: 'border-violet-400', text: 'text-violet-700', dot: '#8b5cf6' },
] as const;

const TEACHER_COLORS = {
  daisy: { color: 'bg-amber-400', bgLight: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700' },
  abby: { color: 'bg-sky-400', bgLight: 'bg-sky-50', border: 'border-sky-400', text: 'text-sky-700' },
  tanya: { color: 'bg-indigo-400', bgLight: 'bg-indigo-50', border: 'border-indigo-400', text: 'text-indigo-700' },
  tata: { color: 'bg-teal-400', bgLight: 'bg-teal-50', border: 'border-teal-400', text: 'text-teal-700' }
};

const INITIAL_TEACHERS: Record<string, TeacherProfile> = {
  't-daisy': { id: 't-daisy', name: 'Daisy', email: 'daisy@inlovepilates.com', phone: '0900-000-000', ...TEACHER_COLORS.daisy, priorityText: '全時段保留', isActive: true },
  't-1': { id: 't-1', name: 'Abby', email: 'abby@inlovepilates.com', phone: '0912-345-678', ...TEACHER_COLORS.abby, priorityText: '週二、四 早/中', isActive: true },
  't-2': { id: 't-2', name: 'Tanya', email: 'tanya@inlovepilates.com', phone: '0987-654-321', ...TEACHER_COLORS.tanya, priorityText: '週一、三、五 晚', isActive: true },
  't-3': { id: 't-3', name: 'Tata', email: 'tata@inlovepilates.com', phone: '0922-333-444', ...TEACHER_COLORS.tata, priorityText: '週三、五 早', isActive: true },
};

const INITIAL_STUDENTS: StudentItem[] = [
  {
    id: 's-1',
    name: 'ann',
    phone: '0911-222-333',
    teacherId: 't-daisy',
    note: '腰椎 L4-L5 突出，避免過度前屈',
    credits: 24,
    lessonType: '1v1',
    isTrial: false,
    noRegularRule: false,
    rules: [{ id: 'r1', freq: '每週', day: '一', time: '09:00', startDate: '2026-10-19', roomType: 'small', lessonType: '1v1' }],
    status: 'active',
    nextLesson: '10/19 09:00',
    purchases: [{ id: 'p1', date: '2026-10-01', credits: 30, amountText: '首次購課 30 堂 ($66,000)' }]
  },
  {
    id: 's-2',
    name: '王小美',
    phone: '0988-777-666',
    teacherId: 't-1',
    note: '膝蓋舊傷，產後修復中',
    credits: 4,
    lessonType: '1v1',
    isTrial: false,
    noRegularRule: false,
    rules: [{ id: 'r2', freq: '每週', day: '五', time: '14:00', startDate: '2026-10-16', roomType: 'small', lessonType: '1v1' }],
    status: 'active',
    nextLesson: '10/16 14:00',
    purchases: [{ id: 'p2', date: '2026-09-01', credits: 10, amountText: '續約加購 10 堂 ($24,000)' }]
  },
  {
    id: 's-3',
    name: '林依晨',
    phone: '0933-444-555',
    teacherId: 't-1',
    note: '體驗課，專攻核心控制',
    credits: 1,
    lessonType: '1v1',
    isTrial: true,
    noRegularRule: true,
    rules: [],
    status: 'active',
    nextLesson: '10/20 10:00',
    purchases: [{ id: 'p3', date: '2026-10-14', credits: 1, amountText: '體驗課 1 堂 ($1,500)' }]
  },
  {
    id: 's-4',
    name: '陳大同',
    phone: '0955-666-777',
    teacherId: 't-1',
    note: '已搬家至台北',
    credits: 0,
    lessonType: '1v2',
    isTrial: false,
    noRegularRule: true,
    rules: [],
    status: 'archived',
    nextLesson: '已結業',
    purchases: [{ id: 'p4', date: '2026-06-01', credits: 20, amountText: '結業課程' }]
  }
];

const INITIAL_BOOKINGS: BookingItem[] = [
  { id: 'b-overdue1', date: '2026-10-12', startHour: 10, startMin: 0, durationMins: 50, teacherId: 't-1', studentName: '王小美', studentId: 's-2', roomType: 'small', lessonType: '1v1', status: 'confirmed', signed: false, teacherNote: '腰椎控制良好' },
  { id: 'b1', date: '2026-10-16', startHour: 9, startMin: 0, durationMins: 50, teacherId: 't-1', studentName: '王小美', studentId: 's-2', roomType: 'large', lessonType: '1v1', status: 'confirmed', signed: true, signatureData: '王小美', signedAt: '2026-10-16 09:55', teacherNote: 'Reformer 控制練習' },
  { id: 'b2', date: '2026-10-16', startHour: 11, startMin: 0, durationMins: 50, teacherId: 't-2', studentName: '張小姐', studentId: 's-3', roomType: 'small', lessonType: '1v2', status: 'confirmed', signed: false },
  { id: 'b3', date: '2026-10-16', startHour: 14, startMin: 30, durationMins: 50, teacherId: 't-daisy', studentName: 'ann', studentId: 's-1', roomType: 'large', lessonType: '1v1', status: 'confirmed', signed: false },
  { id: 'b4', date: '2026-10-16', startHour: 10, startMin: 0, durationMins: 50, teacherId: 't-1', studentName: '李教授', roomType: 'large', lessonType: '1v2', status: 'special_approved', reason: '發燒看診' },
  { id: 'b5', date: '2026-10-20', startHour: 14, startMin: 0, durationMins: 50, teacherId: 't-1', studentName: '林依晨', studentId: 's-3', roomType: 'large', lessonType: '1v2', status: 'confirmed', signed: false },
  { id: 'b6', date: '2026-10-12', startHour: 14, startMin: 0, durationMins: 50, teacherId: 't-1', studentName: '王小美', studentId: 's-2', roomType: 'small', lessonType: '1v1', status: 'cancelled_normal' },
  { id: 'b7', date: '2026-10-14', startHour: 10, startMin: 30, durationMins: 50, teacherId: 't-1', studentName: 'ann', studentId: 's-1', roomType: 'large', lessonType: '1v1', status: 'confirmed', signed: true, signatureData: 'ann', signedAt: '2026-10-14 11:22', teacherNote: '核心訓練加強' }
];

const INITIAL_REVIEWS: ReviewItem[] = [
  { id: 'rev-1', bookingId: 'b9', teacherId: 't-1', teacherName: 'Abby', date: '2026-10-16', time: '10/16 16:00', room: '小教室', lessonType: '1v1', reason: '小孩發燒急診', status: 'pending', phone: '0912-345-678' }
];

const INITIAL_LOGS: AuditLogItem[] = [
  { id: 'log-1', time: '10/18 14:30', actor: '系統自動調度', action: '雙教室調度：1v2 課程優先排入大教室，Daisy 1v1 調位小教室', category: 'yellow', read: false, teacherId: 't-daisy' },
  { id: 'log-2', time: '10/16 10:00', actor: 'Abby 老師', action: '學員 [王小美] 完成 10/16 09:00 課程手寫簽到扣堂', category: 'normal', read: true, teacherId: 't-1' },
  { id: 'log-3', time: '10/15 16:20', actor: 'Daisy (管理者)', action: '核准 Abby 特殊請假 (發燒看診) 為免罰', category: 'red', read: true, teacherId: 't-1', reviewId: 'rev-prev' }
];

const formatTimeStr = (h: number, m: number) => {
  const totalM = h * 60 + m;
  const realH = Math.floor(totalM / 60);
  const realM = totalM % 60;
  return `${realH < 10 ? '0' + realH : realH}:${realM < 10 ? '0' + realM : realM}`;
};

const getStatusBadge = (status: BookingItem['status']) => {
  switch (status) {
    case 'confirmed':
      return <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[11px] font-bold border border-emerald-200">預約成立</span>;
    case 'cancelled_normal':
      return <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-200">一般取消</span>;
    case 'special_pending':
      return <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-300">特殊待審</span>;
    case 'special_approved':
      return <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-bold border border-indigo-200">特殊免罰</span>;
    case 'special_rejected':
      return <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded text-[11px] font-bold border border-rose-200">特殊計罰</span>;
    default:
      return <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[11px]">預約成立</span>;
  }
};

// ==========================================
// 3. 手寫簽名板組件 (HTML5 Canvas SignaturePad)
// ==========================================
function SignatureModal({
  isOpen,
  onClose,
  onSave,
  studentName
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
  studentName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasDrawn(false);
      }
    }
  }, [isOpen]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    setHasDrawn(true);
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.beginPath(); ctx.moveTo(x, y); }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.lineTo(x, y); ctx.stroke(); }
  };

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); setHasDrawn(false); }
  };

  const handleConfirm = () => {
    if (!hasDrawn || !canvasRef.current) {
      alert('請先在手寫板完成簽名');
      return;
    }
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSave(dataUrl);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 animate-in fade-in zoom-in-95">
        <div className="flex justify-between items-center border-b pb-2">
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
              <PenTool className="w-4 h-4 text-rose-500" /> 手寫簽到核簽
            </h3>
            <p className="text-[11px] text-slate-400">學員：{studentName}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-1 bg-slate-50 flex flex-col items-center justify-center relative touch-none">
          <canvas
            ref={canvasRef}
            width={320}
            height={160}
            className="w-full h-40 bg-white rounded-xl cursor-crosshair"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={() => setIsDrawing(false)}
            onMouseLeave={() => setIsDrawing(false)}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={() => setIsDrawing(false)}
          />
          {!hasDrawn && (
            <span className="absolute text-slate-300 text-xs pointer-events-none font-bold">
              請在此區手寫簽名
            </span>
          )}
        </div>

        <div className="flex justify-between items-center pt-1 gap-2">
          <button onClick={clearCanvas} className="text-xs text-slate-500 hover:text-slate-800 px-3 py-2 rounded-xl bg-slate-100 font-bold">
            清除重寫
          </button>
          <div className="flex gap-2 flex-1">
            <button onClick={onClose} className="flex-1 bg-slate-100 py-2.5 rounded-xl text-xs font-bold text-slate-600">
              取消
            </button>
            <button onClick={handleConfirm} className="flex-1 bg-rose-500 text-white py-2.5 rounded-xl text-xs font-bold shadow-xs">
              確認簽名扣堂
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 4. 主頁面 (Home Component)
// ==========================================
export default function Home() {
  const [userRole, setUserRole] = useState<'admin' | 'teacher'>('admin');
  const currentUserId = userRole === 'admin' ? 't-daisy' : 't-1';

  const [activeTab, setActiveTab] = useState<number>(1);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [isCreateStudentOpen, setIsCreateStudentOpen] = useState(false);

  const [priorityGrid, setPriorityGrid] = useState<Record<string, string>>({
    '一-8': 't-1', '一-9': 't-1',
    '二-14': 't-1', '二-15': 't-1',
    '三-18': 't-2', '三-19': 't-2',
    '五-9': 't-3', '五-10': 't-3',
  });

  const [teachers, setTeachers] = useState<Record<string, TeacherProfile>>(INITIAL_TEACHERS);
  const [students, setStudents] = useState<StudentItem[]>(INITIAL_STUDENTS);
  const [bookings, setBookings] = useState<BookingItem[]>(INITIAL_BOOKINGS);
  const [reviews, setReviews] = useState<ReviewItem[]>(INITIAL_REVIEWS);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(INITIAL_LOGS);
  const [studioRules, setStudioRules] = useState<string>(
    `1. 上課結束後，請協助消毒器械並將 Footbar 調至自下數第三格。\n2. 大教室優先供 1v2 雙人課程使用。\n3. 自主訓練僅得於授課前 30 分鐘內進場。`
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const addAuditLog = (action: string, category: 'red' | 'yellow' | 'normal' = 'normal', teacherId?: string, reviewId?: string) => {
    const newLog: AuditLogItem = {
      id: `log-${Date.now()}`,
      time: '10/18 21:05',
      actor: userRole === 'admin' ? 'Daisy (管理者)' : `${teachers[currentUserId]?.name} 老師`,
      action,
      category,
      read: false,
      teacherId: teacherId || currentUserId,
      reviewId
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  const handleReview = (reviewId: string, newStatus: 'approved' | 'rejected') => {
    const rev = reviews.find(r => r.id === reviewId);
    setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: newStatus } : r));

    if (rev && rev.bookingId) {
      setBookings(prev => prev.map(b => {
        if (b.id === rev.bookingId) {
          return { ...b, status: newStatus === 'approved' ? 'special_approved' : 'special_rejected' };
        }
        return b;
      }));
    }
    const actStr = newStatus === 'approved' ? `核准 ${rev?.teacherName} 特殊請假 (免罰)` : `退回 ${rev?.teacherName} 特殊請假 (計罰)`;
    addAuditLog(actStr, 'red', rev?.teacherId, reviewId);
    showToast(newStatus === 'approved' ? '已核准免罰並記錄於 Log' : '已退回計罰並記錄於 Log');
  };

  const handleResetReview = (reviewId: string) => {
    const rev = reviews.find(r => r.id === reviewId);
    setReviews(reviews.map(r => r.id === reviewId ? { ...r, status: 'pending' } : r));
    if (rev && rev.bookingId) {
      setBookings(prev => prev.map(b => b.id === rev.bookingId ? { ...b, status: 'special_pending' } : b));
    }
    addAuditLog(`撤銷請假審核結果 (Undo)：${rev?.teacherName}`, 'red', rev?.teacherId);
    showToast('已撤銷審核結果');
  };

  const handleSignBooking = (bookingId: string, signatureDataUrl: string) => {
    const nowTimeStr = '2026-10-18 21:10';
    let stdName = '';
    let remainingCredits = 0;

    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) {
        stdName = b.studentName || '學員';
        if (b.studentId) {
          setStudents(sList => sList.map(s => {
            if (s.id === b.studentId) {
              remainingCredits = Math.max(0, s.credits - 1);
              return { ...s, credits: remainingCredits };
            }
            return s;
          }));
        }
        return { ...b, signed: true, signatureData: signatureDataUrl, signedAt: nowTimeStr };
      }
      return b;
    }));
    addAuditLog(`完成課堂手寫簽名扣堂 (預約: ${bookingId})`, 'normal', currentUserId);
    showToast(`簽名完成！已扣除 1 堂，[${stdName}] 剩餘 ${remainingCredits} 堂`);
  };

  const handleUpdateBookingNote = (bookingId: string, note: string) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, teacherNote: note } : b));
    showToast('上課狀況備註已儲存');
  };

  // 請假自動順延機制 (嚴格實施 3 個月邊界防呆)
  const handleStudentLeaveWithExtension = (booking: BookingItem) => {
    const targetStudent = students.find(s => s.id === booking.studentId || s.name === booking.studentName);
    
    // 1. 將當前課堂標示為取消 (不扣堂數)
    setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: 'cancelled_normal' } : b));

    // 2. 特殊例外檢查：體驗課或無排課規則者不自動順延
    if (!targetStudent || targetStudent.isTrial || targetStudent.noRegularRule || !targetStudent.rules || targetStudent.rules.length === 0) {
      addAuditLog(`學員 [${booking.studentName}] 請假取消，無固定規則不自動補排`, 'red', booking.teacherId);
      showToast(`已為 [${booking.studentName}] 請假登記，因無固定規則不補排`);
      return;
    }

    // 3. 搜尋該學生最遠的一堂有效預排課
    const studentPlannedBookings = bookings.filter(b => 
      (b.studentId === targetStudent.id || b.studentName === targetStudent.name) &&
      b.status === 'confirmed' &&
      b.id !== booking.id
    ).sort((a, b) => b.date.localeCompare(a.date));

    const latestDateStr = studentPlannedBookings.length > 0 ? studentPlannedBookings[0].date : booking.date;
    const rule = targetStudent.rules[0];
    
    // 計算下一個週期 (+7天 或 +14天)
    const baseDate = new Date(`${latestDateStr}T00:00:00`);
    baseDate.setDate(baseDate.getDate() + (rule.freq === '隔週' ? 14 : 7));
    
    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, '0');
    const day = String(baseDate.getDate()).padStart(2, '0');
    const newTailDateStr = `${year}-${month}-${day}`;

    // 4. 三個月 (90天) 上限邊界防呆
    const today = new Date('2026-10-18T00:00:00');
    const diffDays = Math.round((baseDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 90) {
      addAuditLog(`學員 [${targetStudent.name}] 請假順延超過 3 個月 (${newTailDateStr})，終止自動排課並送審`, 'red', booking.teacherId);
      alert(`⚠️ 順延日期 (${newTailDateStr}) 已超過一般老師 3 個月排課限制，系統將不自動補排，需由管理員 Daisy 審核。`);
      return;
    }

    // 5. 於隊尾補排一堂全新的預定課程
    const newTailBooking: BookingItem = {
      id: `b-ext-${Date.now()}`,
      date: newTailDateStr,
      startHour: parseInt(rule.time.split(':')[0]) || 9,
      startMin: parseInt(rule.time.split(':')[1]) || 0,
      durationMins: 50,
      teacherId: booking.teacherId,
      studentName: targetStudent.name,
      studentId: targetStudent.id,
      roomType: rule.roomType || 'small',
      lessonType: rule.lessonType || '1v1',
      status: 'confirmed',
      teacherNote: '系統自動順延補課'
    };

    setBookings(prev => [...prev, newTailBooking]);
    addAuditLog(`學員 [${targetStudent.name}] 請假，已自動順延補排至 ${newTailDateStr} ${rule.time}`, 'normal', booking.teacherId);
    showToast(`請假成功！已自動順延補排至 ${newTailDateStr} ${rule.time} (不扣堂)`);
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 w-full flex flex-col justify-center items-center py-0 md:py-4">
      {/* 修正容器高度溢出問題，確保子層可正常滑動 */}
      <div className="flex flex-col h-screen md:h-[94vh] max-h-screen md:max-h-[960px] w-full max-w-md md:max-w-3xl lg:max-w-4xl xl:max-w-5xl bg-slate-50 shadow-2xl relative border-x md:border border-slate-200 md:rounded-2xl overflow-hidden font-sans">
        
        {/* 全域 Toast 通知 */}
        {toastMsg && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-white text-xs px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="font-bold">{toastMsg}</span>
          </div>
        )}

        {/* 頂部 Header & 角色切換鈕 */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex justify-between items-center shrink-0 shadow-xs z-20">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">InLovePilates</h1>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-black ${
                userRole === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
              }`}>
                {userRole === 'admin' ? 'Daisy (管理者)' : `${teachers[currentUserId]?.name} (一般老師)`}
              </span>
            </div>
          </div>

          <button 
            onClick={() => {
              const nextRole = userRole === 'admin' ? 'teacher' : 'admin';
              setUserRole(nextRole);
              setActiveTab(1);
              setSelectedTeacherId(null);
              setSelectedStudentId(null);
            }}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-xl font-bold transition shadow-xs flex items-center gap-1.5 active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
            <span>切換為 {userRole === 'admin' ? 'Abby 視角' : 'Daisy 視角'}</span>
          </button>
        </header>

        {/* 主內容區域：加入 min-h-0 與 -webkit 慣性滑動修復滑動鎖死 */}
        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 pb-28 bg-slate-50/50 overscroll-contain">
          {activeTab === 1 && (
            <Tab1Calendar 
              userRole={userRole} 
              currentUserId={currentUserId} 
              teachers={teachers} 
              students={students}
              bookings={bookings}
              setBookings={setBookings}
              showToast={showToast}
              onNotify={(msg, cat) => addAuditLog(msg, cat || 'yellow', currentUserId)}
              onSignBooking={handleSignBooking}
              onUpdateBookingNote={handleUpdateBookingNote}
              onStudentLeave={handleStudentLeaveWithExtension}
              onSelectStudent={(sName) => {
                const matched = students.find(s => s.name === sName);
                if (matched) {
                  setSelectedStudentId(matched.id);
                  setActiveTab(3);
                } else {
                  showToast(`未找到 ${sName} 的學員檔案`);
                }
              }}
            />
          )}

          {activeTab === 2 && (
            <Tab2PersonalSchedule 
              userRole={userRole}
              currentUserId={currentUserId}
              teachers={teachers}
              bookings={bookings}
              setBookings={setBookings}
              onSignBooking={handleSignBooking}
              onUpdateBookingNote={handleUpdateBookingNote}
              onAddReview={(rev) => setReviews(prev => [rev, ...prev])}
              onAddLog={addAuditLog}
              showToast={showToast}
              onStudentLeave={handleStudentLeaveWithExtension}
              onSelectStudent={(sName) => {
                const matched = students.find(s => s.name === sName);
                if (matched) {
                  setSelectedStudentId(matched.id);
                  setActiveTab(3);
                } else {
                  showToast(`未找到 ${sName} 的學員檔案`);
                }
              }}
            />
          )}

          {activeTab === 3 && (
            selectedStudentId ? (
              <StudentDetailView 
                student={students.find(s => s.id === selectedStudentId)!}
                onBack={() => setSelectedStudentId(null)}
                bookings={bookings}
                teachers={teachers}
                onUpdateStudent={(updated) => setStudents(students.map(s => s.id === updated.id ? updated : s))}
                onSignBooking={handleSignBooking}
                onUpdateBookingNote={handleUpdateBookingNote}
                onAddBookings={(newBks) => setBookings(prev => [...prev, ...newBks])}
                showToast={showToast}
              />
            ) : (
              <Tab3StudentManagement 
                currentUserId={currentUserId}
                students={students}
                setStudents={setStudents}
                onSelectStudent={(sId) => setSelectedStudentId(sId)}
                onOpenCreate={() => setIsCreateStudentOpen(true)}
              />
            )
          )}
          
          {activeTab === 4 && (
            selectedTeacherId ? (
              <TeacherDetailView 
                teacher={teachers[selectedTeacherId]} 
                onBack={() => setSelectedTeacherId(null)}
                bookings={bookings}
                onUpdateTeacher={(updated) => setTeachers({ ...teachers, [updated.id]: updated })}
              />
            ) : (
              <Tab4TeachersAndStats 
                userRole={userRole}
                currentUserId={currentUserId}
                teachers={teachers}
                setTeachers={setTeachers}
                bookings={bookings}
                reviews={reviews}
                onReview={handleReview}
                onReset={handleResetReview}
                onSelectTeacher={(id) => setSelectedTeacherId(id)}
              />
            )
          )}

          {activeTab === 5 && (
            <Tab5RulesAndPriority 
              userRole={userRole} 
              currentUserId={currentUserId}
              teachers={teachers}
              priorityGrid={priorityGrid}
              onUpdatePriorityGrid={(newGrid) => setPriorityGrid(newGrid)}
              reviews={reviews}
              onReview={handleReview}
              onReset={handleResetReview}
              auditLogs={auditLogs}
              setAuditLogs={setAuditLogs}
              studioRules={studioRules}
              setStudioRules={setStudioRules}
              showToast={showToast}
            />
          )}
        </main>

        {/* 底部導覽列 */}
        <nav className="absolute bottom-0 left-0 right-0 w-full bg-white/95 backdrop-blur-md border-t border-slate-200 py-2 px-1 flex justify-around items-center z-20 shadow-lg shrink-0">
          <button 
            onClick={() => { setActiveTab(1); setSelectedTeacherId(null); setSelectedStudentId(null); }}
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 1 ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <CalendarIcon className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">排班總覽</span>
          </button>

          <button 
            onClick={() => { setActiveTab(2); setSelectedTeacherId(null); setSelectedStudentId(null); }}
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 2 ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <BookOpen className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">個人課表</span>
          </button>

          <button 
            onClick={() => { setActiveTab(3); setSelectedTeacherId(null); setSelectedStudentId(null); }}
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 3 ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <UserIcon className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">學生管理</span>
          </button>

          <button 
            onClick={() => { setActiveTab(4); setSelectedTeacherId(null); setSelectedStudentId(null); }}
            className={`flex flex-col items-center flex-1 py-1 transition ${activeTab === 4 ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">老師與統計</span>
          </button>

          <button 
            onClick={() => { setActiveTab(5); setSelectedTeacherId(null); setSelectedStudentId(null); }}
            className={`flex flex-col items-center flex-1 py-1 relative transition ${activeTab === 5 ? 'text-rose-500 font-black' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <div className="relative">
              <FileText className="w-5 h-5 mb-0.5" />
              {auditLogs.some(l => !l.read && (userRole === 'admin' || l.teacherId === currentUserId)) && (
                <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white animate-pulse" />
              )}
            </div>
            <span className="text-[10px]">{userRole === 'admin' ? '規範與Log' : '規範與審核'}</span>
          </button>
        </nav>

        {/* 建立學生檔案彈窗 Modal */}
        <CreateStudentModal 
          isOpen={isCreateStudentOpen}
          onClose={() => setIsCreateStudentOpen(false)}
          currentTeacherId={currentUserId}
          existingBookings={bookings}
          onSave={(newStudent, generatedNewBookings, engineMsg) => {
            setStudents([newStudent, ...students]);
            if (generatedNewBookings && generatedNewBookings.length > 0) {
              setBookings(prev => [...prev, ...generatedNewBookings]);
            }
            addAuditLog(`建立學員檔案：${newStudent.name}`, 'normal', currentUserId);
            showToast(engineMsg || `已建立學員檔案：${newStudent.name}`);
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
   Tab 1: 排班總覽 (日/月曆卡片操作、嚴格權限防呆、備註即時編輯、直達學生內頁)
   ========================================================================= */
function Tab1Calendar({ 
  userRole, 
  currentUserId, 
  teachers, 
  students,
  bookings,
  setBookings,
  showToast,
  onNotify,
  onSignBooking,
  onUpdateBookingNote,
  onStudentLeave,
  onSelectStudent
}: { 
  userRole: 'admin' | 'teacher'; 
  currentUserId: string;
  teachers: Record<string, TeacherProfile>;
  students: StudentItem[];
  bookings: BookingItem[];
  setBookings: React.Dispatch<React.SetStateAction<BookingItem[]>>;
  showToast: (msg: string) => void;
  onNotify: (msg: string, cat?: 'red' | 'yellow' | 'normal') => void;
  onSignBooking: (bId: string, sig: string) => void;
  onUpdateBookingNote: (bId: string, note: string) => void;
  onStudentLeave: (b: BookingItem) => void;
  onSelectStudent: (sName: string) => void;
}) {
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('day');
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(10);
  const [selectedDayNum, setSelectedDayNum] = useState<number>(16);
  const [weekOffset, setWeekOffset] = useState<number>(0);

  const TODAY_STR = '2026-10-16';

  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [modalForm, setModalForm] = useState({
    date: '2026-10-16',
    hour: '10',
    minute: '00',
    teacherId: currentUserId,
    studentName: students[0]?.name || '王小美',
    lessonType: '1v1' as '1v1' | '1v2',
    roomType: 'small' as 'large' | 'small'
  });

  const [selectedBookingForManage, setSelectedBookingForManage] = useState<BookingItem | null>(null);
  const [activeSignModal, setActiveSignModal] = useState<{ id: string; studentName: string } | null>(null);

  const hoursList = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const minutesList = ['00', '10', '20', '30', '40', '50'];

  const WEEK_SLOT_HEIGHT = 10;
  const WEEK_HOUR_HEIGHT = 60;
  const DAY_SLOT_HEIGHT = 14;
  const DAY_HOUR_HEIGHT = 84;

  const handlePrev = () => {
    if (viewMode === 'month') {
      if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear(currentYear - 1); }
      else { setCurrentMonth(currentMonth - 1); }
    } else if (viewMode === 'week') {
      setWeekOffset(weekOffset - 1);
    } else {
      if (selectedDayNum > 1) setSelectedDayNum(selectedDayNum - 1);
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear(currentYear + 1); }
      else { setCurrentMonth(currentMonth + 1); }
    } else if (viewMode === 'week') {
      setWeekOffset(weekOffset + 1);
    } else {
      if (selectedDayNum < 31) setSelectedDayNum(selectedDayNum + 1);
    }
  };

  const handleOpenQuickBooking = (h: number, mStr: string, room: 'large' | 'small', day?: number) => {
    const hStr = h < 10 ? `0${h}` : `${h}`;
    const targetDay = day ?? selectedDayNum;
    setModalForm({
      date: `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
      hour: hStr,
      minute: mStr,
      teacherId: currentUserId,
      studentName: students[0]?.name || '王小美',
      lessonType: room === 'large' ? '1v2' : '1v1',
      roomType: room
    });
    setIsBookingModalOpen(true);
  };

  const checkConflict = (targetBooking: any) => {
    const tStart = targetBooking.startHour * 60 + targetBooking.startMin;
    const tEnd = tStart + targetBooking.durationMins;

    return bookings.some(b => {
      if (b.id === targetBooking.id) return false;
      if (b.date !== targetBooking.date) return false;
      if (b.roomType !== targetBooking.roomType) return false;
      if (b.status === 'cancelled_normal' || b.status === 'special_approved' || b.status === 'special_rejected') return false;

      const bStart = b.startHour * 60 + b.startMin;
      const bEnd = bStart + b.durationMins;
      return tStart < bEnd && bStart < tEnd;
    });
  };

  const handleConfirmNewBooking = () => {
    const targetHour = parseInt(modalForm.hour);
    const targetMin = parseInt(modalForm.minute);
    let targetRoom = modalForm.roomType;

    if (modalForm.lessonType === '1v2') {
      const hasLargeConflict = checkConflict({
        date: modalForm.date,
        startHour: targetHour,
        startMin: targetMin,
        durationMins: 50,
        roomType: 'large'
      });

      if (!hasLargeConflict) {
        targetRoom = 'large';
      } else {
        const daisy1v1 = bookings.find(b => 
          b.date === modalForm.date &&
          b.roomType === 'large' &&
          b.teacherId === 't-daisy' &&
          b.lessonType === '1v1' &&
          b.startHour === targetHour &&
          b.startMin === targetMin &&
          b.status === 'confirmed'
        );

        if (daisy1v1) {
          const smallRoomConflict = checkConflict({
            date: modalForm.date,
            startHour: targetHour,
            startMin: targetMin,
            durationMins: 50,
            roomType: 'small'
          });

          if (!smallRoomConflict) {
            const updated = bookings.map(b => b.id === daisy1v1.id ? { ...b, roomType: 'small' as const } : b);
            const newBk: BookingItem = {
              id: `b-${Date.now()}`,
              date: modalForm.date,
              startHour: targetHour,
              startMin: targetMin,
              durationMins: 50,
              teacherId: modalForm.teacherId,
              studentName: modalForm.studentName,
              roomType: 'large',
              lessonType: '1v2',
              status: 'confirmed'
            };
            setBookings([...updated, newBk]);
            setIsBookingModalOpen(false);
            onNotify(`雙教室調度：1v2 課程自動排入大教室，Daisy 1v1 已改至小教室`, 'yellow');
            showToast('Daisy 已讓位至小教室，1v2 自動排入大教室！');
            return;
          }
        }
        alert('大教室該時段已被預約，請選擇其他時段！');
        return;
      }
    } else {
      const hasConflict = checkConflict({
        date: modalForm.date,
        startHour: targetHour,
        startMin: targetMin,
        durationMins: 50,
        roomType: targetRoom
      });

      if (hasConflict) {
        alert('該教室在該時段已有其他預約，請選擇其他時段！');
        return;
      }
    }

    const matchedStd = students.find(s => s.name === modalForm.studentName);
    const newBk: BookingItem = {
      id: `b-${Date.now()}`,
      date: modalForm.date,
      startHour: targetHour,
      startMin: targetMin,
      durationMins: 50,
      teacherId: modalForm.teacherId,
      studentName: modalForm.studentName,
      studentId: matchedStd?.id,
      roomType: targetRoom,
      lessonType: modalForm.lessonType,
      status: 'confirmed'
    };
    setBookings(prev => [...prev, newBk]);
    setIsBookingModalOpen(false);
    showToast(`預約成功：已排入 ${targetRoom === 'large' ? '大教室' : '小教室'}`);
  };

  const currentDateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(selectedDayNum).padStart(2, '0')}`;
  const isSelectedDatePast = currentDateStr < TODAY_STR;
  const activeDayBookings = bookings.filter(b => b.date === currentDateStr && (b.status === 'confirmed' || b.status === 'special_pending'));

  const weekDays = useMemo(() => {
    const baseDate = new Date(2026, 9, 12);
    baseDate.setDate(baseDate.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const dateKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
      return {
        dateKey,
        dayNum: day,
        label: `${m}/${day} (${dayNames[d.getDay()]})`,
        isPast: dateKey < TODAY_STR,
        isToday: dateKey === TODAY_STR
      };
    });
  }, [weekOffset]);

  // 權限檢查：是否為該卡片的授課老師
  const isCardOwner = selectedBookingForManage ? selectedBookingForManage.teacherId === currentUserId : false;

  return (
    <div className="space-y-4">
      {/* 頂部切換鈕 */}
      <div className="flex justify-between items-center bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600">
          <button onClick={() => setViewMode('month')} className={`px-4 py-1.5 rounded-lg transition ${viewMode === 'month' ? 'bg-white text-rose-600 shadow-xs font-black' : ''}`}>月</button>
          <button onClick={() => setViewMode('week')} className={`px-4 py-1.5 rounded-lg transition ${viewMode === 'week' ? 'bg-white text-rose-600 shadow-xs font-black' : ''}`}>週</button>
          <button onClick={() => setViewMode('day')} className={`px-4 py-1.5 rounded-lg transition ${viewMode === 'day' ? 'bg-white text-rose-600 shadow-xs font-black' : ''}`}>日</button>
        </div>

        <button 
          onClick={() => {
            setModalForm({ 
              date: currentDateStr, 
              hour: '10', 
              minute: '00', 
              teacherId: currentUserId, 
              studentName: students[0]?.name || '王小美',
              lessonType: '1v1', 
              roomType: 'small' 
            });
            setIsBookingModalOpen(true);
          }}
          className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs transition active:scale-95"
        >
          <Plus className="w-4 h-4" /> 
          <span>預約教室</span>
        </button>
      </div>

      {/* 日期切換列 */}
      <div className="flex justify-between items-center bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-xs text-xs sm:text-sm font-black text-slate-800">
        <button onClick={handlePrev} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        <div className="text-center font-mono">
          {viewMode === 'month' && <span>{currentYear} 年 {currentMonth} 月</span>}
          {viewMode === 'week' && <span>{weekDays[0].label} ~ {weekDays[6].label}</span>}
          {viewMode === 'day' && (
            <span>
              {currentMonth} 月 {selectedDayNum} 日 (五) {currentDateStr === TODAY_STR ? '• 今日' : isSelectedDatePast ? ' (過去)' : ''}
            </span>
          )}
        </div>

        <button onClick={handleNext} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* 圖例 */}
      <div className="flex justify-end items-center gap-2.5 px-2 text-xs font-bold text-slate-600">
        {Object.values(teachers).map(t => (
          <span key={t.id} className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-full ${t.color}`} /> {t.name}
          </span>
        ))}
      </div>

      {/* 月曆 */}
      {viewMode === 'month' && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 text-xs space-y-3 shadow-xs">
          <div className="grid grid-cols-7 gap-2 text-xs text-slate-400 font-black border-b pb-2 text-center">
            <span className="text-rose-500">日</span>
            <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span>
            <span className="text-indigo-500">六</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 min-h-[300px] text-xs">
            {Array.from({ length: 31 }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const isPast = dateStr < TODAY_STR;
              const isToday = dateStr === TODAY_STR;
              const dayBks = bookings.filter(b => b.date === dateStr && (b.status === 'confirmed' || b.status === 'special_pending' || b.status === 'special_approved'));
              
              const largeBks = dayBks.filter(b => b.roomType === 'large');
              const smallBks = dayBks.filter(b => b.roomType === 'small');
              const maxPerRoom = 6;

              const aggregateTeachers = (list: BookingItem[]) => {
                const map: Record<string, number> = {};
                list.forEach(b => { map[b.teacherId] = (map[b.teacherId] || 0) + 1; });
                return Object.entries(map).map(([teacherId, count]) => ({ teacherId, count }));
              };

              const largeAgg = aggregateTeachers(largeBks);
              const smallAgg = aggregateTeachers(smallBks);

              return (
                <div 
                  key={i} 
                  onClick={() => { setSelectedDayNum(dayNum); setViewMode('day'); }}
                  className={`border rounded-xl p-1 flex flex-col justify-between transition cursor-pointer relative min-h-[64px] ${
                    isPast 
                      ? 'bg-slate-100/70 border-slate-200/60 opacity-60 grayscale' 
                      : 'bg-white border-slate-200 hover:border-rose-400 hover:shadow-xs'
                  } ${isToday ? 'ring-2 ring-rose-500 bg-rose-50/20' : ''}`}
                >
                  <span className={`font-mono text-[11px] leading-tight ${isToday ? 'font-black text-rose-600' : isPast ? 'text-slate-400' : 'text-slate-600 font-semibold'}`}>
                    {dayNum}
                  </span>
                  
                  <div className="flex justify-center gap-1 items-end h-9 pb-0.5 w-full">
                    <div className="w-1.5 bg-slate-200/70 rounded-t-sm flex flex-col-reverse overflow-hidden h-full">
                      {largeAgg.map(({ teacherId, count }) => {
                        const isMine = teacherId === currentUserId;
                        const barColor = userRole === 'admin' || isMine ? (teachers[teacherId]?.color || 'bg-slate-400') : 'bg-slate-300';
                        return <div key={teacherId} style={{ height: `${(count / maxPerRoom) * 100}%` }} className={`w-full ${barColor} shrink-0`} />;
                      })}
                    </div>

                    <div className="w-1.5 bg-slate-200/70 rounded-t-sm flex flex-col-reverse overflow-hidden h-full">
                      {smallAgg.map(({ teacherId, count }) => {
                        const isMine = teacherId === currentUserId;
                        const barColor = userRole === 'admin' || isMine ? (teachers[teacherId]?.color || 'bg-slate-400') : 'bg-slate-300';
                        return <div key={teacherId} style={{ height: `${(count / maxPerRoom) * 100}%` }} className={`w-full ${barColor} shrink-0`} />;
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-100 text-slate-400">
            <span className="text-[11px] font-bold">直條左大右小</span>
            <span className="text-[10px]">過去日期自動灰階顯示</span>
          </div>
        </div>
      )}

      {/* 週檢視 */}
      {viewMode === 'week' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <div className="flex min-w-[640px] md:min-w-full border-b text-center text-xs font-bold bg-slate-50 py-2 divide-x divide-slate-200 sticky top-0 z-20">
              <div className="w-10 text-slate-400 shrink-0 flex items-center justify-center font-mono">時</div>
              {weekDays.map((item, idx) => (
                <div key={idx} className={`flex-1 px-1 ${item.isToday ? 'text-rose-600 bg-rose-50/50 font-black' : item.isPast ? 'opacity-50 text-slate-400 bg-slate-100/40' : 'text-slate-700'}`}>
                  <div>{item.label}</div>
                  <div className="grid grid-cols-2 text-[9px] text-slate-400 font-medium pt-0.5 border-t border-slate-200/60 mt-0.5">
                    <span>大</span><span>小</span>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex divide-x divide-slate-200 min-w-[640px] md:min-w-full text-xs font-mono relative">
              <div className="w-10 text-slate-400 bg-slate-50/60 shrink-0 font-mono text-[11px] font-bold flex flex-col divide-y divide-slate-100 select-none">
                {hoursList.map(h => (
                  <div key={h} style={{ height: `${WEEK_HOUR_HEIGHT}px` }} className="flex items-center justify-center shrink-0">
                    {h < 10 ? `0${h}` : h}
                  </div>
                ))}
              </div>

              {weekDays.map((item, dIdx) => {
                const dayBks = bookings.filter(b => b.date === item.dateKey && (b.status === 'confirmed' || b.status === 'special_pending'));

                return (
                  <div key={dIdx} className={`flex-1 p-0.5 grid grid-cols-2 gap-0.5 relative ${item.isPast ? 'bg-slate-100/60 grayscale' : 'bg-slate-50/20'}`}>
                    {/* 大教室 */}
                    <div className="relative" style={{ height: `${hoursList.length * WEEK_HOUR_HEIGHT}px` }}>
                      <div className="absolute inset-0 flex flex-col divide-y divide-slate-100">
                        {hoursList.map(h => (
                          <div key={h} style={{ height: `${WEEK_HOUR_HEIGHT}px` }} className="flex flex-col shrink-0">
                            {minutesList.map(mStr => (
                              <button
                                key={mStr}
                                type="button"
                                onClick={() => handleOpenQuickBooking(h, mStr, 'large', item.dayNum)}
                                style={{ height: `${WEEK_SLOT_HEIGHT}px` }}
                                className="w-full border-b border-dotted border-slate-100 hover:bg-rose-50/50 transition cursor-pointer select-none block"
                              />
                            ))}
                          </div>
                        ))}
                      </div>

                      {dayBks.filter(b => b.roomType === 'large').map(b => {
                        const startMinutes = (b.startHour - 8) * 60 + b.startMin;
                        const top = (startMinutes / 10) * WEEK_SLOT_HEIGHT;
                        const height = (b.durationMins / 10) * WEEK_SLOT_HEIGHT;
                        const isMine = b.teacherId === currentUserId;
                        const teacher = teachers[b.teacherId];
                        const startTimeStr = formatTimeStr(b.startHour, b.startMin);

                        return (
                          <div
                            key={b.id}
                            onClick={(e) => { e.stopPropagation(); setSelectedBookingForManage(b); }}
                            style={{ top: `${top + 1}px`, height: `${height - 2}px` }}
                            className={`absolute inset-x-0.5 z-10 rounded-lg p-0.5 shadow-xs overflow-hidden flex flex-col items-center justify-center text-center transition cursor-pointer hover:ring-2 active:scale-95 ${
                              userRole === 'admin' || isMine ? `${teacher?.color || 'bg-sky-400'} text-white` : 'bg-slate-300 text-slate-600'
                            }`}
                          >
                            <span className="text-[10px] font-black truncate leading-tight">
                              {userRole === 'admin' || isMine ? (b.studentName || '學員') : '已被預約'}
                            </span>
                            <span className="text-[8px] font-mono leading-none font-bold opacity-90 my-0.2">
                              {b.lessonType} {startTimeStr}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* 小教室 */}
                    <div className="relative" style={{ height: `${hoursList.length * WEEK_HOUR_HEIGHT}px` }}>
                      <div className="absolute inset-0 flex flex-col divide-y divide-slate-100">
                        {hoursList.map(h => (
                          <div key={h} style={{ height: `${WEEK_HOUR_HEIGHT}px` }} className="flex flex-col shrink-0">
                            {minutesList.map(mStr => (
                              <button
                                key={mStr}
                                type="button"
                                onClick={() => handleOpenQuickBooking(h, mStr, 'small', item.dayNum)}
                                style={{ height: `${WEEK_SLOT_HEIGHT}px` }}
                                className="w-full border-b border-dotted border-slate-100 hover:bg-indigo-50/50 transition cursor-pointer select-none block"
                              />
                            ))}
                          </div>
                        ))}
                      </div>

                      {dayBks.filter(b => b.roomType === 'small').map(b => {
                        const startMinutes = (b.startHour - 8) * 60 + b.startMin;
                        const top = (startMinutes / 10) * WEEK_SLOT_HEIGHT;
                        const height = (b.durationMins / 10) * WEEK_SLOT_HEIGHT;
                        const isMine = b.teacherId === currentUserId;
                        const teacher = teachers[b.teacherId];
                        const startTimeStr = formatTimeStr(b.startHour, b.startMin);

                        return (
                          <div
                            key={b.id}
                            onClick={(e) => { e.stopPropagation(); setSelectedBookingForManage(b); }}
                            style={{ top: `${top + 1}px`, height: `${height - 2}px` }}
                            className={`absolute inset-x-0.5 z-10 rounded-lg p-0.5 shadow-xs overflow-hidden flex flex-col items-center justify-center text-center transition cursor-pointer hover:ring-2 active:scale-95 ${
                              userRole === 'admin' || isMine ? `${teacher?.color || 'bg-indigo-400'} text-white` : 'bg-slate-300 text-slate-600'
                            }`}
                          >
                            <span className="text-[10px] font-black truncate leading-tight">
                              {userRole === 'admin' || isMine ? (b.studentName || '學員') : '已被預約'}
                            </span>
                            <span className="text-[8px] font-mono leading-none font-bold opacity-90 my-0.2">
                              {b.lessonType} {startTimeStr}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 日檢視 */}
      {viewMode === 'day' && (
        <div className={`bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden ${isSelectedDatePast ? 'opacity-75 grayscale' : ''}`}>
          <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-200 text-xs sm:text-sm font-bold text-slate-700 text-center py-2 sticky top-0 z-20">
            <span className="col-span-2 text-slate-400 border-r border-slate-200 font-mono">時間</span>
            <span className="col-span-5 text-sky-700 border-r border-slate-200 font-black">🏛️ 大教室</span>
            <span className="col-span-5 text-indigo-700 font-black">🧘 小教室</span>
          </div>

          <div className="grid grid-cols-12 text-xs relative">
            <div className="col-span-2 border-r border-slate-200 bg-slate-50/50 flex flex-col divide-y divide-slate-100 select-none">
              {hoursList.map((h) => (
                <div key={h} style={{ height: `${DAY_HOUR_HEIGHT}px` }} className="flex items-center justify-center text-xs text-slate-400 font-mono shrink-0 font-bold">
                  {h < 10 ? `0${h}` : h}:00
                </div>
              ))}
            </div>

            {/* 大教室 */}
            <div className="col-span-5 border-r border-slate-200 relative" style={{ height: `${hoursList.length * DAY_HOUR_HEIGHT}px` }}>
              <div className="absolute inset-0 flex flex-col divide-y divide-slate-100">
                {hoursList.map((h) => (
                  <div key={h} style={{ height: `${DAY_HOUR_HEIGHT}px` }} className="flex flex-col shrink-0">
                    {minutesList.map((mStr) => (
                      <button
                        key={mStr}
                        type="button"
                        onClick={() => handleOpenQuickBooking(h, mStr, 'large', selectedDayNum)}
                        style={{ height: `${DAY_SLOT_HEIGHT}px` }}
                        className="w-full border-b border-dotted border-slate-100 hover:bg-sky-50/40 text-[8px] text-slate-300 flex items-center justify-start px-2 transition select-none block"
                      >
                        {mStr === '00' || mStr === '30' ? (
                          <span className="font-mono text-[9px] text-slate-300 pointer-events-none leading-none">{h < 10 ? `0${h}` : h}:{mStr}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {activeDayBookings.filter(b => b.roomType === 'large').map((b) => {
                const startMinutes = (b.startHour - 8) * 60 + b.startMin;
                const top = (startMinutes / 10) * DAY_SLOT_HEIGHT;
                const height = (b.durationMins / 10) * DAY_SLOT_HEIGHT;
                const isMine = b.teacherId === currentUserId;
                const teacher = teachers[b.teacherId];
                const startTimeStr = formatTimeStr(b.startHour, b.startMin);
                const canSee = userRole === 'admin' || isMine;

                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBookingForManage(b)}
                    style={{ top: `${top + 1}px`, height: `${height - 2}px` }}
                    className={`absolute left-1 right-1 z-10 rounded-xl shadow-xs overflow-hidden transition cursor-pointer hover:shadow-md select-none ${
                      canSee ? `${teacher?.bgLight || 'bg-sky-50'} border-l-[4px] ${teacher?.border || 'border-sky-400'}` : 'bg-slate-100 border-l-[4px] border-slate-300'
                    }`}
                  >
                    {canSee ? (
                      <div className="px-2.5 py-1 h-full flex flex-col justify-center gap-0.5 text-xs">
                        <div className="flex justify-between items-center font-black">
                          <span className={`${teacher?.text || 'text-sky-800'} text-xs`}>{teacher?.name}</span>
                          <span className="font-mono text-[10px] text-slate-500">{startTimeStr}</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-700 font-bold">
                          <span className="truncate">{b.studentName || '學員'}</span>
                          <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-white/80 border border-slate-200">
                            {b.lessonType}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between h-full px-2">
                        <span className="text-xs text-slate-500 flex items-center gap-1 font-bold">
                          <Lock className="w-3.5 h-3.5 text-slate-400" /> 已被預約
                        </span>
                        <span className="text-xs font-mono text-slate-400">{startTimeStr}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 小教室 */}
            <div className="col-span-5 relative" style={{ height: `${hoursList.length * DAY_HOUR_HEIGHT}px` }}>
              <div className="absolute inset-0 flex flex-col divide-y divide-slate-100">
                {hoursList.map((h) => (
                  <div key={h} style={{ height: `${DAY_HOUR_HEIGHT}px` }} className="flex flex-col shrink-0">
                    {minutesList.map((mStr) => (
                      <button
                        key={mStr}
                        type="button"
                        onClick={() => handleOpenQuickBooking(h, mStr, 'small', selectedDayNum)}
                        style={{ height: `${DAY_SLOT_HEIGHT}px` }}
                        className="w-full border-b border-dotted border-slate-100 hover:bg-indigo-50/40 text-[8px] text-slate-300 flex items-center justify-start px-2 transition select-none block"
                      >
                        {mStr === '00' || mStr === '30' ? (
                          <span className="font-mono text-[9px] text-slate-300 pointer-events-none leading-none">{h < 10 ? `0${h}` : h}:{mStr}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {activeDayBookings.filter(b => b.roomType === 'small').map((b) => {
                const startMinutes = (b.startHour - 8) * 60 + b.startMin;
                const top = (startMinutes / 10) * DAY_SLOT_HEIGHT;
                const height = (b.durationMins / 10) * DAY_SLOT_HEIGHT;
                const isMine = b.teacherId === currentUserId;
                const teacher = teachers[b.teacherId];
                const startTimeStr = formatTimeStr(b.startHour, b.startMin);
                const canSee = userRole === 'admin' || isMine;

                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBookingForManage(b)}
                    style={{ top: `${top + 1}px`, height: `${height - 2}px` }}
                    className={`absolute left-1 right-1 z-10 rounded-xl shadow-xs overflow-hidden transition cursor-pointer hover:shadow-md select-none ${
                      canSee ? `${teacher?.bgLight || 'bg-indigo-50'} border-l-[4px] ${teacher?.border || 'border-indigo-400'}` : 'bg-slate-100 border-l-[4px] border-slate-300'
                    }`}
                  >
                    {canSee ? (
                      <div className="px-2.5 py-1 h-full flex flex-col justify-center gap-0.5 text-xs">
                        <div className="flex justify-between items-center font-black">
                          <span className={`${teacher?.text || 'text-indigo-800'} text-xs`}>{teacher?.name}</span>
                          <span className="font-mono text-[10px] text-slate-500">{startTimeStr}</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-700 font-bold">
                          <span className="truncate">{b.studentName || '學員'}</span>
                          <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-white/80 border border-slate-200">
                            {b.lessonType}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between h-full px-2">
                        <span className="text-xs text-slate-500 flex items-center gap-1 font-bold">
                          <Lock className="w-3.5 h-3.5 text-slate-400" /> 已被預約
                        </span>
                        <span className="text-xs font-mono text-slate-400">{startTimeStr}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 日曆預約卡片彈窗 (嚴格落實權限矩陣、手寫簽名、備註編輯、直跳學生內頁) */}
      {selectedBookingForManage && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 border border-slate-100">
            <div className="flex justify-between items-center border-b pb-2.5">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-slate-800">課堂預約詳情與操作</h3>
                {isCardOwner ? (
                  <span className="text-[10px] bg-sky-100 text-sky-800 font-bold px-1.5 py-0.2 rounded">我的課堂</span>
                ) : userRole === 'admin' ? (
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded">管理者調度</span>
                ) : null}
              </div>
              <button onClick={() => setSelectedBookingForManage(null)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-2xl border space-y-1">
                <div className="flex justify-between items-center">
                  <p className="font-black text-slate-800 text-sm">{selectedBookingForManage.studentName || '學員'} ({selectedBookingForManage.lessonType})</p>
                  
                  {/* 直達學生內頁按鈕 */}
                  <button 
                    onClick={() => {
                      onSelectStudent(selectedBookingForManage.studentName || '');
                      setSelectedBookingForManage(null);
                    }}
                    className="text-[11px] text-rose-500 font-bold hover:underline flex items-center gap-0.5"
                  >
                    查看學員檔案 <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <p className="font-mono text-slate-500">日期時間：{selectedBookingForManage.date} {formatTimeStr(selectedBookingForManage.startHour, selectedBookingForManage.startMin)}</p>
                <p className="text-slate-500">教室：{selectedBookingForManage.roomType === 'large' ? '大教室' : '小教室'}</p>
                <p className="text-slate-500">授課老師：{teachers[selectedBookingForManage.teacherId]?.name}</p>
                <p>狀態：{getStatusBadge(selectedBookingForManage.status)}</p>
              </div>

              {/* 上課狀況備註說明欄位 (僅授課老師本人可編輯，Daisy 或他人唯讀) */}
              <div className="space-y-1">
                <label className="font-bold text-slate-600 flex items-center justify-between">
                  <span>老師上課狀況備註說明</span>
                  {!isCardOwner && <span className="text-[10px] text-slate-400 font-normal">🔒 僅授課老師可填寫</span>}
                </label>
                <textarea 
                  defaultValue={selectedBookingForManage.teacherNote || ''}
                  disabled={!isCardOwner}
                  onBlur={(e) => onUpdateBookingNote(selectedBookingForManage.id, e.target.value)}
                  placeholder={isCardOwner ? "填寫上課狀況、彈簧磅數或學員反饋 (點擊離開自動儲存)..." : "尚無授課備註"}
                  rows={2}
                  className={`w-full border rounded-xl p-2.5 text-[11px] outline-none leading-relaxed ${
                    isCardOwner ? 'bg-white focus:ring-1 focus:ring-rose-400 text-slate-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                />
              </div>

              {/* 核心操作按鈕群組：嚴格落實權限隔離 */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {/* 簽名/簽到：僅授課老師本人可按；管理者看他人卡片時鎖定 */}
                <button 
                  onClick={() => {
                    if (!isCardOwner) {
                      alert('抱歉，非該堂課授課老師不可代為簽到扣堂！');
                      return;
                    }
                    if (selectedBookingForManage.signed) {
                      alert('此課堂已完成手寫簽到');
                      return;
                    }
                    setActiveSignModal({ id: selectedBookingForManage.id, studentName: selectedBookingForManage.studentName || '學員' });
                    setSelectedBookingForManage(null);
                  }}
                  disabled={!isCardOwner || selectedBookingForManage.signed}
                  className={`py-2.5 rounded-xl font-bold flex items-center justify-center gap-1 transition ${
                    !isCardOwner 
                      ? 'bg-slate-100 text-slate-300 border cursor-not-allowed'
                      : selectedBookingForManage.signed 
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                        : 'bg-rose-500 text-white hover:bg-rose-600'
                  }`}
                  title={!isCardOwner ? "非授課老師不可代簽" : ""}
                >
                  <PenTool className="w-4 h-4" /> 
                  {!isCardOwner ? '非授課老師' : selectedBookingForManage.signed ? '已簽名' : '簽到扣堂'}
                </button>

                {/* 預約修改：Daisy 可修改任何卡片；一般老師僅能修改自己的卡片 */}
                <button 
                  onClick={() => {
                    if (!isCardOwner && userRole !== 'admin') {
                      alert('非本人課程無法修改');
                      return;
                    }
                    if (selectedBookingForManage.signed) {
                      alert('已簽到完成之課程不可再修改預約');
                      return;
                    }
                    alert(userRole === 'admin' ? 'Daisy 管理者可直接調度修改時間與場地' : '若改期時間距離上課不足 24 小時，將自動轉送 Daisy 審核');
                    setSelectedBookingForManage(null);
                  }}
                  disabled={selectedBookingForManage.signed || (!isCardOwner && userRole !== 'admin')}
                  className={`py-2.5 rounded-xl font-bold flex items-center justify-center gap-1 border transition ${
                    selectedBookingForManage.signed || (!isCardOwner && userRole !== 'admin')
                      ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                      : 'bg-slate-800 text-white hover:bg-slate-700'
                  }`}
                >
                  <Edit3 className="w-4 h-4" /> 修改預約
                </button>
              </div>

              {/* 請假順延按鈕 (授課老師本人可觸發請假順延) */}
              {isCardOwner && !selectedBookingForManage.signed && (
                <button 
                  onClick={() => {
                    if (window.confirm(`確定為學員 [${selectedBookingForManage.studentName}] 登記請假嗎？系統將自動依規則於 3 個月內補排至最後一堂課後。`)) {
                      onStudentLeave(selectedBookingForManage);
                      setSelectedBookingForManage(null);
                    }
                  }}
                  className="w-full text-slate-500 hover:text-rose-600 py-1.5 rounded-xl text-[11px] font-bold border border-dashed border-slate-200 hover:bg-rose-50/50 transition"
                >
                  學員請假 (不扣堂並自動順延至隊尾)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 新增預約彈窗 */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-bold text-slate-800">新增預約</h3>
              <button onClick={() => setIsBookingModalOpen(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="text-slate-500 font-bold">選擇學員 (可選現有學生)</label>
                <select 
                  value={modalForm.studentName}
                  onChange={(e) => setModalForm({ ...modalForm, studentName: e.target.value })}
                  className="w-full border rounded-xl p-2 mt-0.5 font-bold bg-white"
                >
                  {students.map(s => (
                    <option key={s.id} value={s.name}>{s.name} (剩餘 {s.credits} 堂)</option>
                  ))}
                  <option value="其他自填學員">-- 其他 / 臨時預約 --</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500 font-bold">預約日期</label>
                <input 
                  type="date" 
                  value={modalForm.date} 
                  onChange={(e) => setModalForm({ ...modalForm, date: e.target.value })}
                  className="w-full border rounded-xl p-2 mt-0.5 font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-slate-500 font-bold">開始時間</label>
                <div className="grid grid-cols-2 gap-2 mt-0.5">
                  <select 
                    value={modalForm.hour}
                    onChange={(e) => setModalForm({ ...modalForm, hour: e.target.value })}
                    className="border rounded-xl p-2 font-mono bg-white font-bold"
                  >
                    {hoursList.map(h => (
                      <option key={h} value={h < 10 ? `0${h}` : h}>{h < 10 ? `0${h}` : h} 時</option>
                    ))}
                  </select>

                  <select 
                    value={modalForm.minute}
                    onChange={(e) => setModalForm({ ...modalForm, minute: e.target.value })}
                    className="border rounded-xl p-2 font-mono bg-white font-bold"
                  >
                    {minutesList.map(m => <option key={m} value={m}>{m} 分</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 font-bold">規格 (1v1 / 1v2)</label>
                  <select 
                    value={modalForm.lessonType}
                    onChange={(e) => {
                      const type = e.target.value as '1v1' | '1v2';
                      setModalForm({ ...modalForm, lessonType: type, roomType: type === '1v2' ? 'large' : 'small' });
                    }}
                    className="w-full border rounded-xl p-2 mt-0.5 bg-white font-bold"
                  >
                    <option value="1v1">1v1</option>
                    <option value="1v2">1v2</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-500 font-bold">教室</label>
                  <select 
                    value={modalForm.roomType}
                    onChange={(e) => setModalForm({ ...modalForm, roomType: e.target.value as 'large' | 'small' })}
                    className="w-full border rounded-xl p-2 mt-0.5 bg-white font-bold"
                  >
                    <option value="large">大教室</option>
                    <option value="small">小教室</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button onClick={() => setIsBookingModalOpen(false)} className="flex-1 bg-slate-100 py-2.5 rounded-xl text-xs font-bold">取消</button>
              <button onClick={handleConfirmNewBooking} className="flex-1 bg-rose-500 text-white py-2.5 rounded-xl text-xs font-bold">確認預約</button>
            </div>
          </div>
        </div>
      )}

      {/* 手寫簽名 Modal */}
      <SignatureModal 
        isOpen={!!activeSignModal}
        onClose={() => setActiveSignModal(null)}
        studentName={activeSignModal?.studentName || ''}
        onSave={(dataUrl) => {
          if (activeSignModal) {
            onSignBooking(activeSignModal.id, dataUrl);
          }
        }}
      />
    </div>
  );
}

/* =========================================================================
   Tab 2: 個人課表 (支援簽名後即沉澱轉歷史、請假自動順延、學生姓名非紅字)
   ========================================================================= */
function Tab2PersonalSchedule({
  userRole,
  currentUserId,
  teachers,
  bookings,
  setBookings,
  onSignBooking,
  onUpdateBookingNote,
  onAddReview,
  onAddLog,
  showToast,
  onStudentLeave,
  onSelectStudent
}: {
  userRole: 'admin' | 'teacher';
  currentUserId: string;
  teachers: Record<string, TeacherProfile>;
  bookings: BookingItem[];
  setBookings: React.Dispatch<React.SetStateAction<BookingItem[]>>;
  onSignBooking: (bId: string, dataUrl: string) => void;
  onUpdateBookingNote: (bId: string, note: string) => void;
  onAddReview: (rev: ReviewItem) => void;
  onAddLog: (action: string, category: 'red' | 'yellow' | 'normal', teacherId?: string) => void;
  showToast: (msg: string) => void;
  onStudentLeave: (b: BookingItem) => void;
  onSelectStudent: (sName: string) => void;
}) {
  const teacher = teachers[currentUserId];
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeSignModal, setActiveSignModal] = useState<{ id: string; studentName: string } | null>(null);
  const [editingBooking, setEditingBooking] = useState<BookingItem | null>(null);

  const overdueUnsignedBookings = bookings.filter(b => 
    b.teacherId === currentUserId && 
    b.status === 'confirmed' && 
    !b.signed && 
    b.date < '2026-10-16'
  );

  const myBookings = bookings.filter(b => b.teacherId === currentUserId && b.status === 'confirmed');
  // 簽到後 (!b.signed 為假) 立即移出即將上課，轉入歷史紀錄
  const upcomingBookings = myBookings.filter(b => b.date >= '2026-10-16' && !b.signed);
  const historyBookings = myBookings.filter(b => b.date < '2026-10-16' || b.signed);

  const handleExecuteReschedule = (newDate: string, newHour: number, newMin: number, newRoom: 'large' | 'small', isCancelAction = false) => {
    if (!editingBooking) return;

    if (isCancelAction) {
      if (userRole === 'admin') {
        setBookings(prev => prev.map(item => item.id === editingBooking.id ? { ...item, status: 'cancelled_normal' } : item));
        onAddLog(`Daisy 取消個人課程 (${editingBooking.studentName})`, 'red', currentUserId);
        showToast('已取消預約 (Daisy 免審核)');
      } else {
        const newRev: ReviewItem = {
          id: `rev-${Date.now()}`,
          bookingId: editingBooking.id,
          teacherId: currentUserId,
          teacherName: teacher?.name || '老師',
          date: editingBooking.date,
          time: `${editingBooking.date.slice(5)} ${formatTimeStr(editingBooking.startHour, editingBooking.startMin)}`,
          room: editingBooking.roomType === 'large' ? '大教室' : '小教室',
          lessonType: editingBooking.lessonType,
          reason: '小於 24 小時臨時取消 (待審核計罰或免責)',
          status: 'pending',
          phone: teacher?.phone || '0900-000-000'
        };
        setBookings(prev => prev.map(item => item.id === editingBooking.id ? { ...item, status: 'special_pending' } : item));
        onAddReview(newRev);
        onAddLog(`${teacher?.name} 申請 24H 內取消預約 (待 Daisy 審核)`, 'red', currentUserId);
        showToast('已送交 Daisy 審核是否計罰或免責');
      }
      setEditingBooking(null);
      return;
    }

    if (userRole === 'admin') {
      setBookings(prev => prev.map(item => item.id === editingBooking.id ? {
        ...item,
        date: newDate,
        startHour: newHour,
        startMin: newMin,
        roomType: newRoom
      } : item));
      onAddLog(`Daisy 變更預約時間/場地至 ${newDate} ${formatTimeStr(newHour, newMin)} (${newRoom})`, 'yellow', currentUserId);
      showToast('預約修改成功 (Daisy 免審核)');
    } else {
      const newRev: ReviewItem = {
        id: `rev-${Date.now()}`,
        bookingId: editingBooking.id,
        teacherId: currentUserId,
        teacherName: teacher?.name || '老師',
        date: editingBooking.date,
        time: `${editingBooking.date.slice(5)} ${formatTimeStr(editingBooking.startHour, editingBooking.startMin)}`,
        room: editingBooking.roomType === 'large' ? '大教室' : '小教室',
        lessonType: editingBooking.lessonType,
        reason: `申請改期至 ${newDate} ${formatTimeStr(newHour, newMin)} (${newRoom})`,
        status: 'pending',
        phone: teacher?.phone || '0900-000-000'
      };
      setBookings(prev => prev.map(item => item.id === editingBooking.id ? { ...item, status: 'special_pending' } : item));
      onAddReview(newRev);
      onAddLog(`${teacher?.name} 申請 24H 內變更時間場地 (待 Daisy 審核)`, 'red', currentUserId);
      showToast('已送交變更申請至 Daisy 審核');
    }
    setEditingBooking(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-base font-black text-slate-800">我的個人課表</h2>
          <p className="text-[11px] text-slate-400">專屬授課週曆、手寫簽到與備註</p>
        </div>

        <span className={`text-xs font-black px-3 py-1 rounded-xl ${teacher?.bgLight} ${teacher?.text} border ${teacher?.border}`}>
          {teacher?.name} 老師
        </span>
      </div>

      {/* 週切換器 */}
      <div className="flex justify-between items-center bg-white px-4 py-2 rounded-2xl border border-slate-200 shadow-xs text-xs font-black text-slate-700">
        <button onClick={() => setWeekOffset(weekOffset - 1)} className="p-1 rounded-lg hover:bg-slate-100 flex items-center gap-1 text-slate-500">
          <ChevronLeft className="w-4 h-4" /> 上週
        </button>
        <span className="font-mono">
          {weekOffset === 0 ? '10/12 (一) - 10/18 (日) • 本週' : weekOffset < 0 ? `過去第 ${Math.abs(weekOffset)} 週課表` : `未來第 ${weekOffset} 週預排`}
        </span>
        <button onClick={() => setWeekOffset(weekOffset + 1)} className="p-1 rounded-lg hover:bg-slate-100 flex items-center gap-1 text-slate-500">
          下週 <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 逾期未簽到卡片 */}
      {overdueUnsignedBookings.length > 0 && (
        <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-300 shadow-xs space-y-2.5 animate-in fade-in">
          <div className="flex justify-between items-center text-amber-900 font-black text-xs">
            <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 text-amber-600" /> ⏰ 逾期未簽到處理 ({overdueUnsignedBookings.length} 堂)</span>
            <span className="text-[10px] text-amber-700 font-normal">月底未處理將自動轉特殊計罰</span>
          </div>

          <div className="space-y-2">
            {overdueUnsignedBookings.map(b => (
              <div key={b.id} className="p-3 bg-white rounded-xl border border-amber-200 space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <div>
                    <span onClick={() => onSelectStudent(b.studentName || '')} className="font-black text-slate-800 hover:underline cursor-pointer">
                      {b.studentName || '學員'}
                    </span>
                    <span className="text-slate-400 font-mono ml-2">{b.date} {formatTimeStr(b.startHour, b.startMin)}</span>
                  </div>
                  <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded font-bold border border-rose-200">
                    逾期待結算
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-1 border-t border-slate-50">
                  <button 
                    onClick={() => { setEditingBooking(b); }}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg font-bold"
                  >
                    變更/回報取消
                  </button>
                  <button 
                    onClick={() => setActiveSignModal({ id: b.id, studentName: b.studentName || '學員' })}
                    className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg font-bold shadow-xs flex items-center gap-1"
                  >
                    <PenTool className="w-3 h-3" /> 手寫補簽
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 課表清單 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="space-y-2.5">
          <p className="text-xs font-black text-slate-800 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-sky-600" /> 即將上課課程
          </p>

          <div className="space-y-2.5">
            {upcomingBookings.length === 0 ? (
              <p className="text-xs text-slate-300 text-center py-4">無預排課程</p>
            ) : (
              upcomingBookings.map(b => (
                <div 
                  key={b.id} 
                  onClick={() => onSelectStudent(b.studentName || '')}
                  className="p-3.5 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200 space-y-2 text-xs transition cursor-pointer"
                >
                  <div className="flex justify-between items-center font-mono">
                    <span className="font-black text-slate-800 text-sm">📅 {b.date} {formatTimeStr(b.startHour, b.startMin)}</span>
                    <span className="text-[10px] text-slate-400 font-sans">點卡片進入學員內頁 ➔</span>
                  </div>

                  {/* 學生姓名使用深色高對比字體，絕非紅色 */}
                  <div className="flex justify-between items-center text-slate-700 font-bold">
                    <div>
                      <span className="font-black text-slate-900 text-sm mr-2">{b.studentName || '學員'}</span>
                      <span className="text-slate-500">教室: {b.roomType === 'large' ? '大教室' : '小教室'}</span>
                      <span className="ml-2 text-slate-400">({b.lessonType})</span>
                    </div>

                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button 
                        onClick={() => setEditingBooking(b)}
                        className="px-2.5 py-1 rounded-xl text-xs font-bold border bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      >
                        修改預約
                      </button>

                      <button 
                        onClick={() => setActiveSignModal({ id: b.id, studentName: b.studentName || '學員' })}
                        className="bg-rose-500 hover:bg-rose-600 text-white font-black px-3 py-1 rounded-xl text-xs flex items-center gap-1 shadow-xs"
                      >
                        <PenTool className="w-3 h-3" /> 簽到
                      </button>
                    </div>
                  </div>

                  <div onClick={e => e.stopPropagation()}>
                    <input 
                      type="text" 
                      defaultValue={b.teacherNote || ''}
                      onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                      placeholder="填寫上課狀況備註 (點擊離開自動儲存)..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-[11px] text-slate-700 outline-none"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 歷史分界線 */}
        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
          <div className="relative flex justify-center text-[10px] uppercase">
            <span className="bg-white px-3 font-bold text-slate-400">已簽到 / 歷史課程紀錄</span>
          </div>
        </div>

        {/* 歷史課程 */}
        <div className="space-y-2">
          {historyBookings.map(b => (
            <div 
              key={b.id} 
              onClick={() => onSelectStudent(b.studentName || '')}
              className="p-3 bg-slate-100/60 hover:bg-slate-100 rounded-xl space-y-1.5 text-xs text-slate-600 border border-slate-200/60 cursor-pointer"
            >
              <div className="flex justify-between items-center font-mono">
                <div>
                  <span className="font-bold text-slate-800">{b.date} {formatTimeStr(b.startHour, b.startMin)}</span>
                  <span className="ml-2 font-black text-slate-700 font-sans">{b.studentName} ({b.lessonType})</span>
                </div>
                {b.signatureData?.startsWith('data:image') ? (
                  <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border">
                    <span className="text-[10px] text-emerald-600 font-bold">手寫簽存:</span>
                    <img src={b.signatureData} alt="簽名" className="h-4 w-12 object-contain" />
                  </div>
                ) : (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                    ✓ {b.signatureData || '已簽名'}
                  </span>
                )}
              </div>

              <div onClick={e => e.stopPropagation()}>
                <input 
                  type="text" 
                  defaultValue={b.teacherNote || ''}
                  onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                  placeholder="補充歷史上課狀況筆記..."
                  className="w-full bg-white/80 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-600"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 修改預約彈窗 */}
      {editingBooking && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-bold text-slate-800">
                修改預約 {userRole === 'admin' ? '(Daisy 免審核)' : '(<24H 需送審)'}
              </h3>
              <button onClick={() => setEditingBooking(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-600">學員：<span className="font-bold text-slate-900">{editingBooking.studentName}</span></p>
              {userRole !== 'admin' && (
                <div className="p-2.5 bg-rose-50 rounded-xl text-rose-800 text-[11px] font-bold border border-rose-200">
                  ⚠️ 距離上課不足 24 小時，任何變更或取消均會轉送 Daisy 審核核定計罰或免責。
                </div>
              )}

              <div>
                <label className="text-slate-400 font-bold">預約日期</label>
                <input type="date" defaultValue={editingBooking.date} id="edit-d" className="w-full border rounded-xl p-2 mt-0.5 font-bold" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 font-bold">時間</label>
                  <select id="edit-h" defaultValue={editingBooking.startHour} className="w-full border rounded-xl p-2 mt-0.5 font-bold">
                    {[8,9,10,11,12,13,14,15,16,17,18,19,20,21].map(h => (
                      <option key={h} value={h}>{h < 10 ? `0${h}` : h}:00</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 font-bold">教室</label>
                  <select id="edit-r" defaultValue={editingBooking.roomType} className="w-full border rounded-xl p-2 mt-0.5 font-bold">
                    <option value="large">🏛️ 大教室</option>
                    <option value="small">🧘 小教室</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    const d = (document.getElementById('edit-d') as HTMLInputElement).value;
                    const h = parseInt((document.getElementById('edit-h') as HTMLSelectElement).value);
                    const r = (document.getElementById('edit-r') as HTMLSelectElement).value as 'large' | 'small';
                    handleExecuteReschedule(d, h, 0, r, false);
                  }}
                  className="flex-1 bg-slate-800 text-white py-2 rounded-xl text-xs font-bold hover:bg-slate-700"
                >
                  確認變更
                </button>
                <button onClick={() => setEditingBooking(null)} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl text-xs font-bold">
                  返回
                </button>
              </div>

              <button 
                onClick={() => handleExecuteReschedule('', 0, 0, 'small', true)}
                className="w-full bg-rose-50 text-rose-600 border border-rose-200 py-2 rounded-xl text-xs font-bold hover:bg-rose-100"
              >
                直接取消此預約 {userRole !== 'admin' && '(轉送審核)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手寫簽名 Modal */}
      <SignatureModal 
        isOpen={!!activeSignModal}
        onClose={() => setActiveSignModal(null)}
        studentName={activeSignModal?.studentName || ''}
        onSave={(dataUrl) => {
          if (activeSignModal) {
            onSignBooking(activeSignModal.id, dataUrl);
          }
        }}
      />
    </div>
  );
}

/* =========================================================================
   Tab 3: 學生管理第一層 (個人老師管理自己的學生，不共用)
   ========================================================================= */
function Tab3StudentManagement({ 
  currentUserId,
  students, 
  setStudents,
  onSelectStudent, 
  onOpenCreate 
}: { 
  currentUserId: string;
  students: StudentItem[]; 
  setStudents: React.Dispatch<React.SetStateAction<StudentItem[]>>;
  onSelectStudent: (sId: string) => void; 
  onOpenCreate: () => void; 
}) {
  const [archivedOpen, setArchivedOpen] = useState(false);

  const myStudents = useMemo(() => students.filter(s => s.teacherId === currentUserId), [students, currentUserId]);

  const toggleStudentStatus = (sId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStudents(prev => prev.map(s => {
      if (s.id === sId) {
        return { ...s, status: s.status === 'active' ? 'archived' : 'active' };
      }
      return s;
    }));
  };

  const activeStudents = myStudents.filter(s => s.status === 'active');
  const archivedStudents = myStudents.filter(s => s.status === 'archived');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-base font-black text-slate-800">學生管理</h2>
          <p className="text-[11px] text-slate-400">專屬學生名冊 (獨立管理不共用)</p>
        </div>

        <button 
          onClick={onOpenCreate}
          className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-xs transition active:scale-95"
        >
          <Plus className="w-4 h-4" /> 建立學生檔案
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 font-bold border-b text-[11px]">
              <th className="py-2.5 px-3">學生名</th>
              <th className="py-2.5 px-2">排課規則 / 下一堂課</th>
              <th className="py-2.5 px-2 text-center">狀態</th>
              <th className="py-2.5 px-3 text-right">剩餘堂數</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {activeStudents.map(s => {
              const ruleText = s.noRegularRule ? '暫無固定' : s.rules?.[0] ? `${s.rules[0].freq}週${s.rules[0].day} ${s.rules[0].time}` : '未排定';
              const isWarning = s.credits <= 5;

              return (
                <tr 
                  key={s.id} 
                  onClick={() => onSelectStudent(s.id)}
                  className="hover:bg-rose-50/30 transition cursor-pointer"
                >
                  <td className="py-2.5 px-3 font-sans font-bold text-slate-800">
                    <div className="flex items-center gap-1.5">
                      {s.isTrial && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1 py-0.2 rounded font-bold">🌱 體驗</span>}
                      <span>{s.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-2 font-sans">
                    <div className="text-[11px] font-bold text-slate-700">{ruleText}</div>
                    <div className="text-[10px] text-slate-400 font-mono">下堂: {s.nextLesson || '未定'}</div>
                  </td>
                  <td className="py-2.5 px-2 text-center" onClick={e => e.stopPropagation()}>
                    <button 
                      onClick={(e) => toggleStudentStatus(s.id, e)}
                      className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold"
                    >
                      🟢 活躍
                    </button>
                  </td>
                  <td className={`py-2.5 px-3 text-right font-black ${isWarning ? 'text-rose-600 bg-rose-50/60' : 'text-slate-800'}`}>
                    {s.credits} 堂
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {archivedStudents.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <button 
            onClick={() => setArchivedOpen(!archivedOpen)}
            className="w-full p-3.5 flex justify-between items-center text-xs font-bold text-slate-500 hover:bg-slate-50 transition"
          >
            <span className="flex items-center gap-1.5">
              📥 已封存學生 ({archivedStudents.length})
            </span>
            <ChevronRight className={`w-4 h-4 transition-transform ${archivedOpen ? 'rotate-90' : ''}`} />
          </button>

          {archivedOpen && (
            <div className="p-3 border-t bg-slate-50/50 space-y-2 text-xs">
              {archivedStudents.map(s => (
                <div key={s.id} onClick={() => onSelectStudent(s.id)} className="p-2.5 bg-white rounded-xl border flex justify-between items-center cursor-pointer hover:border-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-600">{s.name}</span>
                    <button onClick={(e) => toggleStudentStatus(s.id, e)} className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      ⚪ 封存中 (點擊解封)
                    </button>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">剩餘 {s.credits} 堂</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Tab 3: 學生詳細內頁 (三行極簡卡片、排課規則設定、歷史手寫放大燈箱)
   ========================================================================= */
function StudentDetailView({
  student,
  onBack,
  bookings,
  teachers,
  onUpdateStudent,
  onSignBooking,
  onUpdateBookingNote,
  onAddBookings,
  showToast
}: {
  student: StudentItem;
  onBack: () => void;
  bookings: BookingItem[];
  teachers: Record<string, TeacherProfile>;
  onUpdateStudent: (s: StudentItem) => void;
  onSignBooking: (bId: string, dataUrl: string) => void;
  onUpdateBookingNote: (bId: string, note: string) => void;
  onAddBookings: (bks: BookingItem[]) => void;
  showToast: (msg: string) => void;
}) {
  const [activeSignModal, setActiveSignModal] = useState<string | null>(null);
  const [isAutoScheduleOpen, setIsAutoScheduleOpen] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(student.note);
  const [isEditingRuleModal, setIsEditingRuleModal] = useState(false);
  const [zoomedSignature, setZoomedSignature] = useState<{ url: string; time: string } | null>(null);

  const studentBookings = bookings.filter(b => b.studentName === student.name);
  const upcomingAndScheduled = studentBookings.filter(b => b.date >= '2026-10-16' && b.status === 'confirmed');
  const history = studentBookings.filter(b => b.date < '2026-10-16' || b.signed);

  const isWarningCredits = student.credits <= 5;

  const handleRunAutoSchedule = () => {
    if (student.credits <= 0) {
      alert('學生目前已無剩餘堂數，請先續約加堂');
      return;
    }
    const engine = new ScheduleEngine(bookings as any);
    const result = engine.generateSchedule({
      sid: student.id,
      credits: student.credits,
      slots: student.rules,
      conflictPolicy: 'skip',
      maxWeeksLimit: 12
    });

    if (result.success && result.newRecords.length > 0) {
      const generatedBookings: BookingItem[] = result.newRecords.map((r: any) => ({
        id: r.id,
        date: r.date,
        startHour: parseInt(r.time.split(':')[0]),
        startMin: parseInt(r.time.split(':')[1]),
        durationMins: 50,
        teacherId: student.teacherId,
        studentName: student.name,
        studentId: student.id,
        roomType: r.roomType || 'small',
        lessonType: r.lessonType || '1v1',
        status: 'confirmed'
      }));
      onAddBookings(generatedBookings);
      setIsAutoScheduleOpen(false);
      showToast(result.message);
    } else {
      alert(result.message || '無排入任何課程，請檢查排課規則是否有衝突');
    }
  };

  const handleRenewCredits = () => {
    const addStr = prompt('請輸入續約購買堂數：', '10');
    if (addStr && !isNaN(Number(addStr))) {
      const addNum = Number(addStr);
      const newPurchases: PurchaseRecord[] = [
        {
          id: `p-${Date.now()}`,
          date: '2026-10-18',
          credits: addNum,
          amountText: `續約加購 ${addNum} 堂 ($24,000)`
        },
        ...student.purchases
      ];
      onUpdateStudent({
        ...student,
        credits: student.credits + addNum,
        purchases: newPurchases
      });
      showToast(`已成功為 ${student.name} 續約加購 ${addNum} 堂！`);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="flex items-center gap-2 border-b pb-2.5">
        <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-bold text-slate-400">學員個人檔案</span>
      </div>

      {/* 三行極簡卡片 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3">
        {/* 第 1 行：學生名稱 ｜ 剩餘堂數 ｜ 續約加堂按鈕 */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-slate-900">{student.name}</h2>
            {student.isTrial && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">🌱 體驗</span>}
          </div>

          <div className="flex items-center gap-2.5">
            <span className={`text-sm font-black font-mono ${isWarningCredits ? 'text-rose-600 bg-rose-50 px-2 py-1 rounded-lg border border-rose-200' : 'text-slate-800'}`}>
              剩餘 {student.credits} 堂
            </span>
            <button 
              onClick={handleRenewCredits}
              className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black px-3 py-1.5 rounded-xl shadow-xs transition"
            >
              ➕ 續約加堂
            </button>
          </div>
        </div>

        {/* 第 2 行：學生狀態 / 身體狀況 (隨時可點擊編輯) */}
        <div className="pt-2 border-t text-xs">
          <div className="flex justify-between items-center text-slate-400 font-bold mb-1">
            <span>學生狀態 / 身體備註</span>
            <button onClick={() => setIsEditingNote(!isEditingNote)} className="text-rose-500 hover:underline flex items-center gap-0.5 font-bold">
              <Edit3 className="w-3 h-3" /> {isEditingNote ? '儲存' : '編輯'}
            </button>
          </div>

          {isEditingNote ? (
            <input 
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onBlur={() => {
                setIsEditingNote(false);
                onUpdateStudent({ ...student, note: noteText });
                showToast('身體備註已更新');
              }}
              className="w-full border rounded-xl p-2 bg-slate-50 font-bold text-slate-800 outline-none"
              autoFocus
            />
          ) : (
            <p onClick={() => setIsEditingNote(true)} className="text-slate-700 bg-slate-50 p-2 rounded-xl border border-slate-100 cursor-pointer font-medium">
              {student.note || '點擊輸入學員舊傷或體態注意事項...'}
            </p>
          )}
        </div>

        {/* 第 3 行：名稱定為「排課」＋ 編輯筆 ＋ 自動排課 */}
        <div className="pt-2 border-t flex justify-between items-center text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold">排課：</span>
            <span className="font-bold text-slate-800">
              {student.noRegularRule ? '暫無固定' : student.rules?.[0] ? `${student.rules[0].freq}週${student.rules[0].day} ${student.rules[0].time}` : '未設定'}
            </span>
            <button onClick={() => setIsEditingRuleModal(true)} className="p-1 hover:bg-slate-100 rounded-lg text-rose-500" title="編輯排課規則">
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button 
            onClick={() => setIsAutoScheduleOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-xs"
          >
            ⚡ 自動排課
          </button>
        </div>
      </div>

      {/* 即將上課與預排課程清單 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <h3 className="font-black text-slate-800 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-sky-600" /> 即將上課與預排課程
        </h3>

        <div className="space-y-2 font-mono">
          {upcomingAndScheduled.length === 0 ? (
            <p className="text-slate-300 text-center py-3 font-sans">暫無預排課程，可點擊上方「⚡ 自動排課」進行排程</p>
          ) : (
            upcomingAndScheduled.map(b => (
              <div key={b.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5 font-sans">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-black text-slate-800 font-mono">{b.date} {formatTimeStr(b.startHour, b.startMin)}</span>
                    <span className="ml-2 text-slate-500 font-bold">({b.roomType === 'large' ? '大教室' : '小教室'} ｜ {b.lessonType})</span>
                  </div>
                  <button 
                    onClick={() => setActiveSignModal(b.id)}
                    className="bg-rose-500 hover:bg-rose-600 text-white px-3 py-1 rounded-xl font-black text-xs flex items-center gap-1 shadow-xs"
                  >
                    <PenTool className="w-3 h-3" /> 簽名
                  </button>
                </div>

                <input 
                  type="text" 
                  defaultValue={b.teacherNote || ''}
                  onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                  placeholder="備註上課狀況..."
                  className="w-full bg-white border rounded-lg px-2 py-1 text-[11px] text-slate-700 outline-none"
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* 歷史紀錄與購課帳本 */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <h3 className="font-black text-slate-800 flex items-center gap-1.5">
          <History className="w-4 h-4 text-slate-600" /> 歷史紀錄與購課帳本
        </h3>

        <div className="bg-rose-50/50 p-3 rounded-2xl border border-rose-100 space-y-1.5">
          <p className="font-black text-rose-800 text-[11px]">💳 購課與續約帳本存根：</p>
          {student.purchases.map(p => (
            <div key={p.id} className="flex justify-between items-center text-[11px] text-rose-900 font-mono">
              <span>{p.date} 購買 {p.credits} 堂</span>
              <span className="font-sans font-bold text-rose-700">{p.amountText}</span>
            </div>
          ))}
        </div>

        <div className="space-y-2 divide-y font-mono pt-1">
          {history.length === 0 ? (
            <p className="text-slate-300 text-center py-2 font-sans">尚無已完成課程紀錄</p>
          ) : (
            history.map(b => (
              <div key={b.id} className="pt-2 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-800">{b.date} {formatTimeStr(b.startHour, b.startMin)}</span>
                  {b.signatureData?.startsWith('data:image') ? (
                    <div 
                      onClick={() => setZoomedSignature({ url: b.signatureData!, time: b.signedAt || '2026-10-16 09:55' })}
                      className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-emerald-300 cursor-pointer hover:bg-emerald-50 transition"
                      title="點擊放大查看簽名存根與時間戳記"
                    >
                      <span className="text-[10px] text-emerald-700 font-bold">簽名存根:</span>
                      <img src={b.signatureData} alt="簽名" className="h-4 w-12 object-contain" />
                      <ZoomIn className="w-3 h-3 text-emerald-600 ml-0.5" />
                    </div>
                  ) : (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded">
                      ✓ 已簽名
                    </span>
                  )}
                </div>
                <input 
                  type="text" 
                  defaultValue={b.teacherNote || ''}
                  onBlur={(e) => onUpdateBookingNote(b.id, e.target.value)}
                  placeholder="補充歷史課程筆記..."
                  className="w-full bg-slate-50 border rounded px-2 py-0.5 text-[11px] text-slate-600"
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* 簽名放大燈箱 Modal */}
      {zoomedSignature && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-xs rounded-3xl p-5 shadow-2xl space-y-3 border border-slate-100 text-center animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-xs font-black text-slate-800">手寫簽名核簽存根</h3>
              <button onClick={() => setZoomedSignature(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <img src={zoomedSignature.url} alt="放大簽名" className="w-full h-32 object-contain bg-white rounded-xl" />
            </div>

            <p className="text-xs font-mono text-slate-500">
              簽核時間點：<span className="font-bold text-slate-800">{zoomedSignature.time}</span>
            </p>

            <button onClick={() => setZoomedSignature(null)} className="w-full bg-slate-800 text-white py-2 rounded-xl text-xs font-bold">
              關閉
            </button>
          </div>
        </div>
      )}

      {/* 排課規則設定彈窗 */}
      {isEditingRuleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100 text-xs">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-black text-slate-800">設定排課規則與時段</h3>
              <button onClick={() => setIsEditingRuleModal(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2">
              <label className="font-bold text-slate-600">排課頻率</label>
              <select id="rule-freq" defaultValue="每週" className="w-full border rounded-xl p-2 bg-slate-50 font-bold">
                <option value="每週">每週</option>
                <option value="隔週">隔週</option>
              </select>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-600">星期</label>
                  <select id="rule-day" defaultValue="五" className="w-full border rounded-xl p-2 bg-slate-50 font-bold">
                    {['一', '二', '三', '四', '五', '六', '日'].map(d => <option key={d} value={d}>週{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-600">時段</label>
                  <input type="time" id="rule-time" defaultValue="14:00" className="w-full border rounded-xl p-2 bg-slate-50 font-bold" />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-600">起始生效日期</label>
                <input type="date" id="rule-start" defaultValue="2026-10-19" className="w-full border rounded-xl p-2 bg-slate-50 font-bold" />
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button onClick={() => setIsEditingRuleModal(false)} className="flex-1 bg-slate-100 py-2.5 rounded-xl font-bold">取消</button>
              <button 
                onClick={() => {
                  const freq = (document.getElementById('rule-freq') as HTMLSelectElement).value;
                  const day = (document.getElementById('rule-day') as HTMLSelectElement).value;
                  const time = (document.getElementById('rule-time') as HTMLInputElement).value;
                  const startDate = (document.getElementById('rule-start') as HTMLInputElement).value;
                  const updatedRule: StudentRule = { id: `r-${Date.now()}`, freq, day, time, startDate, roomType: 'small', lessonType: '1v1' };
                  onUpdateStudent({
                    ...student,
                    noRegularRule: false,
                    rules: [updatedRule],
                    nextLesson: `${freq}週${day} ${time}`
                  });
                  setIsEditingRuleModal(false);
                  showToast('排課規則設定完成');
                }}
                className="flex-1 bg-rose-500 text-white py-2.5 rounded-xl font-bold"
              >
                儲存排課
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 自動排課確認 Modal */}
      {isAutoScheduleOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" /> 自動排課設定 (上限 3 個月)
              </h3>
              <button onClick={() => setIsAutoScheduleOpen(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-600">
                將依據學員剩餘 <span className="font-black text-rose-600">{student.credits}</span> 堂數，依照排課規則自動排入日曆：
              </p>
              <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-900 font-mono space-y-1">
                <p className="font-bold">排課規則：{student.rules?.[0] ? `${student.rules[0].freq}週${student.rules[0].day} ${student.rules[0].time}` : '每週五 14:00'}</p>
                <p>預排上限：3 個月 (12 週)</p>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button onClick={() => setIsAutoScheduleOpen(false)} className="flex-1 bg-slate-100 py-2.5 rounded-xl text-xs font-bold">取消</button>
              <button onClick={handleRunAutoSchedule} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-xs font-black shadow-xs">
                確認執行排課
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 手寫簽名 Modal */}
      <SignatureModal 
        isOpen={!!activeSignModal}
        onClose={() => setActiveSignModal(null)}
        studentName={student.name}
        onSave={(dataUrl) => {
          if (activeSignModal) {
            onSignBooking(activeSignModal, dataUrl);
          }
        }}
      />
    </div>
  );
}

/* =========================================================================
   Tab 4: 老師管理與當月統計
   ========================================================================= */
function Tab4TeachersAndStats({ 
  userRole,
  currentUserId,
  teachers, 
  setTeachers, 
  bookings,
  reviews,
  onReview,
  onReset,
  onSelectTeacher 
}: { 
  userRole: 'admin' | 'teacher';
  currentUserId: string;
  teachers: Record<string, TeacherProfile>; 
  setTeachers: React.Dispatch<React.SetStateAction<Record<string, TeacherProfile>>>;
  bookings: BookingItem[];
  reviews: ReviewItem[];
  onReview: (id: string, newStatus: 'approved' | 'rejected') => void;
  onReset: (id: string) => void;
  onSelectTeacher: (id: string) => void;
}) {
  const [selectedMonth, setSelectedMonth] = useState('10月');
  const [colorPickerOpenId, setColorPickerOpenId] = useState<string | null>(null);

  const monthPrefixMap: Record<string, string> = {
    '10月': '2026-10', '9月': '2026-09', '8月': '2026-08'
  };

  const prefix = monthPrefixMap[selectedMonth] || '2026-10';

  const getTeacherStats = (tId: string) => {
    const list = bookings.filter(b => b.date.startsWith(prefix) && b.teacherId === tId);
    const count1v1 = list.filter(b => b.lessonType === '1v1' && b.status === 'confirmed').length;
    const count1v2 = list.filter(b => b.lessonType === '1v2' && b.status === 'confirmed').length;
    const total = count1v1 + count1v2;
    const normalCancel = list.filter(b => b.status === 'cancelled_normal').length;
    const freeQuota = Math.floor(Math.max(0, total - 1) / 20) + 1;
    const freeApproved = list.filter(b => b.status === 'special_approved').length;
    const penalty = list.filter(b => b.status === 'special_rejected').length;

    return { count1v1, count1v2, total, normalCancel, freeQuota, freeApproved, penalty };
  };

  const monthlyBookings = bookings
    .filter(b => (userRole === 'admin' || b.teacherId === currentUserId) && b.date.startsWith(prefix))
    .sort((a, b) => b.date.localeCompare(a.date));

  const toggleStatus = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTeachers({ ...teachers, [id]: { ...teachers[id], isActive: !teachers[id].isActive } });
  };

  const handleColorChange = (id: string, c: typeof PRESET_COLORS[number], e: React.MouseEvent) => {
    e.stopPropagation();
    setTeachers(prev => ({
      ...prev,
      [id]: { ...prev[id], color: c.color, bgLight: c.bgLight, border: c.border, text: c.text }
    }));
    setColorPickerOpenId(null);
  };

  return (
    <div className="space-y-4">
      {/* 1. 當月統計數據表 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex justify-between items-center border-b pb-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-slate-800">當月統計</h2>
            <select 
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-xs border rounded-xl px-2.5 py-1 bg-slate-50 font-black text-slate-800"
            >
              <option value="10月">2026 年 10 月</option>
              <option value="9月">2026 年 09 月</option>
              <option value="8月">2026 年 08 月</option>
            </select>
          </div>

          <button onClick={() => alert('已匯出 CSV')} className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> 匯出 CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-center border-collapse text-[11px] sm:text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-mono border-b text-[11px]">
                <th className="py-2.5 px-1 text-left font-sans w-[20%]">老師</th>
                <th className="py-2.5 px-0.5 w-[11%]">1v1</th>
                <th className="py-2.5 px-0.5 w-[11%]">1v2</th>
                <th className="py-2.5 px-0.5 w-[14%] font-black text-slate-800">總堂</th>
                <th className="py-2.5 px-0.5 w-[11%] text-slate-600">一般</th>
                <th className="py-2.5 px-0.5 w-[11%] text-indigo-600 font-bold">免罰</th>
                <th className="py-2.5 px-0.5 w-[11%] text-rose-600 font-bold">計罰</th>
                <th className="py-2.5 px-0.5 w-[11%] text-emerald-600 font-bold">免額</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
              {Object.values(teachers).map(t => {
                const s = getTeacherStats(t.id);
                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-1 font-black font-sans text-left truncate">
                      <span className={t.text}>{t.name}</span>
                    </td>
                    <td className="py-2.5 px-0.5">{s.count1v1}</td>
                    <td className="py-2.5 px-0.5">{s.count1v2}</td>
                    <td className="py-2.5 px-0.5 font-black text-slate-900">{s.total}</td>
                    <td className="py-2.5 px-0.5 text-slate-600">{s.normalCancel}</td>
                    <td className="py-2.5 px-0.5 text-indigo-600 font-bold">{s.freeApproved}</td>
                    <td className="py-2.5 px-0.5 text-rose-600 font-bold">{s.penalty}</td>
                    <td className="py-2.5 px-0.5 text-emerald-600 font-bold">{s.freeQuota}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. 當月明細流水帳 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <h3 className="font-black text-slate-800">{selectedMonth} 月份明細流水帳</h3>
        <div className="space-y-2 divide-y font-mono">
          {monthlyBookings.map(b => (
            <div key={b.id} className="pt-2 flex justify-between items-center">
              <div>
                <p className="font-bold text-slate-800 font-sans">{b.date} {formatTimeStr(b.startHour, b.startMin)}</p>
                <p className="text-[11px] text-slate-400 font-sans">{teachers[b.teacherId]?.name} ｜ 學員: {b.studentName || '未填寫'} ({b.lessonType})</p>
              </div>
              <div>{getStatusBadge(b.status)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. 老師管理清單 */}
      <div className="space-y-3">
        <h2 className="text-base font-black text-slate-800 flex items-center gap-1.5">
          <Users className="w-5 h-5 text-rose-500" /> 老師名單與管理
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.values(teachers).map(t => (
            <div 
              key={t.id} 
              onClick={() => onSelectTeacher(t.id)}
              className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs cursor-pointer hover:border-rose-400 transition space-y-3"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setColorPickerOpenId(colorPickerOpenId === t.id ? null : t.id); }}
                      className={`w-4 h-4 rounded-full ${t.color} hover:ring-2 transition shrink-0`}
                      title="點擊切換代表色"
                    />
                    <p className={`text-sm font-black ${t.text}`}>{t.name}</p>
                  </div>
                  <p className="text-xs text-slate-500 font-bold mt-1">{t.priorityText}</p>
                </div>
                
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <button 
                    onClick={(e) => toggleStatus(t.id, e)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                      t.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {t.isActive ? '合作中' : '已停用'}
                  </button>
                </div>
              </div>

              {colorPickerOpenId === t.id && (
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1" onClick={e => e.stopPropagation()}>
                  <p className="text-[10px] text-slate-400 font-bold">自訂代表色 (排除紅色系):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map(c => (
                      <button
                        key={c.label}
                        onClick={(e) => handleColorChange(t.id, c, e)}
                        className="w-6 h-6 rounded-full border-2 transition hover:scale-110"
                        style={{ backgroundColor: c.dot }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   老師個人編輯內頁
   ========================================================================= */
function TeacherDetailView({ 
  teacher, 
  onBack, 
  bookings,
  onUpdateTeacher
}: { 
  teacher: TeacherProfile; 
  onBack: () => void;
  bookings: BookingItem[];
  onUpdateTeacher: (t: TeacherProfile) => void;
}) {
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [emailInput, setEmailInput] = useState(teacher.email);
  const [phoneInput, setPhoneInput] = useState(teacher.phone);
  const [selectedMonth, setSelectedMonth] = useState('10月');

  const monthPrefixMap: Record<string, string> = {
    '10月': '2026-10', '9月': '2026-09', '8月': '2026-08'
  };
  const prefix = monthPrefixMap[selectedMonth] || '2026-10';

  const teacherMonthlyBookings = bookings
    .filter(b => b.teacherId === teacher.id && b.date.startsWith(prefix))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="flex items-center gap-2 border-b pb-3">
        <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className={`text-base font-black ${teacher.text}`}>{teacher.name} 老師個人管理檔案</h2>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2.5 text-xs">
        <div className="flex justify-between items-center">
          <p className="font-black text-slate-800">老師帳號基本資訊</p>
          <button 
            onClick={() => {
              if (isEditingInfo) {
                onUpdateTeacher({ ...teacher, email: emailInput, phone: phoneInput });
                setIsEditingInfo(false);
              } else {
                setIsEditingInfo(true);
              }
            }}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 shadow-xs"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {isEditingInfo ? '儲存資訊' : '修改資訊'}
          </button>
        </div>

        {isEditingInfo ? (
          <div className="space-y-2 pt-1 font-mono">
            <div>
              <label className="text-slate-400 font-bold">Email (登入帳號)</label>
              <input type="text" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="w-full border rounded-xl p-2 mt-0.5" />
            </div>
            <div>
              <label className="text-slate-400 font-bold">電話</label>
              <input type="text" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} className="w-full border rounded-xl p-2 mt-0.5" />
            </div>
          </div>
        ) : (
          <div className="space-y-1 font-mono text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <p>• Email: {teacher.email}</p>
            <p>• 電話: {teacher.phone}</p>
            <p>• 固定優先時段: <span className="font-bold text-slate-800">{teacher.priorityText}</span></p>
          </div>
        )}
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2 text-xs">
        <h3 className="font-black text-slate-800">近 5 個月授課統計總表</h3>
        <table className="w-full text-center border-collapse text-[11px] font-mono">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b">
              <th className="p-2 text-left font-sans">月份</th>
              <th className="p-2">1v1</th>
              <th className="p-2">1v2</th>
              <th className="p-2 font-black text-slate-800">總堂數</th>
              <th className="p-2">一般/免額/免罰/計罰</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            <tr>
              <td className="p-2 text-left font-bold font-sans">2026/10 (當月)</td>
              <td className="p-2">10</td><td className="p-2">12</td>
              <td className="p-2 font-black text-slate-900">22</td>
              <td className="p-2">1 / 2 / 1 / 0</td>
            </tr>
            <tr>
              <td className="p-2 text-left font-sans">2026/09</td>
              <td className="p-2">12</td><td className="p-2">15</td>
              <td className="p-2 font-black text-slate-900">27</td>
              <td className="p-2">2 / 2 / 0 / 0</td>
            </tr>
            <tr>
              <td className="p-2 text-left font-sans">2026/08</td>
              <td className="p-2">10</td><td className="p-2">14</td>
              <td className="p-2 font-black text-slate-900">24</td>
              <td className="p-2">1 / 2 / 1 / 0</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-black text-slate-800">專屬授課明細流水帳</h3>
          <select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1 font-bold bg-white"
          >
            <option value="10月">2026 年 10 月</option>
            <option value="9月">2026 年 09 月</option>
            <option value="8月">2026 年 08 月</option>
          </select>
        </div>

        <div className="space-y-2 divide-y font-mono">
          {teacherMonthlyBookings.length === 0 ? (
            <p className="text-slate-300 text-center py-2 font-sans">該月份無授課紀錄</p>
          ) : (
            teacherMonthlyBookings.map(b => (
              <div key={b.id} className="pt-2 flex justify-between items-center">
                <div>
                  <p className="font-bold text-slate-800 font-sans">{b.date} {formatTimeStr(b.startHour, b.startMin)}</p>
                  <p className="text-[11px] text-slate-400 font-sans">學員: {b.studentName || '未填寫'} ({b.lessonType})</p>
                </div>
                <div>{getStatusBadge(b.status)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Tab 5: 規範與審核 (Log 通知系統、紅黃色標、一鍵已讀、Undo、優先排課免橫捲)
   ========================================================================= */
function Tab5RulesAndPriority({ 
  userRole, 
  currentUserId,
  teachers,
  priorityGrid,
  onUpdatePriorityGrid,
  reviews,
  onReview,
  onReset,
  auditLogs,
  setAuditLogs,
  studioRules,
  setStudioRules,
  showToast
}: { 
  userRole: 'admin' | 'teacher'; 
  currentUserId: string;
  teachers: Record<string, TeacherProfile>;
  priorityGrid: Record<string, string>;
  onUpdatePriorityGrid: (grid: Record<string, string>) => void;
  reviews: ReviewItem[];
  onReview: (id: string, newStatus: 'approved' | 'rejected') => void;
  onReset: (id: string) => void;
  auditLogs: AuditLogItem[];
  setAuditLogs: React.Dispatch<React.SetStateAction<AuditLogItem[]>>;
  studioRules: string;
  setStudioRules: (rules: string) => void;
  showToast: (msg: string) => void;
}) {
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState(studioRules);
  const [isEditingStudioRules, setIsEditingStudioRules] = useState(false);

  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const hoursList = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

  const displayLogs = useMemo(() => {
    if (userRole === 'admin') return auditLogs;
    return auditLogs.filter(l => l.teacherId === currentUserId || l.category === 'yellow');
  }, [auditLogs, userRole, currentUserId]);

  const myReviews = useMemo(() => {
    return reviews.filter(r => r.teacherId === currentUserId);
  }, [reviews, currentUserId]);

  const toggleLogRead = (id: string) => {
    setAuditLogs(prev => prev.map(l => l.id === id ? { ...l, read: !l.read } : l));
  };

  const markAllLogsRead = () => {
    setAuditLogs(prev => prev.map(l => ({ ...l, read: true })));
    showToast('所有通知已標示為已讀');
  };

  const handleAssignTeacher = (teacherId: string | null) => {
    if (!selectedSlotKey) return;
    const updated = { ...priorityGrid };
    if (teacherId === null) {
      delete updated[selectedSlotKey];
    } else {
      updated[selectedSlotKey] = teacherId;
    }
    onUpdatePriorityGrid(updated);
    setSelectedSlotKey(null);
  };

  return (
    <div className="space-y-4">
      {/* 一般老師：我的審核進度 */}
      {userRole !== 'admin' && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <h3 className="font-black text-slate-800 flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-sky-600" /> 我的請假與變更審核進度
          </h3>

          <div className="space-y-2">
            {myReviews.length === 0 ? (
              <p className="text-slate-300 text-center py-2">目前無送審中的案件</p>
            ) : (
              myReviews.map(r => (
                <div key={r.id} className="p-2.5 rounded-xl border bg-slate-50 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-800">{r.date} {r.time} ({r.room})</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">原因: {r.reason}</p>
                  </div>
                  <div>
                    {r.status === 'pending' && <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">待審核</span>}
                    {r.status === 'approved' && <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">已核准免罰</span>}
                    {r.status === 'rejected' && <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold">已退回計罰</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 優先排課課表 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-base font-black text-slate-800">優先排課課表</h2>
            <p className="text-[11px] text-slate-400">橫軸星期 一~日，縱軸小時 8~21</p>
          </div>

          {userRole === 'admin' && (
            <button 
              onClick={() => setIsEditingPriority(!isEditingPriority)}
              className={`text-xs px-3 py-1.5 rounded-xl font-bold transition ${
                isEditingPriority ? 'bg-rose-500 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {isEditingPriority ? '完成編輯' : '編輯排課'}
            </button>
          )}
        </div>

        <div className="flex gap-2.5 flex-wrap text-xs font-bold border-b pb-2">
          {Object.values(teachers).map(t => (
            <span key={t.id} className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${t.color}`} /> {t.name}
            </span>
          ))}
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-center border-collapse text-xs table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b text-xs text-slate-600 font-bold">
                <th className="py-2 px-1 border-r w-8 font-mono">時</th>
                {days.map(d => <th key={d} className="py-2 px-0.5 border-r font-black text-slate-800">{d}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y text-xs font-mono">
              {hoursList.map(h => (
                <tr key={h} className="hover:bg-slate-50 transition">
                  <td className="py-1 px-1 bg-slate-50/70 font-bold border-r text-slate-400 text-center">{h}</td>
                  {days.map(d => {
                    const slotKey = `${d}-${h}`;
                    const assignedTeacherId = priorityGrid[slotKey];
                    const teacher = assignedTeacherId ? teachers[assignedTeacherId] : null;

                    return (
                      <td 
                        key={d} 
                        onClick={() => { if (isEditingPriority) setSelectedSlotKey(slotKey); }}
                        className={`py-1 px-0.5 border-r transition truncate ${isEditingPriority ? 'cursor-pointer hover:bg-rose-50/50' : ''}`}
                      >
                        {teacher ? (
                          <span className={`${teacher.bgLight} ${teacher.text} font-black px-1 py-0.5 rounded text-[10px] border ${teacher.border} inline-block w-full truncate`}>
                            {teacher.name}
                          </span>
                        ) : (
                          <span className="text-slate-200">-</span>
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

      {/* 工作室規範 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2.5 text-xs">
        <div className="flex justify-between items-center">
          <h3 className="font-black text-slate-800">工作室規範</h3>
          {userRole === 'admin' && (
            <button 
              onClick={() => {
                if (isEditingStudioRules) {
                  setStudioRules(rulesDraft);
                  setIsEditingStudioRules(false);
                  showToast('工作室規範已儲存更新！');
                } else {
                  setIsEditingStudioRules(true);
                }
              }} 
              className="text-xs bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1"
            >
              <Save className="w-3.5 h-3.5 text-emerald-400" />
              {isEditingStudioRules ? '儲存規範' : '編輯規範'}
            </button>
          )}
        </div>

        {isEditingStudioRules ? (
          <textarea 
            value={rulesDraft}
            onChange={(e) => setRulesDraft(e.target.value)}
            className="w-full border-2 border-rose-300 rounded-xl p-3 text-slate-700 focus:outline-none leading-relaxed font-sans"
            rows={4}
          />
        ) : (
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700 whitespace-pre-line leading-relaxed font-sans">
            {studioRules}
          </div>
        )}
      </div>

      {/* Log 與通知中心 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-black text-slate-800 flex items-center gap-1.5">
            <History className="w-4 h-4 text-slate-600" /> 
            {userRole === 'admin' ? '全系統操作與異動 Log' : '與我相關的異動與通知 Log'}
          </h3>

          <button 
            onClick={markAllLogsRead} 
            className="text-[11px] text-slate-500 hover:text-slate-800 font-bold flex items-center gap-1"
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-600" /> 一鍵已讀
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {displayLogs.map(log => {
            const isRed = log.category === 'red';
            const isYellow = log.category === 'yellow';

            return (
              <div 
                key={log.id} 
                onClick={() => toggleLogRead(log.id)}
                className={`p-2.5 rounded-xl border transition cursor-pointer flex justify-between items-center ${
                  isRed 
                    ? 'bg-rose-50/80 border-rose-200 text-rose-950' 
                    : isYellow 
                      ? 'bg-amber-50/80 border-amber-200 text-amber-950' 
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                } ${log.read ? 'opacity-60 grayscale-[40%]' : 'font-bold shadow-xs'}`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${isRed ? 'bg-rose-500' : isYellow ? 'bg-amber-500' : 'bg-slate-400'}`} />
                    <span className="font-black text-slate-900">{log.actor}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({log.time})</span>
                  </div>
                  <p className="text-[11px] leading-tight pl-3.5">{log.action}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                  {userRole === 'admin' && log.reviewId && (
                    <button 
                      onClick={() => onReset(log.reviewId!)} 
                      className="bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-0.5"
                    >
                      <RotateCcw className="w-3 h-3" /> 撤銷
                    </button>
                  )}

                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${log.read ? 'text-slate-400 bg-white/70' : 'text-blue-600 bg-blue-50 border border-blue-200'}`}>
                    {log.read ? '已讀' : '未讀'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 指派時段 Modal */}
      {selectedSlotKey && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-3.5 border border-slate-100">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-bold text-slate-800">指派優先時段老師 ({selectedSlotKey})</h3>
              <button onClick={() => setSelectedSlotKey(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2 pt-1 text-xs">
              {Object.values(teachers).map(t => (
                <button 
                  key={t.id}
                  onClick={() => handleAssignTeacher(t.id)}
                  className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between font-bold hover:border-rose-400 transition"
                >
                  <span className={t.text}>{t.name}</span>
                  <span className={`w-3 h-3 rounded-full ${t.color}`} />
                </button>
              ))}

              <button 
                onClick={() => handleAssignTeacher(null)}
                className="w-full text-center p-2.5 rounded-xl border border-dashed border-red-200 text-red-500 hover:bg-red-50 transition mt-2 font-bold"
              >
                設為空白
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Tab 2: 特殊取消審核
   ========================================================================= */
function Tab2Reviews({ 
  reviews, 
  onReview, 
  onReset 
}: { 
  reviews: ReviewItem[];
  onReview: (id: string, newStatus: 'approved' | 'rejected') => void;
  onReset: (id: string) => void;
}) {
  const pendingList = reviews.filter(r => r.status === 'pending');
  const processedList = reviews.filter(r => r.status !== 'pending');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-black text-slate-800 flex items-center gap-1.5">
          <Bell className="w-5 h-5 text-rose-500" />
          24H 特殊取消審核
        </h2>
        <span className="text-xs px-2.5 py-1 bg-rose-100 text-rose-700 font-bold rounded-full">
          待審：{pendingList.length}
        </span>
      </div>

      <div className="space-y-3">
        {pendingList.length === 0 ? (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-xs text-slate-400 font-bold">
            無待審核項目
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingList.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-2xl border border-rose-100 shadow-xs space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 flex-wrap">
                  <span className="text-sm font-black text-rose-600">{item.teacherName}</span>
                  <span className="text-slate-300 font-normal">｜</span>
                  <span className="font-mono text-slate-600 font-bold">{item.time}</span>
                  <span className="text-slate-300 font-normal">｜</span>
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-medium">
                    {item.room} ({item.lessonType})
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl text-xs text-slate-700 font-medium">
                  原因：{item.reason}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button 
                    onClick={() => onReview(item.id, 'approved')} 
                    className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-bold"
                  >
                    核准免罰
                  </button>
                  <button 
                    onClick={() => onReview(item.id, 'rejected')} 
                    className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 py-1.5 rounded-xl text-xs font-bold"
                  >
                    退回計罰
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {processedList.length > 0 && (
        <div className="space-y-2 pt-3 border-t">
          <p className="text-xs text-slate-500 font-bold">已處理紀錄 (可 Undo 撤銷復原)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {processedList.map(item => (
              <div key={item.id} className="bg-slate-100 p-2.5 rounded-xl flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-800">{item.teacherName} ｜ {item.time}</span>
                  <span className={`ml-2 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    item.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}>
                    {item.status === 'approved' ? '特殊免罰' : '特殊計罰'}
                  </span>
                </div>
                <button 
                  onClick={() => onReset(item.id)} 
                  className="text-slate-600 hover:text-slate-900 text-xs bg-white px-2 py-1 rounded-lg shadow-xs border font-bold flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> 撤銷 (Undo)
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   建立學生檔案彈窗 (Modal)
   ========================================================================= */
function CreateStudentModal({ 
  isOpen, 
  onClose, 
  currentTeacherId,
  existingBookings,
  onSave 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  currentTeacherId: string;
  existingBookings: BookingItem[];
  onSave: (studentData: any, generatedNewBookings?: any[], engineMsg?: string) => void; 
}) {
  const [isTrial, setIsTrial] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('0912-000-000');
  const [note, setNote] = useState('');
  const [credits, setCredits] = useState<number>(10);
  const [noRegularRule, setNoRegularRule] = useState(false);

  const [rules, setRules] = useState<StudentRule[]>([]);
  const [newRule, setNewRule] = useState<StudentRule>({
    id: 'r-init',
    freq: '每週',
    day: '一',
    time: '09:00',
    startDate: '2026-10-19',
    roomType: 'small',
    lessonType: '1v1'
  });

  const handleAddRule = () => {
    if (!newRule.startDate) return alert('請選擇起始生效日期');
    setRules([...rules, { ...newRule, id: `rule-${Date.now()}` }]);
  };

  const handleRemoveRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const handleSubmit = () => {
    if (!name.trim()) return alert('請輸入學生姓名');
    const newStudentId = `s-${Date.now()}`;
    const newStudentObj: StudentItem = {
      id: newStudentId,
      name,
      phone,
      teacherId: currentTeacherId,
      note,
      credits: isTrial ? 1 : Number(credits),
      lessonType: '1v1',
      isTrial,
      noRegularRule,
      rules: isTrial || noRegularRule ? [] : rules,
      status: 'active',
      nextLesson: rules[0] ? `${rules[0].freq}週${rules[0].day} ${rules[0].time}` : '未排定',
      purchases: [
        {
          id: `p-${Date.now()}`,
          date: '2026-10-18',
          credits: isTrial ? 1 : Number(credits),
          amountText: isTrial ? '體驗課購課 ($1,500)' : `初始建檔購買 ${credits} 堂 ($24,000)`
        }
      ]
    };

    let generatedBookings: any[] = [];
    let engineMsg = `已建立學員檔案：${name}`;

    if (!isTrial && !noRegularRule && rules.length > 0) {
      const engine = new ScheduleEngine(existingBookings as any);
      const result = engine.generateSchedule({
        sid: newStudentId,
        credits: Number(credits),
        slots: rules,
        conflictPolicy: 'skip',
        maxWeeksLimit: 12
      });

      if (result.success) {
        generatedBookings = result.newRecords.map((r: any) => ({
          id: r.id,
          date: r.date,
          startHour: parseInt(r.time.split(':')[0]),
          startMin: parseInt(r.time.split(':')[1]),
          durationMins: 50,
          teacherId: currentTeacherId,
          studentName: name,
          studentId: newStudentId,
          roomType: r.roomType || 'small',
          lessonType: r.lessonType || '1v1',
          status: 'confirmed'
        }));
        engineMsg = result.message;
      }
    }

    onSave(newStudentObj, generatedBookings, engineMsg);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto border border-slate-100 animate-in fade-in zoom-in-95">
        
        <div className="flex justify-between items-center border-b pb-3">
          <h3 className="text-base font-black text-slate-800">建立學生檔案</h3>
          <label className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold cursor-pointer border border-emerald-200">
            <input 
              type="checkbox" 
              checked={isTrial} 
              onChange={(e) => setIsTrial(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-400" 
            />
            <span>🌱 體驗課模式</span>
          </label>
        </div>

        <div className="space-y-3 text-xs">
          <input 
            type="text" 
            placeholder="學生姓名 (不需加體驗二字)" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded-2xl p-3 bg-slate-50/50 text-sm font-bold focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
          />

          <input 
            type="text" 
            placeholder="聯絡電話" 
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border rounded-2xl p-3 bg-slate-50/50 text-xs font-mono font-bold focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
          />

          <input 
            type="text" 
            placeholder="學生狀況 / 身體備註 (例如：左膝舊傷，避免過度前屈)" 
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border rounded-2xl p-3 bg-slate-50/50 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
          />

          {!isTrial && (
            <div>
              <label className="text-slate-400 font-bold text-[10px] pl-1">購買堂數</label>
              <input 
                type="number" 
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value))}
                className="w-full border rounded-2xl p-3 bg-slate-50/50 text-sm font-mono font-bold focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
              />
            </div>
          )}
        </div>

        {!isTrial && (
          <div className="bg-indigo-50/60 p-4 rounded-2xl border border-indigo-100 space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-black text-indigo-900 text-xs flex items-center gap-1">
                🕒 長期排課規則設定器
              </span>
              <label className="flex items-center gap-1.5 text-indigo-700 text-xs font-bold cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={noRegularRule} 
                  onChange={(e) => setNoRegularRule(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-400" 
                />
                <span>暫無固定規則</span>
              </label>
            </div>

            {!noRegularRule && (
              <div className="bg-white p-3 rounded-2xl border border-indigo-100 space-y-2.5">
                <p className="text-[11px] font-bold text-indigo-600">＋ 新增排課規則 (頻率/時段/起始日)</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                  <select 
                    value={newRule.freq}
                    onChange={(e) => setNewRule({ ...newRule, freq: e.target.value })}
                    className="border rounded-xl p-2 bg-slate-50 font-bold"
                  >
                    <option value="每週">每週</option>
                    <option value="隔週">隔週</option>
                  </select>

                  <div className="flex items-center gap-1">
                    <select 
                      value={newRule.day}
                      onChange={(e) => setNewRule({ ...newRule, day: e.target.value })}
                      className="border rounded-xl p-2 bg-slate-50 font-bold flex-1"
                    >
                      {['一', '二', '三', '四', '五', '六', '日'].map(d => (
                        <option key={d} value={d}>週{d}</option>
                      ))}
                    </select>

                    <input 
                      type="time" 
                      value={newRule.time}
                      onChange={(e) => setNewRule({ ...newRule, time: e.target.value })}
                      className="border rounded-xl p-2 bg-slate-50 font-mono font-bold"
                    />
                  </div>

                  <input 
                    type="date" 
                    value={newRule.startDate}
                    onChange={(e) => setNewRule({ ...newRule, startDate: e.target.value })}
                    className="border rounded-xl p-2 bg-slate-50 font-mono text-[11px]"
                  />

                  <button 
                    onClick={handleAddRule}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-xl text-xs transition"
                  >
                    新增規則
                  </button>
                </div>

                {rules.length > 0 && (
                  <div className="pt-2 border-t space-y-1">
                    {rules.map(r => (
                      <div key={r.id} className="flex justify-between items-center bg-indigo-50/50 px-2.5 py-1.5 rounded-xl text-xs font-mono">
                        <span className="font-sans font-bold text-indigo-900">
                          {r.freq}週{r.day} {r.time} (起始: {r.startDate})
                        </span>
                        <button onClick={() => handleRemoveRule(r.id)} className="text-red-400 hover:text-red-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="pt-2 flex gap-2">
          <button onClick={onClose} className="flex-1 bg-slate-100 py-3 rounded-2xl text-xs font-bold text-slate-600">
            取消
          </button>
          <button onClick={handleSubmit} className="flex-1 bg-rose-500 hover:bg-rose-600 text-white py-3 rounded-2xl text-xs font-bold shadow-xs">
            儲存並預排課程
          </button>
        </div>

      </div>
    </div>
  );
}