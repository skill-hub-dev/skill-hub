// 從各平台的本機紀錄找出 skill 使用事件
// 事件格式：{ platform, skill, ts, session, project }
// 只取 skill 名稱、時間、專案資料夾名，不保留任何對話內容。
import fs from 'node:fs';
import path from 'node:path';

function* walkJsonl(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

function* lines(file, mustInclude) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    if (!line || (mustInclude && !mustInclude.some((s) => line.includes(s)))) continue;
    try { yield JSON.parse(line); } catch { /* 寫到一半的行 */ }
  }
}

/** "anthropic-skills:dev-standard" → "dev-standard" */
export const normalizeSkill = (s) => String(s).trim().replace(/^\//, '').split(':').pop();

/** cwd 可能是一般路徑或 file:///D:/x%20y 這種網址，統一成路徑；專案名稱由 projects.mjs 判斷 */
export const cwdPath = (cwd) => {
  if (!cwd) return null;
  const s = String(cwd).replace(/^file:\/\/\/?/, '');
  try { return decodeURIComponent(s); } catch { return s; }
};

// Claude Code 內建的斜線指令，不是 skill
const BUILTIN_COMMANDS = new Set(('add-dir agents bug clear compact config context cost doctor exit export fast help hooks ide init '
  + 'login logout mcp memory model output-style permissions plugin pr-comments release-notes resume review rewind status '
  + 'terminal-setup theme upgrade usage vim').split(' '));

// ---- Claude Code：~/.claude/projects/**/*.jsonl ----
export function claudeCodeEvents(dir) {
  const events = [];
  for (const file of walkJsonl(dir)) {
    for (const o of lines(file, ['"name":"Skill"', '<command-name>'])) {
      const base = { platform: 'claude-code', ts: o.timestamp, session: o.sessionId || path.basename(file, '.jsonl'), cwd: cwdPath(o.cwd) };
      const content = o.message?.content;
      if (o.type === 'assistant' && Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use' && c.name === 'Skill' && c.input?.skill) events.push({ ...base, skill: normalizeSkill(c.input.skill) });
        }
      } else if (o.type === 'user') {
        // 使用者直接打 /skill-name
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text || '').join('\n') : '';
        for (const m of text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) {
          const skill = normalizeSkill(m[1]);
          if (!BUILTIN_COMMANDS.has(skill)) events.push({ ...base, skill });
        }
      }
    }
  }
  // 打 /x 之後通常緊接著一次 Skill 呼叫，同一對話 2 分鐘內的同名事件只算一次
  return dedupe(events, 2 * 60 * 1000);
}

// ---- Codex：~/.codex/sessions/**/rollout-*.jsonl ----
// Codex 沒有 Skill 工具，是用指令讀 skills/<name>/SKILL.md，所以從工具呼叫的參數找路徑
const CODEX_CALL = new Set(['function_call', 'custom_tool_call', 'local_shell_call']);
const SKILL_PATH = /skills[\\/]+([a-z0-9][a-z0-9_-]*)[\\/]+SKILL\.md/gi;

export function codexEvents(dir) {
  const events = [];
  for (const file of walkJsonl(dir)) {
    let cwd = null;
    const session = path.basename(file, '.jsonl');
    for (const o of lines(file, ['session_meta', 'turn_context', 'SKILL.md'])) {
      if (o.type === 'session_meta' || o.type === 'turn_context') { cwd = o.payload?.cwd ?? cwd; continue; }
      if (o.type !== 'response_item' || !CODEX_CALL.has(o.payload?.type)) continue;
      const args = JSON.stringify(o.payload);
      for (const m of args.matchAll(SKILL_PATH)) {
        events.push({ platform: 'codex', skill: m[1], ts: o.timestamp, session, cwd: cwdPath(cwd) });
      }
    }
  }
  return dedupe(events, Infinity); // 同一個 session 讀幾次都算用了一次
}

// ---- 匯入檔（Grok Bot 或任何平台）：每行一筆 {"ts","skill","platform","session","project"|"cwd"} ----
export function importEvents({ file, platform }) {
  const events = [];
  if (!fs.existsSync(file)) return { events, missing: true };
  for (const o of lines(file)) {
    if (!o.skill || !o.ts || Number.isNaN(Date.parse(o.ts))) continue;
    events.push({ platform: o.platform || platform || 'import', skill: normalizeSkill(o.skill), ts: o.ts, session: o.session ?? null, project: o.project ?? null, cwd: cwdPath(o.cwd) });
  }
  return { events, missing: false };
}

function dedupe(events, windowMs) {
  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const last = new Map();
  return events.filter((e) => {
    if (!e.ts || Number.isNaN(Date.parse(e.ts))) return false;
    const key = `${e.session}\x1f${e.skill}`;
    const prev = last.get(key);
    const t = Date.parse(e.ts);
    if (prev !== undefined && t - prev <= windowMs) return false;
    last.set(key, t);
    return true;
  });
}

export function collectUsage(usageCfg) {
  const notes = [];
  let events = [];
  if (usageCfg.claudeCode?.enabled) {
    if (fs.existsSync(usageCfg.claudeCode.dir)) events = events.concat(claudeCodeEvents(usageCfg.claudeCode.dir));
    else notes.push(`Claude Code 紀錄資料夾不存在：${usageCfg.claudeCode.dir}`);
  }
  if (usageCfg.codex?.enabled) {
    if (fs.existsSync(usageCfg.codex.dir)) events = events.concat(codexEvents(usageCfg.codex.dir));
    else notes.push(`Codex 紀錄資料夾不存在：${usageCfg.codex.dir}`);
  }
  for (const imp of usageCfg.imports || []) {
    const r = importEvents(imp);
    if (r.missing) notes.push(`${imp.platform} 的匯入檔還沒有資料（${path.basename(imp.file)}）`);
    events = events.concat(r.events);
  }
  return { events, notes };
}

const DAY = 86400000;

/** 依 skill 彙整：總數、近 30／90 天、最後使用、各平台、每週次數（近 26 週）、常用專案 */
export function summarizeUsage(events, now = Date.now()) {
  const weeks = 26;
  const by = new Map();
  for (const e of events) {
    const t = Date.parse(e.ts);
    let s = by.get(e.skill);
    if (!s) by.set(e.skill, (s = { total: 0, last30: 0, last90: 0, lastUsed: null, platforms: {}, weekly: Array(weeks).fill(0), projects: {} }));
    s.total++;
    if (now - t <= 30 * DAY) s.last30++;
    if (now - t <= 90 * DAY) s.last90++;
    if (!s.lastUsed || t > Date.parse(s.lastUsed)) s.lastUsed = new Date(t).toISOString();
    const p = (s.platforms[e.platform] ||= { count: 0, last: null });
    p.count++;
    if (!p.last || t > Date.parse(p.last)) p.last = new Date(t).toISOString();
    const w = Math.floor((now - t) / (7 * DAY));
    if (w >= 0 && w < weeks) s.weekly[weeks - 1 - w]++;
    if (e.project) s.projects[e.project] = (s.projects[e.project] || 0) + 1;
  }
  for (const s of by.values()) {
    s.projects = Object.entries(s.projects).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
  }
  return by;
}
