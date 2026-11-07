// 組出完整報告：掃描來源 → 收集使用量 → 分類、專案、資安 → 健檢
import { categoryOrder, createCategorizer } from './categories.mjs';
import { runChecks, thirdPartyOf } from './checks.mjs';
import { createProjectResolver } from './projects.mjs';
import { loadReviews, reviewStatus, scanSkillDir } from './security.mjs';
import { scanSource } from './sources.mjs';
import { loadTables } from './tables.mjs';
import { collectUsage, summarizeUsage } from './usage.mjs';

export function buildReport(cfg, { now = Date.now() } = {}) {
  const skills = cfg.sources.flatMap((src) => scanSource(src));
  const { events, notes } = collectUsage(cfg.usage, { cacheFile: cfg.cacheFile });
  const tables = loadTables(cfg.tables || []);
  notes.push(...tables.notes);

  const resolveProject = createProjectResolver(cfg.projects);
  for (const e of events) e.project = resolveProject(e.cwd) || e.project || null;
  const usage = summarizeUsage(events, now);

  const categorize = createCategorizer(cfg);
  const reviews = loadReviews(cfg.securityReviews);
  const known = new Set();
  for (const s of skills) {
    const key = s.name || s.folder;
    known.add(key);
    s.usage = usage.get(key) || null;
    const c = categorize(s);
    s.category = c.category;
    s.categorySource = c.source;
    s.thirdParty = thirdPartyOf(s);
    s.security = { ...reviewStatus(s, reviews), scan: scanSkillDir(s.absPath) };
  }
  runChecks(skills, { checks: cfg.checks, usageAvailable: events.length > 0, now });

  // 有被使用、但不在任何來源 repo 裡的 skill（平台內建或外掛裝的）
  const unmanaged = [...usage.entries()]
    .filter(([name]) => !known.has(name))
    .map(([name, u]) => ({ name, total: u.total, lastUsed: u.lastUsed, platforms: Object.keys(u.platforms) }))
    .sort((a, b) => b.total - a.total);

  const platforms = {};
  for (const e of events) {
    const p = (platforms[e.platform] ||= { events: 0, first: e.ts, last: e.ts });
    p.events++;
    if (e.ts < p.first) p.first = e.ts;
    if (e.ts > p.last) p.last = e.ts;
  }

  for (const s of skills) delete s.absPath;
  return {
    generatedAt: new Date(now).toISOString(),
    sources: cfg.sources.map((s) => ({ name: s.name, skills: skills.filter((k) => k.source === s.name).length })),
    platforms,
    notes,
    thresholds: cfg.checks,
    categories: categoryOrder(skills, cfg),
    setup: setupInfo(cfg, events, reviews),
    skills,
    projects: summarizeProjects(events, known),
    unmanaged,
    tables: tables.tables,
  };
}

/** 依專案彙整：用了哪些 skill、各幾次、最後使用 */
export function summarizeProjects(events, known) {
  const by = new Map();
  for (const e of events) {
    if (!e.project) continue;
    let p = by.get(e.project);
    if (!p) by.set(e.project, (p = { name: e.project, total: 0, lastUsed: null, platforms: {}, skills: {} }));
    p.total++;
    if (!p.lastUsed || e.ts > p.lastUsed) p.lastUsed = e.ts;
    p.platforms[e.platform] = (p.platforms[e.platform] || 0) + 1;
    const s = (p.skills[e.skill] ||= { name: e.skill, count: 0, lastUsed: null, managed: known.has(e.skill) });
    s.count++;
    if (!s.lastUsed || e.ts > s.lastUsed) s.lastUsed = e.ts;
  }
  return [...by.values()]
    .map((p) => ({ ...p, skills: Object.values(p.skills).sort((a, b) => b.count - a.count) }))
    // 「（暫存工作區）」這類不是真正專案的排最後
    .sort((a, b) => Number(a.name.startsWith('（')) - Number(b.name.startsWith('（')) || (b.lastUsed || '').localeCompare(a.lastUsed || ''));
}

/** 給儀表板「設定與說明」面板用：目前設定讀到了什麼、缺什麼 */
function setupInfo(cfg, events, reviews) {
  const count = (p) => events.filter((e) => e.platform === p).length;
  return {
    configFile: cfg.file,
    sources: cfg.sources.map((s) => ({ name: s.name, path: s.path })),
    usage: [
      { platform: 'claude-code', enabled: cfg.usage.claudeCode.enabled, path: cfg.usage.claudeCode.dir, events: count('claude-code') },
      { platform: 'codex', enabled: cfg.usage.codex.enabled, path: cfg.usage.codex.dir, events: count('codex') },
      ...cfg.usage.imports.map((i) => ({ platform: i.platform, enabled: true, path: i.file, events: count(i.platform), import: true })),
    ],
    categoriesMode: Object.keys(cfg.categories).length ? 'config' : 'auto',
    securityReviews: { path: cfg.securityReviews, records: reviews.length },
    outDir: cfg.outDir,
  };
}
