import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCategorizer } from '../src/categories.mjs';
import { loadConfig } from '../src/config.mjs';
import { createProjectResolver } from '../src/projects.mjs';
import { reviewStatus, scanSkillDir } from '../src/security.mjs';
import { buildConfig } from '../src/setup.mjs';
import { parseSkillFile } from '../src/frontmatter.mjs';
import { renderDashboard } from '../src/render.mjs';
import { handlerCommand, installSteps, KEY } from '../src/protocol.mjs';
import { buildReport } from '../src/report.mjs';
import { extractTriggers, firstSentence, parseChangelog, scanSource, sourceInfo } from '../src/sources.mjs';
import { loadTables, tableProblem } from '../src/tables.mjs';
import { claudeCodeEvents, codexEvents, summarizeUsage } from '../src/usage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hub-test-'));

test('frontmatter：區塊字串、巢狀 metadata、引號', () => {
  const { data, body } = parseSkillFile(`---
name: demo
description: |
  第一行。
  第二行「關鍵字」
license: MIT
metadata:
  version: "1.2.3"
  layer: L0   # 註解
  changelog: '1.2.3: 修正 | 1.0.0: 初版'
---
# 標題
`);
  assert.equal(data.name, 'demo');
  assert.equal(data.description, '第一行。\n第二行「關鍵字」');
  assert.equal(data.license, 'MIT');
  assert.deepEqual(data.metadata, { version: '1.2.3', layer: 'L0', changelog: '1.2.3: 修正 | 1.0.0: 初版' });
  assert.equal(body, '# 標題\n');
});

test('frontmatter：純文字多行延續、> 摺疊、CRLF、沒有 frontmatter', () => {
  assert.equal(parseSkillFile('---\r\nname: a\r\ndescription: 一段\r\n  接續\r\n---\r\n').data.description, '一段 接續');
  assert.equal(parseSkillFile('---\nname: a\ndescription: >\n  one\n  two\n---\n').data.description, 'one two');
  assert.equal(parseSkillFile('# 沒有\n').data, null);
});

test('觸發詞、第一句、changelog', () => {
  assert.deepEqual(extractTriggers('提到「會議紀錄」「待辦」或 "meeting notes" 時'), ['會議紀錄', '待辦', 'meeting notes']);
  assert.equal(firstSentence('把逐字稿整理成清單。會議結束時啟動。'), '把逐字稿整理成清單。');
  assert.deepEqual(parseChangelog('1.1.0: 新增 X | 1.0.0：初版'), [{ version: '1.1.0', note: '新增 X' }, { version: '1.0.0', note: '初版' }]);
  assert.deepEqual(parseChangelog('1.3.1: A|B 欄位|1.3.0: 初版').map((c) => c.note), ['A|B 欄位', '初版']);
});

