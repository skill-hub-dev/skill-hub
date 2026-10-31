#!/usr/bin/env node
// 在這台電腦的 .git/hooks/pre-push 加上公開內容檢查（hook 不會被 commit，換電腦要重跑）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '# skill-hub privacy-check';
const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: ROOT, encoding: 'utf8' }).trim();
const hook = path.resolve(ROOT, hooksDir, 'pre-push');

const script = `#!/bin/sh
${MARK}
# 推送前檢查公開內容，規則見 docs/publishing-rules.md
node scripts/privacy-check.mjs || {
  echo ""
  echo "公開內容檢查沒過，已取消推送。修正後再推送；不要用 --no-verify 跳過。"
  exit 1
}
`;

if (fs.existsSync(hook) && !fs.readFileSync(hook, 'utf8').includes(MARK)) {
  console.log(`已經有其他的 pre-push hook：${hook}`);
  console.log('沒有覆蓋。請手動把下面這行加進那個檔案：');
  console.log('  node scripts/privacy-check.mjs || exit 1');
  process.exit(1);
}
fs.mkdirSync(path.dirname(hook), { recursive: true });
fs.writeFileSync(hook, script, { mode: 0o755 });
console.log(`已安裝推送前檢查：${hook}`);
console.log('之後每次 git push 都會先執行 npm run privacy，沒過就不會推送。');
