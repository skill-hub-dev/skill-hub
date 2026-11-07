// 自訂表格分頁：讀設定檔 tables 列出的 JSON，每個檔案在儀表板成為一個分頁
//
//   {
//     "title": "分頁名稱",
//     "description": "一句說明（選填）",
//     "views": [
//       { "title": "子選單名稱", "note": "說明（選填）", "columns": ["欄 1", "欄 2"], "rows": [["值", "值"]] }
//     ]
//   }
//
// 檔案由其他工具產生，內容只放進 outDir，不進版控。
import fs from 'node:fs';
import { readJson } from './config.mjs';

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 檢查一個表格檔的內容；回傳錯誤說明，沒問題回傳 null */
export function tableProblem(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return '不是物件';
  if (typeof t.title !== 'string' || !t.title) return '缺少 title';
  if (!Array.isArray(t.views) || !t.views.length) return 'views 要是至少一項的陣列';
  for (const [i, v] of t.views.entries()) {
    const at = `views[${i}]`;
    if (!v || typeof v.title !== 'string' || !v.title) return `${at} 缺少 title`;
    if (!isStrings(v.columns)) return `${at}.columns 要是文字陣列`;
    if (!Array.isArray(v.rows) || !v.rows.every(isStrings)) return `${at}.rows 每一列要是文字陣列`;
  }
  return null;
}

/** 讀所有表格檔：能讀的進 tables，讀不了的進 notes（儀表板「設定與說明」會列出） */
export function loadTables(files) {
  const tables = [];
  const notes = [];
  for (const file of files) {
    if (!fs.existsSync(file)) { notes.push(`找不到自訂表格 ${file}`); continue; }
    let t;
    try { t = readJson(file); } catch (e) { notes.push(`自訂表格 ${file} 不是正確的 JSON：${e.message}`); continue; }
    const problem = tableProblem(t);
    if (problem) { notes.push(`自訂表格 ${file}：${problem}`); continue; }
    tables.push({
      title: t.title,
      description: typeof t.description === 'string' ? t.description : '',
      views: t.views.map((v) => ({ title: v.title, note: typeof v.note === 'string' ? v.note : '', columns: v.columns, rows: v.rows })),
    });
  }
  return { tables, notes };
}
