// 掃描 skill 正本 repo：每個含 SKILL.md 的資料夾就是一個 skill
import fs from 'node:fs';
import path from 'node:path';
import { parseSkillFile } from './frontmatter.mjs';
import { isRepo, readBlobs, repoHistory } from './git.mjs';

const SKIP_DIR = /^[._]|^(synced|node_modules)$/;

function skillDirs(root) {
  const list = (base) =>
    fs.existsSync(base)
      ? fs.readdirSync(base, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !SKIP_DIR.test(d.name) && fs.existsSync(path.join(base, d.name, 'SKILL.md')))
          .map((d) => path.join(base, d.name))
      : [];
  const top = list(root);
  // 常見的另一種排法：skills/<name>/SKILL.md
  return top.length ? top : list(path.join(root, 'skills'));
}

/** 「關鍵字」與 "keyword" 都當成觸發詞 */
export function extractTriggers(description = '') {
  const found = new Set();
  for (const m of description.matchAll(/「([^」]{1,40})」/g)) found.add(m[1].trim());
  for (const m of description.matchAll(/"([^"]{1,40})"/g)) found.add(m[1].trim());
  return [...found].filter(Boolean);
}

export function firstSentence(text = '') {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/^.*?[。！？](?=\s|[^」）)]|$)|^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).slice(0, 160);
}

/** "1.1.0: 新增 X | 1.0.0: 初版" → [{ version, note }] */
export function parseChangelog(s) {
  if (!s || typeof s !== 'string') return [];
  // 只在「| 版本號:」前切開，說明文字裡的 | 不受影響
  return s.split(/\s*\|\s*(?=v?\d+\.\d+\.\d+\s*[:：])/).map((part) => {
    const m = part.match(/^\s*v?(\d+\.\d+\.\d+)\s*[:：]\s*(.*)$/);
    return m ? { version: m[1], note: m[2].trim() } : { version: null, note: part.trim() };
  }).filter((c) => c.note);
}

/**
 * 來源資訊：作者取 metadata.author；第三方沒寫作者時，從 GitHub 網址取帳號名稱
 * 回傳 { kind: 'third' | 'own', author, url, name }
 */
export function sourceInfo({ upstream, author, license, hasLicenseFile }) {
  const third = !!(upstream || license || hasLicenseFile);
  const gh = typeof upstream === 'string' ? upstream.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i) : null;
  return {
    kind: third ? 'third' : 'own',
    author: author || (gh ? gh[1] : null),
    url: upstream || null,
    name: gh ? `${gh[1]}/${gh[2].replace(/\.git$/, '')}` : upstream || null,
  };
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

/** mdCommits：改到 SKILL.md 的 commit（新到舊，含改後的 blob） */
function versionHistory(mdCommits, blobText) {
  // 依時間由舊到新，記下每個版本號第一次出現的 commit
  const versions = [];
  const byHash = {};
  for (const c of [...mdCommits].reverse()) {
    const text = c.blob ? blobText.get(c.blob) : null;
    const fm = text ? parseSkillFile(text).data : null;
    const v = fm?.metadata?.version ?? fm?.version ?? null;
    byHash[c.hash] = v ? String(v) : null;
    if (v && versions.at(-1)?.version !== String(v)) versions.push({ version: String(v), date: c.date, hash: c.hash, subject: c.subject });
  }
  return { versions: versions.reverse(), byHash };
}

export function scanSource(source) {
  if (!fs.existsSync(source.path)) throw new Error(`來源「${source.name}」的路徑不存在：${source.path}`);
  const dirs = skillDirs(source.path);
  // 整個來源只讀一次歷史，再分給各 skill
  const history = isRepo(source.path) ? repoHistory(source.path) : null;
  const relOf = (dir) => path.relative(source.path, dir).split(path.sep).join('/');
  const mdCommitsOf = new Map();
  if (history) {
    for (const dir of dirs) {
      const relMd = `${relOf(dir)}/SKILL.md`;
      mdCommitsOf.set(relMd, history.commits
        .map((c) => ({ ...c, blob: c.files.find((f) => f.path === relMd && f.status !== 'D')?.blob }))
        .filter((c) => c.files.some((f) => f.path === relMd)));
    }
  }
  const blobText = history ? readBlobs(source.path, [...new Set([...mdCommitsOf.values()].flat().map((c) => c.blob).filter(Boolean))]) : new Map();

  return dirs.map((dir) => {
    const skillMd = path.join(dir, 'SKILL.md');
    const text = fs.readFileSync(skillMd, 'utf8');
    const { data, body } = parseSkillFile(text);
    const fm = data || {};
    const meta = (fm.metadata && typeof fm.metadata === 'object') ? fm.metadata : {};
    const rel = path.relative(source.path, dir).split(path.sep).join('/');
    const relMd = `${rel}/SKILL.md`;

    let commits = [];
    let versions = [];
    let uncommitted = 0;
    if (history) {
      const h = versionHistory(mdCommitsOf.get(relMd), blobText);
      versions = h.versions;
      commits = history.commits
        // f.path === rel：資料夾本身被當成一個項目改動（例如內嵌 git repo 轉成一般資料夾的那次 commit）
        .filter((c) => c.files.some((f) => f.path === rel || f.path.startsWith(`${rel}/`)))
        .map(({ hash, date, subject }) => ({ hash, date, subject, version: h.byHash[hash] ?? null }));
      uncommitted = history.dirty.filter((p) => p.startsWith(`${rel}/`)).length;
    }
    const stat = fs.statSync(skillMd);
    const description = typeof fm.description === 'string' ? fm.description : '';

    return {
      id: `${source.name}/${path.basename(dir)}`,
      source: source.name,
      folder: path.basename(dir),
      relPath: rel,
      hasFrontmatter: !!data,
      name: fm.name ?? null,
      description,
      summary: firstSentence(description),
      version: meta.version ?? fm.version ?? null,
      license: fm.license ?? null,
      layer: meta.layer ?? null,
      categoryMeta: meta.category ?? null,
      upstream: meta.source ?? null,
      upstreamCommit: meta.source_commit ?? null,
      origin: sourceInfo({
        upstream: meta.source ?? null,
        author: meta.author ?? fm.author ?? null,
        license: fm.license ?? null,
        hasLicenseFile: fs.existsSync(path.join(dir, 'LICENSE')),
      }),
      changelog: parseChangelog(meta.changelog),
      triggers: extractTriggers(description),
      command: `/${fm.name || path.basename(dir)}`,
      outline: [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 30),
      bodyLines: body.split('\n').length,
      fileCount: countFiles(dir),
      folders: ['references', 'scripts', 'assets'].filter((f) => fs.existsSync(path.join(dir, f))),
      hasLicenseFile: fs.existsSync(path.join(dir, 'LICENSE')),
      lastModified: commits[0]?.date ?? stat.mtime.toISOString(),
      uncommitted,
      commits: commits.slice(0, 50),
      versions,
      absPath: dir, // 健檢掃描檔案用，輸出前會移除
    };
  });
}
