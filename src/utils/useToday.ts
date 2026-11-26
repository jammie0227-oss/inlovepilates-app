import { useMemo, useSyncExternalStore } from 'react';

const getTodayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 定時與回到前景時重新檢查，頁面開著跨日也會換到新的一天
const subscribe = (onChange: () => void) => {
  const timer = setInterval(onChange, 30_000);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onChange);
  };
};

const getServerSnapshot = () => '';

/**
 * 使用者端的今天 'YYYY-MM-DD'。
 * 預先渲染與 hydration 階段回傳空字串（呼叫端據此暫不輸出畫面），避免日期不一致。
 */
export const useToday = (): string => useSyncExternalStore(subscribe, getTodayKey, getServerSnapshot);

// 取整到分鐘：開課時間以分鐘為粒度，判斷結果與即時時間一致，且同一分鐘內快照穩定
const getMinuteKey = (): number => Math.floor(Date.now() / 60_000) * 60_000;
const getServerMinute = () => 0;

/** 使用者端的現在時間（每分鐘更新），供「是否已開課 / 逾期」判斷在頁面開著時自動換算。 */
export const useNow = (): Date => {
  const ms = useSyncExternalStore(subscribe, getMinuteKey, getServerMinute);
  return useMemo(() => new Date(ms), [ms]);
};
