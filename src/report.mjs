// 組出完整報告：掃描來源 → 收集使用量 → 健檢
import { runChecks } from './checks.mjs';
import { scanSource } from './sources.mjs';
import { collectUsage, summarizeUsage } from './usage.mjs';

export function buildReport(cfg, { now = Date.now() } = {}) {
  const skills = cfg.sources.flatMap((src) => scanSource(src));
  const { events, notes } = collectUsage(cfg.usage);
  const usage = summarizeUsage(events, now);

  const known = new Set();
  for (const s of skills) {
    const key = s.name || s.folder;
    known.add(key);
    s.usage = usage.get(key) || null;
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
    skills,
    unmanaged,
  };
}
