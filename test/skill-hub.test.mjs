import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { parseSkillFile } from '../src/frontmatter.mjs';
import { renderDashboard } from '../src/render.mjs';
import { buildReport } from '../src/report.mjs';
import { extractTriggers, firstSentence, parseChangelog } from '../src/sources.mjs';
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
  assert.deepEqual(ev.map((e) => [e.skill, e.project]), [['demo', 'proj'], ['demo', 'other']]);
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
  assert.deepEqual(ev.map((e) => [e.skill, e.project]), [['demo', 'proj']]);
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
  assert.equal(by['meeting-notes'].version, '1.2.0');
  assert.equal(by['meeting-notes'].usage.total, 4);
  assert.equal(by['meeting-notes'].health, 'ok');
  const codes = (n) => by[n].issues.map((i) => i.code);
  assert.ok(codes('tone-polisher').includes('missing-source-commit'));
  assert.ok(codes('tone-polisher').includes('unused'));
  assert.deepEqual(r.unmanaged.map((u) => u.name), ['pdf']);
  assert.ok(!('absPath' in by['meeting-notes']));
});

test('儀表板：資料內嵌時跳脫 </script>', () => {
  const html = renderDashboard({ generatedAt: '2026-10-29T00:00:00Z', skills: [{ description: '</script><img onerror=x>' }] });
  assert.ok(!html.includes('</script><img'));
  assert.ok(html.includes('\\u003c/script>'));
});