test('Claude Code 紀錄：Skill 呼叫與斜線指令，去重並略過內建指令', () => {
  const dir = tmp();
  const lines = [
    { type: 'user', timestamp: '2026-10-01T00:00:00Z', sessionId: 'a', cwd: 'C:\\work\\proj', message: { content: '<command-name>/demo</command-name>' } },
    { type: 'assistant', timestamp: '2026-10-01T00:00:30Z', sessionId: 'a', cwd: 'C:\\work\\proj', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'demo' } }] } },
    { type: 'assistant', timestamp: '2026-10-02T00:00:00Z', sessionId: 'b', cwd: '/x/other', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'plugin:demo' } }] } },
    { type: 'user', timestamp: '2026-10-02T00:01:00Z', sessionId: 'b', message: { content: '<command-name>/compact</command-name>' } },
  ];
  fs.mkdirSync(path.join(dir, 'p'));
  fs.writeFileSync(path.join(dir, 'p', 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n{broken');
  const ev = claudeCodeEvents(dir);
  assert.equal(ev.length, 2);
  assert.deepEqual(ev.map((e) => [e.skill, e.cwd]), [['demo', 'C:\\work\\proj'], ['demo', '/x/other']]);
});

test('Codex 紀錄：從工具呼叫參數找 SKILL.md 路徑，忽略 skill 清單訊息', () => {
  const dir = tmp();
  const lines = [
    { type: 'session_meta', timestamp: '2026-10-01T00:00:00Z', payload: { cwd: 'C:\\work\\proj' } },
    { type: 'response_item', timestamp: '2026-10-01T00:00:01Z', payload: { type: 'message', content: [{ text: 'C:\\Users\\u\\.codex\\skills\\listed\\SKILL.md' }] } },
    { type: 'response_item', timestamp: '2026-10-01T00:00:02Z', payload: { type: 'function_call', arguments: '{"cmd":"Get-Content C:\\\\Users\\\\u\\\\.codex\\\\skills\\\\demo\\\\SKILL.md"}' } },
    { type: 'response_item', timestamp: '2026-10-01T00:05:00Z', payload: { type: 'custom_tool_call', input: 'cat ~/.codex/skills/demo/SKILL.md' } },
  ];
  fs.writeFileSync(path.join(dir, 'rollout-1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  const ev = codexEvents(dir);
  assert.deepEqual(ev.map((e) => [e.skill, e.cwd]), [['demo', 'C:\\work\\proj']]);
});

test('使用量彙整：近 30 天、每週桶、平台', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const u = summarizeUsage([
    { platform: 'codex', skill: 'a', ts: '2026-10-28T00:00:00Z', project: 'p' },
    { platform: 'grok-bot', skill: 'a', ts: '2026-08-01T00:00:00Z' },
  ], now).get('a');
  assert.equal(u.total, 2);
  assert.equal(u.last30, 1);
  assert.equal(u.weekly.at(-1), 1);
  assert.deepEqual(Object.keys(u.platforms).sort(), ['codex', 'grok-bot']);
  assert.equal(u.lastUsed, '2026-10-28T00:00:00.000Z');
});

test('示範設定：完整報告與健檢', () => {
  const cfg = loadConfig(path.join(ROOT, 'examples/demo.config.json'));
  const r = buildReport(cfg, { now: Date.parse('2026-10-29T00:00:00Z') });
  const by = Object.fromEntries(r.skills.map((s) => [s.folder, s]));
  assert.equal(r.skills.length, 3);
  assert.equal(by['meeting-notes'].version, '1.2.1');
  assert.equal(by['meeting-notes'].usage.total, 4);
  // 來源是 repo 的子資料夾時也要讀得到版本歷史（git 狀態會變，只檢查讀得到、沒有錯誤）
  assert.ok(by['meeting-notes'].versions.length >= 1);
  assert.ok(!by['meeting-notes'].issues.some((i) => i.level === 'error'));
  const codes = (n) => by[n].issues.map((i) => i.code);
  assert.ok(codes('tone-polisher').includes('missing-source-commit'));
  assert.ok(codes('tone-polisher').includes('unused'));
  assert.ok(codes('tone-polisher').includes('not-reviewed'));
  assert.deepEqual(r.unmanaged.map((u) => u.name), ['pdf']);
  assert.ok(!('absPath' in by['meeting-notes']));
  // 分類：SKILL.md 指定、關鍵字自動判斷、判斷不出來
  assert.deepEqual([by['meeting-notes'].category, by['meeting-notes'].categorySource], ['管理', 'skill']);
  assert.deepEqual([by['release-checklist'].category, by['release-checklist'].categorySource], ['開發', 'auto']);
  assert.equal(by['tone-polisher'].category, '未分類');
  assert.equal(r.categories.at(-1), '未分類');
  // 專案：匯入檔裡的 project 欄位
  assert.deepEqual(r.projects.map((p) => p.name).sort(), ['demo-app', 'handbook']);
  assert.equal(r.projects.find((p) => p.name === 'demo-app').skills.find((s) => s.name === 'pdf').managed, false);
});

test('分類：設定檔優先於關鍵字；英文短詞要整字相符', () => {
  const cat = createCategorizer({ categories: { 行銷: ['a'] }, categoryRules: { 社群: ['ig'], 設計: ['design'] } });
  const skill = (o) => ({ name: 'x', folder: 'x', triggers: [], description: '', categoryMeta: null, ...o });
  assert.deepEqual(cat(skill({ name: 'a' })), { category: '行銷', source: 'config' });
  assert.deepEqual(cat(skill({ categoryMeta: '自訂', name: 'a' })), { category: '自訂', source: 'skill' });
  assert.equal(cat(skill({ description: 'UI design helper' })).category, '設計');
  assert.equal(cat(skill({ description: 'IG 貼文' })).category, '社群');
});

test('專案：worktree 歸回原專案、暫存區、指定根目錄', () => {
  const base = path.resolve(path.sep, 'skill-hub-test-nope');
  const resolve = createProjectResolver({ roots: [path.join(base, 'roots')] });
  assert.equal(resolve(path.join(base, 'shop', '.claude', 'worktrees', 'brave-cat-123')), 'shop');
  assert.equal(resolve('/home/u/.codex/worktrees/ab12/my-repo/src'), 'my-repo');
  assert.equal(resolve('C:\\Users\\u\\AppData\\Roaming\\Claude\\scratch-workspaces\\x\\y'), '（暫存工作區）');
  assert.equal(resolve(path.join(base, 'roots', 'site', 'src', 'app')), 'site');
});

test('資安狀態：已檢查、部分、審查後有修改、未通過、未檢查', () => {
  const skill = { name: 's', folder: 's', commits: [{ date: '2026-10-20T10:00:00Z' }], uncommitted: 0 };
  const st = (reviews, s = skill) => reviewStatus(s, reviews).status;
  assert.equal(st([]), 'none');
  assert.equal(st([{ skill: 's', date: '2026-10-20', result: 'pass' }]), 'passed'); // 同一天的修改算在審查內
  assert.equal(st([{ skill: 's', date: '2026-10-21', result: 'pass', scope: 'partial' }]), 'partial');
  assert.equal(st([{ skill: 's', date: '2026-10-19', result: 'pass' }]), 'stale');
  assert.equal(st([{ skill: 's', date: '2026-10-19', result: 'pass' }, { skill: 's', date: '2026-10-22', result: 'fail' }]), 'failed');
  assert.equal(st([{ skill: 's', date: '2026-10-21', result: 'pass' }], { ...skill, uncommitted: 2 }), 'stale');
});

test('設定檔：開頭有 BOM 也讀得到；JSON 壞掉時給看得懂的錯誤', () => {
  const dir = tmp();
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify({ sources: [{ path: dir }] }));
  assert.equal(loadConfig(file).sources[0].path, dir);
  fs.writeFileSync(file, '{ "sources": [ }');
  assert.throws(() => loadConfig(file), /不是正確的 JSON/);
});

test('自動掃描：隱藏字元、腳本的連網與執行', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# x${String.fromCharCode(0x200b)}`);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'a.mjs'), "import { exec } from 'node:child_process'; exec('ls'); fetch('https://x');");
  const r = scanSkillDir(dir);
  assert.deepEqual(r.hidden, ['SKILL.md']);
  assert.deepEqual(r.scripts, [{ file: 'scripts/a.mjs', risks: ['連網', '執行其他程式'] }]);
});

