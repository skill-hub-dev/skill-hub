#!/usr/bin/env node
// skill-hub CLI
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { loadConfig } from '../src/config.mjs';
import { buildReport } from '../src/report.mjs';
import { renderDashboard } from '../src/render.mjs';
import { appendReview, loadReviews, reviewStatus } from '../src/security.mjs';
import { buildConfig, detectSources, detectUsage, suggestions } from '../src/setup.mjs';
import { scanSource } from '../src/sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `skill-hub — 管理 Agent Skills 正本 repo

用法：
  skill-hub init [--yes]         首次設定：偵測 skill 資料夾與平台紀錄，一步步建立設定檔
  skill-hub build [--open]       產生 out/index.html 儀表板與 out/skills.json
  skill-hub check                在終端機列出健檢結果，有錯誤時 exit 1
  skill-hub usage [--days 30]    列出近期使用排行
  skill-hub review               列出每個 skill 的資安審查狀態
  skill-hub review <skill> --result pass|fail [--scope full|partial] [--ref <commit>] [--note <說明>] [--date YYYY-MM-DD]
                                 記錄一次資安審查（照你的審查流程做完後再記）
  skill-hub serve [--port 4173]  用本機網址開啟已產生的儀表板（只聽 127.0.0.1）

選項：
  --config <檔案>   設定檔（預設 ./skill-hub.config.json）
  --remote          連網比對第三方 skill 的上游版本（git ls-remote）
  --json            check／usage 改輸出 JSON
