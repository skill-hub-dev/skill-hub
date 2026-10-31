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

/** 某路徑的 commit 清單（新到舊） */
export function logFor(dir, relPath, limit = 200) {
  const out = git(dir, ['log', `-n${limit}`, '--format=%H%x1f%aI%x1f%s', '--', relPath]);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((l) => {
    const [hash, date, subject] = l.split('\x1f');
    return { hash, date, subject };
  });
}

export const showFile = (dir, hash, relPath) => git(dir, ['show', `${hash}:${relPath}`]);

export const dirtyFiles = (dir, relPath) =>
  (git(dir, ['status', '--porcelain', '--', relPath]) || '').split('\n').filter(Boolean).length;

/** 上游 repo 的 HEAD（需要連網，只在 checks.remote = true 時呼叫） */
export function remoteHead(url) {
  const out = git(process.cwd(), ['ls-remote', url, 'HEAD']);
  return out ? out.split(/\s/)[0] : null;
}