test('公開內容檢查：抓到路徑、信箱、敏感詞、禁止檔案、commit 身分，也抓得到已刪除的歷史', () => {
  const repo = tmp();
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const check = () => { try { return { code: 0, out: run(process.execPath, ['scripts/privacy-check.mjs']) } } catch (e) { return { code: e.status, out: e.stdout } } };
  const commit = (email, msg) => run('git', ['-c', 'user.name=t', '-c', `user.email=${email}`, 'commit', '-qm', msg]);
  // 故意要被抓到的假資料在執行時才組出來，不然這個測試檔本身也會被公開檢查擋下
  const badEmail = ['alice', 'company.test'].join('@');
  const badPath = ['C:', 'Users', 'alice', 'proj'].join('\\');
  run('git', ['init', '-q']);
  run('git', ['config', 'user.email', 'bot@users.noreply.github.com']);
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'privacy-check.mjs'), path.join(repo, 'scripts', 'privacy-check.mjs'));
  fs.writeFileSync(path.join(repo, '.privacy-keywords.local'), '# 測試\nacme-corp\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.local\n');
  fs.writeFileSync(path.join(repo, 'ok.md'), '範例路徑 C:\\Users\\u\\dev、https://github.com/example/x、git@github.com:example/x.git、https://git@github.com/example/x\n');
  run('git', ['add', '-A']);
  commit('bot@users.noreply.github.com', 'init');
  assert.equal(check().code, 0);

  // 已經刪掉的檔案：歷史裡還在，要擋
  fs.writeFileSync(path.join(repo, 'leak.md'), '客戶 ACME-Corp');
  run('git', ['add', '-A']);
  commit(badEmail, 'add');
  fs.rmSync(path.join(repo, 'leak.md'));
  run('git', ['add', '-A']);
  commit('bot@users.noreply.github.com', 'remove');
  // 還沒加入的新檔案：路徑與信箱
  fs.writeFileSync(path.join(repo, 'new.md'), `見 ${badPath}，聯絡 ${badEmail}`);
  // 網址裡的使用者名稱也算信箱
  fs.writeFileSync(path.join(repo, 'remote.md'), ['https:', '', ['alice', 'github.com'].join('@'), 'example', 'x'].join('/'));
  // 不該公開的設定檔
  fs.writeFileSync(path.join(repo, 'skill-hub.config.json'), '{}');
  const r = check();
  assert.equal(r.code, 1);
  for (const kind of ['敏感詞', '作者信箱', '本機路徑', '信箱', '禁止公開']) assert.match(r.out, new RegExp(kind), `應該抓到：${kind}`);
  assert.match(r.out, /leak\.md@/);
  assert.match(r.out, /remote\.md:1\s+alice@github\.com/);
});

