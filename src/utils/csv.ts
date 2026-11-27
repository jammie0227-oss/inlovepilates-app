// ==========================================
// csv.ts — CSV 組裝與下載
// ==========================================
export type CsvCell = string | number | null | undefined;

/** 試算表會把這些開頭的文字當成公式執行（含全形符號） */
const FORMULA_PREFIX = /^[\s]*[=+\-@＝＋－＠]|^[\t\r\n]/;

/** 單一欄位：文字防公式注入（前綴單引號），一律加引號並跳脫引號 */
export const toCsvCell = (value: CsvCell): string => {
  const raw = String(value ?? '');
  const safe = typeof value === 'string' && FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const toCsv = (rows: CsvCell[][]): string =>
  rows.map(row => row.map(toCsvCell).join(',')).join('\r\n');

/** 下載 CSV；開頭加 UTF-8 BOM，Excel 開啟中文不亂碼 */
export const downloadCsv = (filename: string, content: string): void => {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 部分瀏覽器在 click 之後才讀取內容，延後釋放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