`;

const VALUE_KEYS = ['config', 'days', 'port', 'result', 'scope', 'ref', 'note', 'date'];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && VALUE_KEYS.includes(key)) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

async function ask(rl, question, fallback) {
  if (!rl) return fallback;
  const answer = (await rl.question(question)).trim();
  return answer || fallback;
}
const yes = (s) => /^(y|yes|是|好|對)$/i.test(String(s).trim());

const DAY = 86400000;
const ICON = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };

function load(args) {
  const cfg = loadConfig(args.config || 'skill-hub.config.json');
  if (args.remote) cfg.checks.remote = true;
  return cfg;
}

function openFile(file) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  execFile(cmd[0], cmd[1], () => {});
}

const commands = {
  async init(args) {
    const target = path.resolve(args.config || 'skill-hub.config.json');
    // 非互動環境（CI、管線）或加了 --yes：直接採用偵測結果
    const rl = process.stdin.isTTY && !args.yes ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
    try {
      console.log('Skill Hub 首次設定\n只會讀取下面列出的資料夾，不會修改它們，也不會連網。\n');
      if (fs.existsSync(target) && !yes(await ask(rl, `已經有設定檔 ${target}，要重新設定並覆蓋嗎？(y/N) `, 'n'))) {
        console.log('保留原本的設定檔。');
        return;
      }

      console.log('① 尋找 skill 資料夾（含 SKILL.md 的資料夾）…');
      const found = detectSources();
      found.forEach((s, i) => {
        console.log(`  [${i + 1}] ${s.path}`);
        console.log(`      ${s.skills} 個 skill・${s.git ? `git repo${s.remote ? `（${s.remote}）` : ''}` : '不是 git repo，沒有版本紀錄'}・${s.hints.join('、')}`);
      });
      const usage = detectUsage();
      for (const tip of suggestions(found, usage)) console.log(`  💡 ${tip}`);

      // 預設選第一個 git repo（通常就是正本）；沒有 git repo 就選第一個
      const defaultPick = found.length ? String(found.findIndex((s) => s.git) + 1 || 1) : '';
      let picked = [];
      const pick = await ask(rl, `\n要管理哪些？輸入編號（可多個，用逗號分隔）${defaultPick ? `，直接 Enter 選 [${defaultPick}]` : ''}：`, defaultPick);
      picked = pick.split(/[,，\s]+/).map((n) => found[Number(n) - 1]).filter(Boolean);
      for (;;) {
        const extra = await ask(rl, '要再加其他資料夾嗎？輸入路徑，或直接 Enter 跳過：', '');
        if (!extra) break;
        const p = path.resolve(extra.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'));
        if (!fs.existsSync(p)) { console.log(`  找不到 ${p}`); continue; }
        picked.push({ path: p, skills: 0 });
        console.log(`  已加入 ${p}`);
      }
      if (!picked.length) {
        console.log('\n沒有選任何 skill 資料夾，先不建立設定檔。準備好後再執行 skill-hub init。');
        return;
      }

      console.log('\n② 使用紀錄');
      const claude = usage.claudeCode.found && yes(await ask(rl, `  Claude Code：找到 ${usage.claudeCode.files} 份對話紀錄，要統計嗎？(Y/n) `, 'y'));
      if (!usage.claudeCode.found) console.log('  Claude Code：沒有找到紀錄，先不統計');
      const codex = usage.codex.found && yes(await ask(rl, `  Codex：找到 ${usage.codex.files} 份 session 紀錄，要統計嗎？(Y/n) `, 'y'));
      if (!usage.codex.found) console.log('  Codex：沒有找到紀錄，先不統計');
      if (!rl) {
        if (usage.claudeCode.found) console.log(`  Claude Code：${claude ? '統計' : '不統計'}（${usage.claudeCode.files} 份對話紀錄）`);
        if (usage.codex.found) console.log(`  Codex：${codex ? '統計' : '不統計'}（${usage.codex.files} 份 session 紀錄）`);
      }
      const imports = [];
      const other = await ask(rl, '  其他平台（例如 Grok Bot）要用匯入檔記錄嗎？輸入平台名稱，或直接 Enter 跳過：', '');
      if (other) imports.push({ platform: other.toLowerCase().replace(/\s+/g, '-'), file: `usage/${other.toLowerCase().replace(/\s+/g, '-')}.jsonl` });

      const config = buildConfig({ sources: picked, usage: { claudeCode: claude, codex }, imports });
      fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
      console.log(`\n③ 已建立 ${target}`);
      console.log(path.dirname(target) === ROOT
        ? '   這個檔案只在你的電腦上（已列在 .gitignore），不會被 commit。'
        : '   這個檔案只在你的電腦上；如果放在 git repo 裡，記得把它加進 .gitignore。');
      console.log('\n接下來：');
      console.log('  skill-hub build --open     產生儀表板並打開');
      console.log('  skill-hub check            列出需要處理的 skill');
      console.log('想調整分類、專案名稱或門檻，可以編輯設定檔，說明在 README 的「設定檔」一節。');
      if (imports.length) console.log(`其他平台的紀錄格式見 README「使用量怎麼算」，寫進 ${imports[0].file} 即可。`);
    } finally {
      rl?.close();
    }
  },

  review(args) {
    const cfg = load(args);
    const name = args._[1];
    if (!name) {
      // 只列狀態，不需要完整報告
      const reviews = loadReviews(cfg.securityReviews);
      const LABEL = { passed: '✅ 已檢查', partial: '🟦 部分檢查', stale: '⚠️  審查後有修改', failed: '❌ 未通過', none: '・ 未檢查' };
      for (const s of cfg.sources.flatMap((src) => scanSource(src))) {
        const r = reviewStatus(s, reviews);
        const tp = s.origin.kind === 'third' ? `第三方・${s.origin.author || '作者未知'}` : '自建';
        console.log(`  ${LABEL[r.status].padEnd(10)} ${(s.name || s.folder).padEnd(34)} ${tp}${r.review ? `  ${r.review.date}${r.changedSince ? `，之後改了 ${r.changedSince} 次` : ''}` : ''}`);
      }
      console.log(`\n審查紀錄：${cfg.securityReviews}（${reviews.length} 筆）`);
      return;
    }
    if (!['pass', 'fail'].includes(args.result)) throw new Error('請用 --result pass 或 --result fail 指定審查結果');
    const skills = cfg.sources.flatMap((src) => scanSource(src));
    const s = skills.find((x) => (x.name || x.folder) === name);
    if (!s) throw new Error(`找不到 skill「${name}」`);
    // 預設用本機日期（toISOString 是 UTC，台灣早上會記成前一天）
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const date = args.date || today;
    if (Number.isNaN(Date.parse(date))) throw new Error(`日期格式不對：${date}（請用 YYYY-MM-DD）`);
    // 補登過去的審查時，記下當天結束前最後一個 commit 的版本
    const end = Date.parse(`${date}T23:59:59`);
    const at = args.date ? s.commits.find((c) => Date.parse(c.date) <= end) : s.commits[0];
    const record = {
      skill: name,
      date,
      result: args.result,
      scope: args.scope === 'partial' ? 'partial' : 'full',
      version: (args.date ? at?.version : s.version) || s.version || null,
      commit: at?.hash?.slice(0, 7) || null,
      ref: args.ref || null,
      // 審查對象的來源、作者、連結：之後換來源或作者時看得出審的是哪一份
      source: s.origin.url,
      author: s.origin.author,
      note: args.note || null,
    };
    appendReview(cfg.securityReviews, record);
    console.log(`已記錄：${name} ${record.date} ${record.result === 'pass' ? '通過' : '未通過'}（${record.scope === 'full' ? '完整審查' : '部分審查'}，版本 ${record.version || '?'}）`);
  },

  build(args) {
    const cfg = load(args);
    const report = buildReport(cfg);
    fs.mkdirSync(cfg.outDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.outDir, 'skills.json'), JSON.stringify(report, null, 2));
    const html = path.join(cfg.outDir, 'index.html');
    fs.writeFileSync(html, renderDashboard(report));
    const n = report.skills.length;
    const err = report.skills.filter((s) => s.health === 'error').length;
    const warn = report.skills.filter((s) => s.health === 'warn').length;
    const ev = Object.values(report.platforms).reduce((a, p) => a + p.events, 0);
    console.log(`共 ${n} 個 skill（錯誤 ${err}、警告 ${warn}），使用事件 ${ev} 筆`);
    for (const note of report.notes) console.log(`  ${ICON.info}${note}`);
    console.log(`儀表板：${html}`);
    if (args.open) openFile(html);
  },

  check(args) {
    const report = buildReport(load(args));
    if (args.json) { console.log(JSON.stringify(report.skills.map(({ id, version, health, issues }) => ({ id, version, health, issues })), null, 2)); }
    else {
      for (const s of report.skills) {
        if (!s.issues.length) continue;
        console.log(`▸ ${s.id} ${s.version ? `(${s.version})` : ''}`);
        for (const i of s.issues) console.log(`  ${ICON[i.level]} ${i.message}`);
      }
      const count = (lv) => report.skills.reduce((a, s) => a + s.issues.filter((i) => i.level === lv).length, 0);
      console.log(`\n共 ${report.skills.length} 個 skill，錯誤 ${count('error')}、警告 ${count('warn')}、提示 ${count('info')}`);
    }
    if (report.skills.some((s) => s.health === 'error')) process.exitCode = 1;
  },

  serve(args) {
    // 只聽 127.0.0.1，提供 outDir 裡已產生的檔案
    const cfg = load(args);
    const port = Number(args.port) || 4173;
    const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(cfg.outDir, rel.endsWith('/') ? `${rel}index.html` : rel);
      if (!file.startsWith(path.resolve(cfg.outDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(port, '127.0.0.1', () => console.log(`儀表板：http://127.0.0.1:${port}/（Ctrl+C 結束）`));
  },

  usage(args) {
    const report = buildReport(load(args));
    const days = Number(args.days) || 30;
    const since = Date.now() - days * DAY;
    const rows = report.skills
      .map((s) => ({ id: s.id, total: s.usage?.total || 0, lastUsed: s.usage?.lastUsed || null, platforms: s.usage?.platforms || {} }))
      .map((r) => ({ ...r, recent: !!r.lastUsed && Date.parse(r.lastUsed) >= since }))
      .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
    if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
    console.log(`近 ${days} 天有使用：`);
    for (const r of rows.filter((x) => x.recent)) {
      const p = Object.entries(r.platforms).map(([k, v]) => `${k} ${v.count}`).join('、');
      console.log(`  ${r.id.padEnd(40)} 最後 ${r.lastUsed.slice(0, 10)}  累計 ${r.total}（${p}）`);
    }
    const idle = rows.filter((x) => !x.recent);
    console.log(`\n近 ${days} 天沒用到（${idle.length}）：${idle.map((x) => x.id.split('/').pop()).join('、') || '無'}`);
  },
};

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || args.help || !commands[cmd]) { console.log(HELP); process.exit(cmd && !commands[cmd] ? 1 : 0); }
try { await commands[cmd](args); } catch (e) { console.error(`錯誤：${e.message}`); process.exit(1); }
