// git 指令包裝：只讀，不改動來源 repo
import { execFileSync } from 'node:child_process';

export function git(cwd, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

export const isRepo = (dir) => git(dir, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';

/**
 * 一次讀出 dir 底下的完整歷史與未 commit 檔案（只跑兩次 git，避免每個 skill 各跑一輪）。
 * 回傳路徑都相對於 dir。commits 由新到舊，files 為該 commit 改到的檔案與改後的 blob。
 */
export function repoHistory(dir) {
  const prefix = (git(dir, ['rev-parse', '--show-prefix']) || '').trim();
  const log = git(dir, ['log', '--format=%x1e%H%x1f%aI%x1f%s', '--raw', '--no-abbrev', '--no-renames', '--relative', '--', '.']) || '';
  const commits = log.split('\x1e').slice(1).map((block) => {
    const [head, ...rest] = block.split('\n');
    const [hash, date, subject] = head.split('\x1f');
    const files = [];
    for (const l of rest) {
      const m = l.match(/^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) (\w)\d*\t(.+)$/);
      if (m) files.push({ blob: m[1], status: m[2], path: m[3] });
    }
    return { hash, date, subject, files };
  });
  // porcelain 的路徑一律相對於 repo 根目錄，要去掉 dir 的前綴
  const dirty = (git(dir, ['status', '--porcelain', '--untracked-files=all', '--', '.']) || '')
    .split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
  return { commits, dirty };
}

/** 用一個 git cat-file --batch 讀出多個 blob 的文字內容 */
export function readBlobs(dir, shas) {
  const out = new Map();
  if (!shas.length) return out;
  let buf;
  try {
    buf = execFileSync('git', ['cat-file', '--batch'], { cwd: dir, input: shas.join('\n') + '\n', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  } catch {
    return out;
  }
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const [sha, type, size] = buf.subarray(pos, nl).toString('utf8').split(' ');
    pos = nl + 1;
    if (type === 'missing' || size === undefined) continue;
    const n = Number(size);
    out.set(sha, buf.subarray(pos, pos + n).toString('utf8'));
    pos += n + 1; // 內容後面還有一個換行
  }
  return out;
}

/** 上游 repo 的 HEAD（需要連網，只在 checks.remote = true 時呼叫） */
export function remoteHead(url) {
  const out = git(process.cwd(), ['ls-remote', url, 'HEAD']);
  return out ? out.split(/\s/)[0] : null;
}
