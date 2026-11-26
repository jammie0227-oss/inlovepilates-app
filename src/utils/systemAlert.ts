// 全站自訂提示彈窗（取代瀏覽器原生 alert，避免顯示網址標題列）
export interface SystemAlertPayload {
  title: string;
  message: string;
}

type Listener = (p: SystemAlertPayload) => void;
let listener: Listener | null = null;

export const registerSystemAlert = (fn: Listener | null) => {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
};

/** 未指定標題時，取內文開頭「【標題】\n」作為標題，否則為「系統提醒」。 */
export const systemAlert = (message: string, title?: string): void => {
  let body = String(message ?? '');
  let t = title;
  if (!t) {
    const m = body.match(/^【([^】]+)】\n/);
    if (m) {
      t = m[1];
      body = body.slice(m[0].length);
    }
  }
  const payload = { title: t || '系統提醒', message: body };
  if (listener) listener(payload);
  else if (typeof window !== 'undefined') window.alert(`${payload.title}\n${payload.message}`);
};

// ------------------------------------------
// 自訂確認彈窗（取代原生 confirm，回傳 Promise）
// ------------------------------------------
export interface SystemDialogRequest {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  resolve: (value: boolean) => void;
}

type DialogListener = (r: SystemDialogRequest) => void;
let dialogListener: DialogListener | null = null;

export const registerSystemDialog = (fn: DialogListener | null) => {
  dialogListener = fn;
  return () => {
    if (dialogListener === fn) dialogListener = null;
  };
};

const splitTitle = (message: string, title?: string) => {
  let body = String(message ?? '');
  let t = title;
  if (!t) {
    const m = body.match(/^【([^】]+)】\n/);
    if (m) {
      t = m[1];
      body = body.slice(m[0].length);
    }
  }
  return { title: t || '請確認', body };
};

/** 取代 confirm()：確定 → true，取消 → false */
export const systemConfirm = (message: string, title?: string): Promise<boolean> =>
  new Promise(resolve => {
    const { title: t, body } = splitTitle(message, title);
    if (dialogListener) dialogListener({ title: t, message: body, resolve });
    else resolve(typeof window !== 'undefined' ? window.confirm(`${t}\n${body}`) : false);
  });
