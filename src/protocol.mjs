// 儀表板「更新資料」按鈕：在 Windows 註冊 skillhub:// 網址，點了就執行 scripts/update-dashboard.cmd
// 只寫目前使用者的設定（HKCU），不需要系統管理員權限。
// 執行的指令固定，不帶網址內容（不用 %1），所以別的網頁就算連到 skillhub://，也只能觸發一次 build。
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const PROTOCOL = 'skillhub';
export const KEY = `HKCU\\Software\\Classes\\${PROTOCOL}`;

/** 點按鈕時執行的指令 */
export function handlerCommand(cmdFile, systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  const file = path.win32.resolve(cmdFile);
  // 路徑裡有 " 或 % 會被 cmd 誤解，直接拒絕
  if (/["%]/.test(file)) throw new Error(`skill-hub 的路徑含有 " 或 %，無法註冊：${file}`);
  return `"${path.win32.join(systemRoot, 'System32', 'cmd.exe')}" /c ""${file}" /web"`;
}

/** 註冊需要的 reg.exe 參數（每一項是一次 reg 呼叫） */
export function installSteps(cmdFile, systemRoot) {
  return [
    ['add', KEY, '/ve', '/d', 'URL:Skill Hub', '/f'],
    ['add', KEY, '/v', 'URL Protocol', '/d', '', '/f'],
    ['add', `${KEY}\\shell\\open\\command`, '/ve', '/d', handlerCommand(cmdFile, systemRoot), '/f'],
  ];
}

const reg = (args) => execFileSync('reg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

function requireWindows() {
  if (process.platform !== 'win32') throw new Error('網頁上的更新按鈕目前只支援 Windows；macOS／Linux 請執行 scripts/update-dashboard.sh');
}

export function installProtocol(cmdFile) {
  requireWindows();
  for (const args of installSteps(cmdFile)) reg(args);
}

export function removeProtocol() {
  requireWindows();
  try { reg(['delete', KEY, '/f']); return true; } catch { return false; }
}

/** 目前註冊的指令；沒註冊回傳 null */
export function protocolStatus() {
  requireWindows();
  try {
    const out = reg(['query', `${KEY}\\shell\\open\\command`, '/ve']);
    return out.match(/REG_SZ\s+(.+)/)?.[1].trim() || null;
  } catch { return null; }
}
