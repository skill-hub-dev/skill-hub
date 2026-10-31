#!/usr/bin/env node
// skill-hub CLI
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { buildReport } from '../src/report.mjs';
import { renderDashboard } from '../src/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `skill-hub — 管理 Agent Skills 正本 repo

用法：
  skill-hub init                 從範例建立 skill-hub.config.json
  skill-hub build [--open]       產生 out/index.html 儀表板與 out/skills.json
  skill-hub check                在終端機列出健檢結果，有錯誤時 exit 1
  skill-hub serve [--port 4173]  用本機網址開啟已產生的儀表板（只聽 127.0.0.1）
  skill-hub usage [--days 30]    列出近期使用排行

選項：
  --config <檔案>   設定檔（預設 ./skill-hub.config.json）
  --remote          連網比對第三方 skill 的上游版本（git ls-remote）
  --json            check／usage 改輸出 JSON
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && ['config', 'days', 'port'].includes(key)) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

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
  init() {
    const target = path.resolve('skill-hub.config.json');
    if (fs.existsSync(target)) { console.log(`已存在：${target}，不覆蓋`); return; }
    fs.copyFileSync(path.join(ROOT, 'skill-hub.config.example.json'), target);
    console.log(`已建立 ${target}\n編輯 sources 指向你的 skill 正本 repo，再執行 skill-hub build`);
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
try { commands[cmd](args); } catch (e) { console.error(`錯誤：${e.message}`); process.exit(1); }
