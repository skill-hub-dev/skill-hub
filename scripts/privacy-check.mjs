#!/usr/bin/env node
// 推送前的公開內容檢查，規則見 docs/publishing-rules.md
//   node scripts/privacy-check.mjs        檢查 HEAD＋暫存區的檔案與所有 commit
//   有任何問題就 exit 1
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 檔案開頭的 BOM（Windows 記事本、PowerShell 存檔時常見）
const LEADING_BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ch = (c) => String.fromCharCode(c);

// ---- 規則 ----
const ALLOWED_EMAIL = /^(noreply@anthropic\.com|[A-Za-z0-9._%+-]+@users\.noreply\.github\.com|[A-Za-z0-9._%+-]+@example\.(com|org))$/i;
// 公開 repo 裡可以出現的網域；其他網址要人工確認後加進來
const ALLOWED_HOSTS = ['github.com', 'agentskills.io', 'claude.com', '127.0.0.1', 'localhost', 'x', 'example.com', 'example.org'];
const ALLOWED_GITHUB_OWNERS = ['skill-hub-dev', 'example', '<owner>'];
// 測試與範例固定用 u 當使用者名稱
const USER_PATH = /(?:[A-Za-z]:[\\/]+Users|\/home|\/Users)[\\/]+(?!u[\\/"'`]|<)([^\\/\s"'`<>]+)/g;
const SECRET = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g;
const HIDDEN = new RegExp(`[${ch(0x200b)}-${ch(0x200f)}${ch(0x202a)}-${ch(0x202e)}${ch(0x2060)}-${ch(0x2064)}${ch(0xfeff)}]`, 'g');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/([^\s/)'"`<>]+)(\/[^\s)'"`<>]*)?/g;
// 這些路徑永遠不能被追蹤
const FORBIDDEN = [/^skill-hub\.config\.json$/, /^out\//, /^data\//, /^usage\/.+\.jsonl$/, /^\.privacy-keywords\.local$/, /^\.claude\//, /(^|\/)\.env(\.|$)/, /\.local$/];

// ---- 私人敏感詞（本機檔案，不進版控） ----
const kwFile = path.join(ROOT, '.privacy-keywords.local');
const keywords = fs.existsSync(kwFile)
  ? fs.readFileSync(kwFile, 'utf8').replace(LEADING_BOM, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : null;

const problems = [];
const warn = [];
const report = (where, kind, detail) => problems.push(`${kind.padEnd(10)} ${where}  ${detail}`);

function scanText(where, text, { commitMeta = false } = {}) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = commitMeta ? where : `${where}:${i + 1}`;
    for (const m of line.matchAll(SECRET)) report(at, '機密', m[0].slice(0, 12) + '…');
    for (const m of line.matchAll(USER_PATH)) report(at, '本機路徑', JSON.stringify(m[0]));
    for (const m of line.matchAll(HIDDEN)) report(at, '隱藏字元', `U+${m[0].charCodeAt(0).toString(16).toUpperCase()}`);
    for (const m of line.matchAll(EMAIL)) if (!ALLOWED_EMAIL.test(m[0])) report(at, '信箱', m[0]);
    for (const m of line.matchAll(URL_RE)) {
      const host = m[1].replace(/:.*$/, '').replace(/^www\./, '').toLowerCase();
      if (!ALLOWED_HOSTS.includes(host)) { report(at, '網址', m[0]); continue; }
      if (host === 'github.com') {
        const owner = (m[2] || '').split('/')[1];
        if (owner && !ALLOWED_GITHUB_OWNERS.includes(owner)) report(at, 'GitHub', `${m[0]}（不在允許的帳號清單）`);
      }
    }
    if (keywords) {
      const low = line.toLowerCase();
      for (const k of keywords) if (low.includes(k.toLowerCase())) report(at, '敏感詞', JSON.stringify(k));
    }
  });
}

// ---- 1. 歷史裡的每個檔案版本：刪掉的檔案在歷史裡還看得到，推送時一樣會公開 ----
const seenBlob = new Set();
const forbiddenSeen = new Set();
const checkPath = (file, where) => {
  if (FORBIDDEN.some((re) => re.test(file)) && !forbiddenSeen.has(file)) {
    forbiddenSeen.add(file);
    report(where, '禁止公開', '這個檔案只能留在本機（見規範第 2 節）');
  }
};
const objects = git(['rev-list', '--all', '--objects']).split('\n').filter((l) => l.includes(' '));
const types = objects.length
  ? execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { cwd: ROOT, input: objects.map((l) => l.split(' ')[0]).join('\n'), encoding: 'utf8' })
  : '';
const blobs = new Set(types.split('\n').filter((l) => l.endsWith(' blob')).map((l) => l.split(' ')[0]));
let versions = 0;
for (const line of objects) {
  const i = line.indexOf(' ');
  const [sha, file] = [line.slice(0, i), line.slice(i + 1)];
  if (!blobs.has(sha)) continue;
  checkPath(file, `${file}（歷史）`);
  if (seenBlob.has(sha)) continue;
  seenBlob.add(sha);
  versions++;
  const text = git(['cat-file', '-p', sha]);
  if (!text.includes('\0')) scanText(`${file}@${sha.slice(0, 7)}`, text);
}

// ---- 2. 工作區裡準備加入的檔案（已追蹤＋未忽略的新檔案），讀磁碟上的內容 ----
const candidates = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
for (const file of candidates) {
  checkPath(file, file);
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) continue;
  // 內容跟歷史某個版本一樣就不重掃
  const sha = execFileSync('git', ['hash-object', '--stdin'], { cwd: ROOT, input: buf, encoding: 'utf8' }).trim();
  if (seenBlob.has(sha)) continue;
  seenBlob.add(sha);
  scanText(file, buf.toString('utf8'));
}

