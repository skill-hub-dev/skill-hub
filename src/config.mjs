// 讀設定檔；相對路徑以設定檔所在資料夾為基準，~ 展開成家目錄
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULTS = {
  sources: [],
  usage: {
    claudeCode: { enabled: true, dir: '~/.claude/projects' },
    codex: { enabled: true, dir: '~/.codex/sessions' },
    imports: [],
  },
  checks: { unusedDays: 60, descriptionMax: 1024, bodyMaxLines: 500, remote: false },
  outDir: 'out',
};

export function expandPath(p, baseDir) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(baseDir, p);
}

export function loadConfig(configPath) {
  const file = path.resolve(configPath);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到設定檔 ${file}\n先執行：skill-hub init（會從 skill-hub.config.example.json 複製一份）`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = path.dirname(file);
  const usage = { ...DEFAULTS.usage, ...raw.usage };

  const cfg = {
    file,
    sources: (raw.sources || []).map((s) => ({ name: s.name || path.basename(s.path), path: expandPath(s.path, base) })),
    usage: {
      claudeCode: { ...DEFAULTS.usage.claudeCode, ...usage.claudeCode },
      codex: { ...DEFAULTS.usage.codex, ...usage.codex },
      imports: (usage.imports || []).map((i) => ({ ...i, file: expandPath(i.file, base) })),
    },
    checks: { ...DEFAULTS.checks, ...raw.checks },
    outDir: expandPath(raw.outDir || DEFAULTS.outDir, base),
  };
  cfg.usage.claudeCode.dir = expandPath(cfg.usage.claudeCode.dir, base);
  cfg.usage.codex.dir = expandPath(cfg.usage.codex.dir, base);
  if (!cfg.sources.length) throw new Error('設定檔的 sources 是空的，至少要指定一個 skill 正本 repo');
  return cfg;
}
