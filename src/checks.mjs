// 健檢規則：每條回傳 { level: 'error' | 'warn' | 'info', code, message }
import fs from 'node:fs';
import path from 'node:path';
import { remoteHead } from './git.mjs';

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const DAY = 86400000;

function secretFiles(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (fs.statSync(p).size > 2 * 1024 * 1024) continue;
      const buf = fs.readFileSync(p);
      if (buf.includes(0)) continue; // 二進位檔
      if (SECRET.test(buf.toString('utf8'))) hits.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return hits;
}

export function checkSkill(s, ctx) {
  const out = [];
  const add = (level, code, message) => out.push({ level, code, message });
  const c = ctx.checks;

  if (!s.hasFrontmatter) add('error', 'no-frontmatter', 'SKILL.md 開頭沒有 frontmatter（---）');
  if (!s.name) add('error', 'missing-name', '缺少 name');
  else if (s.name !== s.folder) add('error', 'name-mismatch', `name「${s.name}」與資料夾名稱「${s.folder}」不同`);
  if (!KEBAB.test(s.folder)) add('warn', 'not-kebab', '資料夾名稱不是 kebab-case');

  if (!s.description) add('error', 'missing-description', '缺少 description（模型靠它決定何時觸發）');
  else {
    const len = [...s.description].length;
    if (len > c.descriptionMax) add('warn', 'description-too-long', `description ${len} 字元，超過 ${c.descriptionMax}`);
    if (!s.triggers.length) add('warn', 'no-triggers', 'description 沒有列出觸發關鍵字（例如「關鍵字」）');
  }

  if (!s.version) add('error', 'missing-version', '缺少 metadata.version');
  else if (!SEMVER.test(String(s.version))) add('warn', 'bad-version', `版本號「${s.version}」不是 主.次.修 格式`);

  if (s.bodyLines > c.bodyMaxLines) add('warn', 'body-too-long', `本文 ${s.bodyLines} 行，超過 ${c.bodyMaxLines}（細節建議拆到 references/）`);

  const thirdParty = s.upstream || s.license || s.hasLicenseFile;
  if (thirdParty) {
    if (!s.upstream) add('warn', 'missing-source', '看起來是第三方 skill，但沒有 metadata.source');
    if (!s.upstreamCommit) add('warn', 'missing-source-commit', '第三方 skill 沒有 metadata.source_commit，無法比對上游更新');
    if (!s.license) add('warn', 'missing-license', '第三方 skill 沒有 license 欄位');
  }

  const secrets = secretFiles(s.absPath);
  if (secrets.length) add('error', 'secret', `疑似含有密鑰：${secrets.join('、')}`);

  // 版本紀錄
  if (s.versions.length && s.commits.length) {
    const vDate = Date.parse(s.versions[0].date);
    const after = s.commits.filter((x) => Date.parse(x.date) > vDate).length;
    if (after) add('warn', 'no-bump', `版本 ${s.versions[0].version} 之後還有 ${after} 個 commit 沒有升版號`);
  }
  if (s.uncommitted) add('info', 'uncommitted', `有 ${s.uncommitted} 個檔案尚未 commit`);
  const top = s.changelog.find((x) => x.version);
  if (top && s.version && top.version !== String(s.version)) add('info', 'changelog-stale', `changelog 最新一筆是 ${top.version}，但目前版本是 ${s.version}`);

  // 使用量
  if (ctx.usageAvailable) {
    const u = s.usage;
    if (!u || !u.total) add('info', 'never-used', '統計範圍內從未被使用');
    else if (ctx.now - Date.parse(u.lastUsed) > c.unusedDays * DAY) {
      add('warn', 'unused', `已 ${Math.floor((ctx.now - Date.parse(u.lastUsed)) / DAY)} 天沒被使用（門檻 ${c.unusedDays} 天）`);
    }
  }

  // 觸發詞重疊
  const shared = s.triggers.filter((t) => (ctx.triggerOwners.get(t.toLowerCase()) || []).length > 1);
  if (shared.length) {
    const detail = shared.slice(0, 6).map((t) => `「${t}」→ ${ctx.triggerOwners.get(t.toLowerCase()).filter((n) => n !== s.id).map((n) => n.split('/').pop()).join('、')}`);
    add('info', 'trigger-overlap', `觸發詞與其他 skill 重疊：${detail.join('；')}${shared.length > 6 ? ` 等 ${shared.length} 個` : ''}`);
  }

  if ((ctx.nameCount.get(s.name || s.folder) || 0) > 1) add('warn', 'duplicate-name', `多個來源都有名為「${s.name || s.folder}」的 skill`);

  if (c.remote && s.upstream && s.upstreamCommit && /^https?:\/\//.test(s.upstream)) {
    const head = remoteHead(s.upstream);
    if (!head) add('info', 'upstream-unreachable', '無法連到上游 repo 比對版本');
    else if (!head.startsWith(s.upstreamCommit) && !s.upstreamCommit.startsWith(head)) {
      add('warn', 'upstream-behind', `上游已有新版本（上游 HEAD ${head.slice(0, 7)}，本地對齊 ${String(s.upstreamCommit).slice(0, 7)}）`);
    }
  }
  return out;
}

export function runChecks(skills, { checks, usageAvailable, now = Date.now() }) {
  const triggerOwners = new Map();
  const nameCount = new Map();
  for (const s of skills) {
    for (const t of s.triggers) {
      const k = t.toLowerCase();
      if (!triggerOwners.has(k)) triggerOwners.set(k, []);
      if (!triggerOwners.get(k).includes(s.id)) triggerOwners.get(k).push(s.id);
    }
    const n = s.name || s.folder;
    nameCount.set(n, (nameCount.get(n) || 0) + 1);
  }
  const ctx = { checks, usageAvailable, now, triggerOwners, nameCount };
  for (const s of skills) {
    s.issues = checkSkill(s, ctx);
    s.health = s.issues.some((i) => i.level === 'error') ? 'error' : s.issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  }
  return skills;
}