// ---- 2. 所有 commit 的作者、提交者、訊息 ----
const SEP = '\x1e';
const log = git(['log', '--all', `--format=%h${SEP}%an${SEP}%ae${SEP}%cn${SEP}%ce${SEP}%B%x00`]);
let commits = 0;
for (const entry of log.split('\0')) {
  const e = entry.replace(/^\n/, '');
  if (!e.trim()) continue;
  const [hash, an, ae, cn, ce, body] = e.split(SEP);
  commits++;
  if (!ALLOWED_EMAIL.test(ae)) report(`commit ${hash}`, '作者信箱', `${an} <${ae}>`);
  if (!ALLOWED_EMAIL.test(ce)) report(`commit ${hash}`, '提交者信箱', `${cn} <${ce}>`);
  scanText(`commit ${hash} 訊息`, `${an}\n${cn}\n${body || ''}`, { commitMeta: true });
}

// ---- 3. 本機設定 ----
const localEmail = (() => { try { return git(['config', 'user.email']).trim(); } catch { return ''; } })();
if (localEmail && !ALLOWED_EMAIL.test(localEmail)) report('git config user.email', '身分', `${localEmail}（下一個 commit 會用這個信箱）`);
if (!keywords) warn.push('找不到 .privacy-keywords.local，只做了通用檢查。請建立它並寫入你的帳號、公司、客戶、專案名稱（見規範 5.2）。');

// ---- 結果 ----
console.log(`公開內容檢查：工作區 ${candidates.length} 個檔案、歷史 ${versions} 個檔案版本、${commits} 個 commit${keywords ? `、${keywords.length} 個私人敏感詞` : ''}`);
for (const w of warn) console.log(`⚠️  ${w}`);
if (problems.length) {
  console.log(`\n❌ 發現 ${problems.length} 個問題，不能推送：`);
  for (const p of problems) console.log(`  ${p}`);
  console.log('\n處理方式見 docs/publishing-rules.md。');
  process.exit(1);
}
console.log('✅ 通過');
