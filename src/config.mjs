// 讀設定檔；相對路徑以設定檔所在資料夾為基準，~ 展開成家目錄
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 檔案開頭的 BOM（Windows 記事本、PowerShell 存檔時常見）
const LEADING_BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

// 沒有在設定檔指定 categories 時，用關鍵字自動判斷分類
export const DEFAULT_CATEGORY_RULES = {
  '行銷': ['行銷', '文案', '社群', 'ig', '貼文', 'hook', '品牌', '廣告', '受眾', '客戶', '提案', 'marketing', 'copy', 'seo', 'campaign'],
  '開發': ['開發', '程式', '網站', '系統', 'api', '資料庫', '部署', '前端', '後端', 'code', 'dev', 'deploy', 'database'],
  '設計': ['設計', '視覺', '插圖', '原型', 'ui', 'ux', '版面', 'design', 'figma', 'illustration'],
  '影音': ['影片', '影像', '短影音', '動畫', '腳本', 'video', 'reels', 'shorts', 'tiktok', 'motion'],
  '研究分析': ['研究', '分析', '調查', '診斷', '論文', 'research', 'analysis'],
  '資安': ['資安', '安全', '漏洞', '稽核', '密鑰', 'security', 'audit', 'vulnerability'],
  '管理': ['管理', '任務', '流程', '部門', '專案管理', 'project management', 'workflow'],
};

const DEFAULTS = {
  sources: [],
  usage: {
    claudeCode: { enabled: true, dir: '~/.claude/projects' },
    codex: { enabled: true, dir: '~/.codex/sessions' },
    imports: [],
  },
  categories: {},
  categoryRules: DEFAULT_CATEGORY_RULES,
  projects: { roots: [], aliases: {} },
  securityReviews: 'data/security-reviews.json',
  checks: { unusedDays: 60, descriptionMax: 1024, bodyMaxLines: 500, remote: false },
  outDir: 'out',
};

/** 讀 JSON；Windows 記事本與 PowerShell 存檔時常在開頭加 BOM，先去掉 */
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(LEADING_BOM, ''));

export function expandPath(p, baseDir) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(baseDir, p);
}

export function loadConfig(configPath) {
  const file = path.resolve(configPath);
  if (!fs.existsSync(file)) {
    throw new Error(`找不到設定檔 ${file}\n先執行：skill-hub init（會偵測你電腦上的 skill 與紀錄位置，一步步建立設定檔）`);
  }
  let raw;
  try {
    raw = readJson(file);
  } catch (e) {
    throw new Error(`設定檔 ${file} 不是正確的 JSON：${e.message}\n（常見原因：少了逗號或引號、多了結尾逗號）`);
  }
  const base = path.dirname(file);
  const usage = { ...DEFAULTS.usage, ...raw.usage };
  const projects = { ...DEFAULTS.projects, ...raw.projects };

  const cfg = {
    file,
    sources: (raw.sources || []).map((s) => ({ name: s.name || path.basename(s.path), path: expandPath(s.path, base) })),
    usage: {
      claudeCode: { ...DEFAULTS.usage.claudeCode, ...usage.claudeCode },
      codex: { ...DEFAULTS.usage.codex, ...usage.codex },
      imports: (usage.imports || []).map((i) => ({ ...i, file: expandPath(i.file, base) })),
    },
    categories: raw.categories || DEFAULTS.categories,
    categoryRules: raw.categoryRules || DEFAULTS.categoryRules,
    projects: { roots: (projects.roots || []).map((r) => expandPath(r, base)), aliases: projects.aliases || {} },
    securityReviews: expandPath(raw.securityReviews || DEFAULTS.securityReviews, base),
    checks: { ...DEFAULTS.checks, ...raw.checks },
    outDir: expandPath(raw.outDir || DEFAULTS.outDir, base),
  };
  cfg.usage.claudeCode.dir = expandPath(cfg.usage.claudeCode.dir, base);
  cfg.usage.codex.dir = expandPath(cfg.usage.codex.dir, base);
  if (!cfg.sources.length) throw new Error('設定檔的 sources 是空的，至少要指定一個 skill 正本 repo（可執行 skill-hub init 重新設定）');
  return cfg;
}
