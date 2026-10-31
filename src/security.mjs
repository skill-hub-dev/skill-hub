// 資安狀態：人工審查紀錄（security-reviews.json）＋自動掃描
// 自動掃描只做初篩，不能取代逐份閱讀的人工審查。
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './config.mjs';

// 檔案開頭的 BOM（Windows 記事本、PowerShell 存檔時常見）
const LEADING_BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

const SECRET = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const ch = (c) => String.fromCharCode(c);
// 零寬、雙向控制、word joiner、BOM（檔案開頭的 BOM 不算）、tag 字元
const HIDDEN = new RegExp(`[${ch(0x200b)}-${ch(0x200f)}${ch(0x202a)}-${ch(0x202e)}${ch(0x2060)}-${ch(0x2064)}${ch(0xfeff)}]|\\u{E0000}|[\\u{E0001}-\\u{E007F}]`, 'u');
const SCRIPT_EXT = /\.(m?js|cjs|ts|py|sh|ps1|bat|cmd|rb|pl)$/i;
const RISK = {
  // 結尾不加 \b：exec( 這類樣式結尾是括號，加了反而比對不到
  network: /\b(fetch|XMLHttpRequest|axios|requests\.|urllib|http\.request|https\.request|net\.connect|socket|curl|wget|Invoke-WebRequest|Invoke-RestMethod)/,
  exec: /\b(child_process|execSync|spawnSync|exec\(|spawn\(|subprocess|os\.system|eval\(|new Function|Start-Process|Invoke-Expression)/,
  writes: /\b(writeFile|appendFile|unlink|rmSync|rmdir|Remove-Item|Set-Content|Out-File)\b|open\([^)]*['"][wa]/,
};
const RISK_LABEL = { network: '連網', exec: '執行其他程式', writes: '寫檔或刪檔' };

/** 掃描 skill 資料夾：密鑰、隱藏字元、腳本與其中的風險呼叫 */
export function scanSkillDir(dir) {
  const result = { secrets: [], hidden: [], scripts: [] };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (fs.statSync(p).size > 2 * 1024 * 1024) continue;
      const buf = fs.readFileSync(p);
      if (buf.includes(0)) continue; // 二進位檔
      const rel = path.relative(dir, p).split(path.sep).join('/');
      const text = buf.toString('utf8').replace(LEADING_BOM, '');
      if (SECRET.test(text)) result.secrets.push(rel);
      if (HIDDEN.test(text)) result.hidden.push(rel);
      if (SCRIPT_EXT.test(e.name)) {
        const risks = Object.entries(RISK).filter(([, re]) => re.test(text)).map(([k]) => RISK_LABEL[k]);
        result.scripts.push({ file: rel, risks });
      }
    }
  };
  walk(dir);
  return result;
}

export function loadReviews(file) {
  if (!file || !fs.existsSync(file)) return [];
  const raw = readJson(file);
  return (Array.isArray(raw) ? raw : raw.reviews || []).filter((r) => r.skill && r.date);
}

export function appendReview(file, record) {
  const list = loadReviews(file);
  list.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ reviews: list }, null, 2)}\n`);
}

/**
 * 依最新一筆審查紀錄與之後的修改，判斷狀態：
 * passed 已檢查／partial 部分檢查／stale 審查後有修改／failed 未通過／none 未檢查
 */
export function reviewStatus(skill, reviews) {
  const key = skill.name || skill.folder;
  const mine = reviews.filter((r) => r.skill === key).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = mine[0] || null;
  if (!latest) return { status: 'none', review: null, history: [], changedSince: 0 };
  // 紀錄只有日期時，當天結束前的修改都算在審查範圍內
  const end = /T/.test(latest.date) ? Date.parse(latest.date) : Date.parse(`${latest.date}T23:59:59`);
  const changedSince = skill.commits.filter((c) => Date.parse(c.date) > end).length + (skill.uncommitted ? 1 : 0);
  let status;
  if (latest.result === 'fail') status = 'failed';
  else if (changedSince) status = 'stale';
  else status = latest.scope === 'partial' ? 'partial' : 'passed';
  return { status, review: latest, history: mine, changedSince };
}
