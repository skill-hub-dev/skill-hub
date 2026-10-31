// 把使用事件的工作資料夾（cwd）對應到「專案」名稱
// 判斷順序：設定檔 projectRoots → 往上找含 .git 的資料夾 → 資料夾名稱
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH = /[\\/](scratch-workspaces|AppData[\\/]Local[\\/]Temp)[\\/]/i;
// Claude Code 的 worktree 放在 <專案>/.claude/worktrees/<隨機名>，歸回 <專案>
const CLAUDE_WORKTREE = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]/i;
// Codex 的 worktree 放在 ~/.codex/worktrees/<id>/<repo>
const CODEX_WORKTREE = /[\\/]\.codex[\\/]worktrees[\\/][^\\/]+[\\/]([^\\/]+)/i;

export function createProjectResolver({ roots = [], aliases = {} } = {}) {
  const cache = new Map();
  const home = path.resolve(os.homedir()).toLowerCase();
  const normRoots = roots.map((r) => path.resolve(r));

  function resolve(cwd) {
    if (!cwd) return null;
    const p = path.resolve(cwd);
    if (cache.has(p)) return cache.get(p);
    let name;
    const claudeWt = p.match(CLAUDE_WORKTREE);
    const codexWt = p.match(CODEX_WORKTREE);
    if (claudeWt) return remember(p, resolve(claudeWt[1]));
    if (codexWt) name = codexWt[1];
    else if (SCRATCH.test(p)) name = '（暫存工作區）';
    else if (p.toLowerCase() === home) name = '（家目錄）';
    else {
      const root = normRoots.find((r) => p.toLowerCase().startsWith((r + path.sep).toLowerCase()));
      if (root) name = path.relative(root, p).split(path.sep)[0];
      else name = path.basename(gitRoot(p) || p) || p;
    }
    return remember(p, aliases[name] || name);
  }
  const remember = (p, name) => { cache.set(p, name); return name; };
  return resolve;
}

/** 從 dir 往上找第一個含 .git 的資料夾；資料夾已不存在時，從還存在的上層開始找 */
function gitRoot(dir) {
  let d = dir;
  while (!fs.existsSync(d)) {
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
