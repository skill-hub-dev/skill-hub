// 把報告內嵌進儀表板範本，產生可直接雙擊開啟的單一 HTML
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dashboard.html');
// U+2028／U+2029 在舊版 JS 字串裡是換行，一併跳脫
const LINE_SEP = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

export function renderDashboard(report) {
  // 避免資料裡的 </script> 或 <!-- 提前結束 script 區塊
  const json = JSON.stringify(report)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const html = fs.readFileSync(TEMPLATE, 'utf8');
  if (!html.includes('/*__REPORT__*/null')) throw new Error('儀表板範本缺少 /*__REPORT__*/null 佔位');
  return html.replace('/*__REPORT__*/null', () => json);
}