test('來源與作者：metadata.author 優先，第三方從 GitHub 網址取帳號', () => {
  assert.deepEqual(sourceInfo({ upstream: 'https://github.com/example/tone-polisher.git', license: 'MIT' }),
    { kind: 'third', author: 'example', url: 'https://github.com/example/tone-polisher.git', name: 'example/tone-polisher' });
  assert.equal(sourceInfo({ upstream: 'https://github.com/example/x', author: '某作者' }).author, '某作者');
  assert.deepEqual(sourceInfo({}), { kind: 'own', author: null, url: null, name: null });
  assert.equal(sourceInfo({ hasLicenseFile: true }).kind, 'third');
});

test('版本歷史：子資料夾來源、改了沒升版號、未 commit 檔案', () => {
  const repo = tmp();
  const run = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@users.noreply.github.com', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const skillDir = path.join(repo, 'pack', 'skills', 'alpha');
  const write = (v, extra = '') => fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: alpha\ndescription: 測試「alpha」\nmetadata:\n  version: "${v}"\n---\n# alpha\n${extra}`);
  run(['init', '-q']);
  fs.mkdirSync(skillDir, { recursive: true });
  write('1.0.0'); run(['add', '-A']); run(['commit', '-qm', 'v1']);
  write('1.1.0'); run(['add', '-A']); run(['commit', '-qm', 'v1.1']);
  write('1.1.0', '改了內容\n'); run(['add', '-A']); run(['commit', '-qm', 'no bump']);
  fs.writeFileSync(path.join(skillDir, 'new.md'), 'x');
  const [s] = scanSource({ name: 't', path: path.join(repo, 'pack') }); // 來源是 repo 的子資料夾
  assert.deepEqual(s.versions.map((v) => v.version), ['1.1.0', '1.0.0']);
  assert.equal(s.commits.length, 3);
  assert.equal(s.uncommitted, 1);
  assert.deepEqual(s.commits.map((c) => c.version), ['1.1.0', '1.1.0', '1.0.0']);
});

