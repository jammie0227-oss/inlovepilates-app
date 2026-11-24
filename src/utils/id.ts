// 全站統一的安全 ID 產生器：避免同毫秒連續呼叫時 Date.now() 碰撞
let seq = 0;

export function genId(prefix: string): string {
  seq = (seq + 1) % 1_000_000;
  let rand = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    }
  } catch {
    /* 忽略，改用 Math.random 備援 */
  }
  if (!rand) rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${rand}`;
}
