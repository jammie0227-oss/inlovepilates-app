import React, { useRef, useState, useEffect } from 'react';
import { PenTool, X, RotateCcw, Check } from 'lucide-react';

// ==========================================
// 0. 手寫畫布元件 (內嵌供 CanvasPadModal 使用)
// ==========================================
export function CanvasPad({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onConfirm(dataUrl);
  };

  return (
    <div className="space-y-3">
      <div className="border border-slate-200 rounded-2xl bg-slate-50 overflow-hidden relative touch-none">
        <canvas
          ref={canvasRef}
          width={320}
          height={160}
          className="w-full h-40 bg-white cursor-crosshair block"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-300 text-xs font-bold">
            請在此區域簽名
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={handleClear}
          className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl font-bold flex items-center gap-1 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" /> 清除
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-bold transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 text-xs bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold flex items-center gap-1 shadow-sm transition active:scale-95"
          >
            <Check className="w-3.5 h-3.5" /> 確認簽名
          </button>
        </div>
      </div>
    </div>
  );
}
// ==========================================
// 1. 課堂狀態標籤元件 (支援縮圖與放大回調)
// ==========================================
interface BookingStatusBadgeProps {
  booking: any;
  onZoomSignature?: (data: { url: string; time: string }) => void;
}

export function BookingStatusBadge({ booking: b, onZoomSignature }: BookingStatusBadgeProps) {
  if (!b) return null;
    return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* 1. 系統代簽 / 系統代結 (最優先判定) */}
      {(b.settlementType === 'system_deducted' || b.isSystemSigned) ? (
        <span 
          className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 font-black px-2 py-0.5 rounded-full shadow-2xs flex items-center gap-0.5"
          title={b.overdueReason ? `系統代簽原因：${b.overdueReason}` : '月底未簽到，系統自動代結扣堂'}
        >
          ⚡ 系統代簽
        </span>
      ) : b.settlementType === 'unattended_no_credit_deducted' ? (
        /* 2. 未到課 (不扣堂) */
        <span className="text-[10px] bg-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-full shadow-2xs">
          ✕ 未到課 (未扣堂)
        </span>
      ) : b.isLateSigned ? (
        /* 3. 逾期補簽 (金黃色標籤) */
        <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300 font-black px-1.5 py-0.5 rounded shadow-2xs">
          補簽
        </span>
      ) : b.signed ? (
        /* 4. 正常親簽 (綠色標籤) */
        <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-black px-1.5 py-0.5 rounded shadow-2xs">
          已簽到
        </span>
      ) : null}

      {/* 簽名筆跡縮圖 (僅在有手寫筆跡且傳入縮放 callback 時呈現) */}
      {b.signatureData?.startsWith('data:image') && onZoomSignature && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onZoomSignature({ url: b.signatureData!, time: b.signedAt || '' });
          }}
          className="border border-emerald-300 rounded p-0.5 bg-white cursor-pointer hover:bg-emerald-50 transition shadow-2xs"
          title="點擊放大簽名"
        >
          <img src={b.signatureData} alt="簽名" className="h-4 w-10 object-contain" />
        </div>
      )}
    </div>
  );
}

// ==========================================
// 2. 手寫簽名彈窗元件 (自動處理補簽與 ID 相容)
// ==========================================
interface CanvasPadModalProps {
  signModalTarget: any; // 支援傳入 bookingId 字串或 booking 物件
  bookings: any[];
  systemBaseDate: string;
  onClose: () => void;
  onSign: (bookingId: string, url: string, timestamp: string, isLate: boolean) => void;
  getExactTimestamp: () => string;
}

export function CanvasPadModal({
  signModalTarget,
  bookings,
  systemBaseDate,
  onClose,
  onSign,
  getExactTimestamp,
}: CanvasPadModalProps) {
  if (!signModalTarget) return null;

  // 相容物件型態或純字串 ID
  const targetBookingId =
    typeof signModalTarget === 'object' && signModalTarget !== null
      ? signModalTarget.id
      : signModalTarget;

  const targetBk = bookings.find((b: any) => b.id === targetBookingId);
  const studentDisplayName =
    targetBk?.studentName ||
    (typeof signModalTarget === 'object' ? signModalTarget.studentName : '') ||
    '學員';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-100 animate-in zoom-in-95">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-black text-slate-800 text-sm flex items-center gap-1.5">
            <PenTool className="w-4 h-4 text-rose-500" /> 手寫簽名 ({studentDisplayName})
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <CanvasPad
          onCancel={onClose}
          onConfirm={(url: string) => {
            // 比對日期：小於系統基準日即為逾期補簽
            const isLate = targetBk ? targetBk.date < systemBaseDate : true;

            if (typeof onSign === 'function') {
              onSign(targetBookingId, url, getExactTimestamp(), isLate);
            }

            onClose();
          }}
        />
      </div>
    </div>
  );
}



// 3. 放大檢視簽名存根彈窗
export function SignatureZoomModal({ zoomedSignature, onClose }: any) {
  if (!zoomedSignature) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl text-center border animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xs font-black text-slate-800 mb-3">簽名存根檢視</h3>
        <div className="p-2 bg-slate-50 rounded-2xl border border-slate-200">
          <img
            src={zoomedSignature.url}
            alt="憑證"
            className="w-full h-32 object-contain bg-white rounded-xl shadow-2xs"
          />
        </div>
        <p className="text-[10px] font-mono text-slate-500 font-bold mt-2">
          簽署時間：{zoomedSignature.time}
        </p>
        <button
          className="w-full bg-slate-800 hover:bg-slate-700 transition text-white py-2 rounded-xl text-xs font-bold mt-4 shadow-xs"
          onClick={onClose}
        >
          關閉
        </button>
      </div>
    </div>
  );
}