test('首次設定：建議設定檔用 ~ 表示家目錄、名稱不重複', () => {
  const home = os.homedir();
  const cfg = buildConfig({
    sources: [{ path: path.join(home, 'dev', 'skills') }, { path: path.join(home, 'other', 'skills') }],
    usage: { claudeCode: true, codex: false },
  });
  assert.deepEqual(cfg.sources, [{ name: 'skills', path: '~/dev/skills' }, { name: 'skills-2', path: '~/other/skills' }]);
  assert.equal(cfg.usage.codex.enabled, false);
});

test('自訂表格：示範設定讀得到，壞掉或找不到的檔案列進設定提醒', () => {
  const r = buildReport(loadConfig(path.join(ROOT, 'examples/demo.config.json')), { now: Date.parse('2026-10-29T00:00:00Z') });
  assert.equal(r.tables.length, 1);
  assert.equal(r.tables[0].title, '部署對照');
  assert.deepEqual(r.tables[0].views.map((v) => v.title), ['依專案', '依環境']);
  assert.deepEqual(r.tables[0].views[0].rows[0], ['my-shop', 'example', 'staging、production']);

  const dir = tmp();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ title: 'x', views: [{ title: 'y', columns: ['a'], rows: [[1]] }] }));
  const { tables, notes } = loadTables([bad, path.join(dir, 'missing.json')]);
  assert.equal(tables.length, 0);
  assert.match(notes[0], /views\[0\]\.rows 每一列要是文字陣列/);
  assert.match(notes[1], /找不到自訂表格/);
  assert.equal(tableProblem({ title: 'x', views: [] }), 'views 要是至少一項的陣列');
});

test('儀表板：自訂表格的文字會跳脫', () => {
  const html = renderDashboard({
    generatedAt: '2026-10-29T00:00:00Z', skills: [],
    tables: [{ title: '<b>x</b>', description: '', views: [{ title: 'v', note: '', columns: ['a'], rows: [['</script>']] }] }],
  });
  assert.ok(!html.includes('</script>"'));
  assert.ok(html.includes('renderTables'));
});

test('儀表板：資料內嵌時跳脫 </script>', () => {
  const html = renderDashboard({ generatedAt: '2026-10-29T00:00:00Z', skills: [{ description: '</script><img onerror=x>' }] });
  assert.ok(!html.includes('</script><img'));
  assert.ok(html.includes('\\u003c/script>'));
});

test('更新按鈕：skillhub:// 只執行固定指令，不帶網址內容', () => {
  const file = String.raw`C:\tools\skill-hub\scripts\update-dashboard.cmd`;
  const cmd = handlerCommand(file, String.raw`C:\Windows`);
  assert.equal(cmd, String.raw`"C:\Windows\System32\cmd.exe" /c ""C:\tools\skill-hub\scripts\update-dashboard.cmd" /web"`);
  assert.ok(!cmd.includes('%1'));
  assert.throws(() => handlerCommand(String.raw`C:\a%PATH%\update-dashboard.cmd`), /無法註冊/);
  assert.throws(() => handlerCommand(String.raw`C:\a"b\update-dashboard.cmd`), /無法註冊/);
  const steps = installSteps(file, String.raw`C:\Windows`);
  assert.ok(KEY.startsWith('HKCU\\Software\\Classes\\'));
  assert.ok(steps.every((a) => a[1].startsWith(KEY) && a.at(-1) === '/f'));
  assert.deepEqual(steps[1], ['add', KEY, '/v', 'URL Protocol', '/d', '', '/f']);
});

test('儀表板：更新按鈕與 iframe 檢查', () => {
  const html = renderDashboard({ generatedAt: '2026-10-29T00:00:00Z', skills: [] });
  assert.ok(html.includes('href="skillhub://update"'));
  assert.ok(html.includes('parent.postMessage({ skillhub: R.generatedAt }'));
});
