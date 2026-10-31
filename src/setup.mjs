// 首次設定：偵測這台電腦上的 skill 資料夾與各平台紀錄，產生建議設定
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, isRepo } from './git.mjs';

const home = os.homedir();

const countSkills = (dir) => {
  const look = (base) => {
    try {
      return fs.readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !/^[._]/.test(d.name) && fs.existsSync(path.join(base, d.name, 'SKILL.md'))).length;
    } catch { return 0; }
  };
  return look(dir) || look(path.join(dir, 'skills'));
};

const realpath = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };

/** 可能放 skill 的地方：各平台預設位置，加上常見的程式碼資料夾底下一層 */
function candidateDirs() {
  const fixed = [
    ['Claude Code 使用中的 skills', path.join(home, '.claude', 'skills')],
    ['Codex 使用中的 skills', path.join(home, '.codex', 'skills')],
    ['Agent Skills 共用位置', path.join(home, '.agents', 'skills')],
  ];
  const parents = ['dev', 'code', 'projects', 'src', 'repos', 'Documents'].map((d) => path.join(home, d));
  if (process.platform === 'win32') {
    for (const letter of 'CDEFG') {
      for (const d of ['dev', 'code', 'projects']) parents.push(`${letter}:\\${d}`);
    }
  }
  const scanned = [];
  for (const parent of [...new Set(parents)]) {
    let entries = [];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && /skill/i.test(e.name)) scanned.push(['在程式碼資料夾找到', path.join(parent, e.name)]);
  }
  return [...fixed, ...scanned];
}

export function detectSources() {
  const seen = new Map();
  for (const [hint, dir] of candidateDirs()) {
    const real = realpath(dir);
    if (!real) continue;
    const skills = countSkills(real);
    if (!skills) continue;
    const key = real.toLowerCase();
    const linked = real.toLowerCase() !== path.resolve(dir).toLowerCase();
    const prev = seen.get(key);
    if (prev) { prev.hints.push(linked ? `${hint}（連結到這裡）` : hint); continue; }
    const repo = isRepo(real);
    const remote = repo ? (git(real, ['remote', 'get-url', 'origin']) || '').trim() || null : null;
    seen.set(key, { path: real, skills, git: repo, remote, hints: [linked ? `${hint}（連結到這裡）` : hint] });
  }
  return [...seen.values()].sort((a, b) => Number(b.git) - Number(a.git) || b.skills - a.skills);
}

export function detectUsage() {
  const countFiles = (dir, ext) => {
    let n = 0;
    const walk = (d) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith(ext)) n++;
      }
    };
    walk(dir);
    return n;
  };
  const claude = path.join(home, '.claude', 'projects');
  const codex = path.join(home, '.codex', 'sessions');
  return {
    claudeCode: { dir: claude, found: fs.existsSync(claude), files: fs.existsSync(claude) ? countFiles(claude, '.jsonl') : 0 },
    codex: { dir: codex, found: fs.existsSync(codex), files: fs.existsSync(codex) ? countFiles(codex, '.jsonl') : 0 },
  };
}

/** 依偵測結果給建議（純文字，給 CLI 與儀表板顯示） */
export function suggestions(sources, usage) {
  const tips = [];
  const repos = sources.filter((s) => s.git);
  if (!sources.length) tips.push('沒有找到任何含 SKILL.md 的資料夾。請手動輸入你放 skill 的資料夾路徑。');
  if (sources.length && !repos.length) tips.push('找到的 skill 資料夾都不是 git repo，版本紀錄會是空的。建議在正本資料夾執行 git init，並放上 GitHub（private 即可）。');
  if (repos.length && sources.length > repos.length) tips.push('有些位置是平台使用中的複本（例如 Codex 的鏡像）。只選「正本」那一個就好，避免同一個 skill 重複出現。');
  if (!usage.claudeCode.found && !usage.codex.found) tips.push('沒有找到 Claude Code 或 Codex 的本機紀錄，近期使用會是空的；雲端平台可以用匯入檔（見 README）。');
  return tips;
}

export function buildConfig({ sources, usage, imports = [] }) {
  const tilde = (p) => (p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length).replace(/\\/g, '/')}` : p.replace(/\\/g, '/'));
  const names = new Set();
  return {
    sources: sources.map((s) => {
      let name = path.basename(s.path);
      while (names.has(name)) name += '-2';
      names.add(name);
      return { name, path: tilde(s.path) };
    }),
    usage: {
      claudeCode: { enabled: usage.claudeCode, dir: '~/.claude/projects' },
      codex: { enabled: usage.codex, dir: '~/.codex/sessions' },
      imports,
    },
    categories: {},
    projects: { roots: [], aliases: {} },
    securityReviews: 'data/security-reviews.json',
    checks: { unusedDays: 60 },
    outDir: 'out',
  };
}
