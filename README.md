# Skill Hub

把 skill 放在 GitHub 上給各 AI 平台共用，用久了就會忘記手上有哪些 skill、哪個是最新版、哪個早就沒在用。Skill Hub 是另外一個管理工具：讀取你的 skill 正本 repo 和各平台的本機紀錄，產生一個儀表板，在同一個畫面上看：

- **用途與指令**：description、`/指令`、觸發關鍵字、章節大綱
- **版本紀錄**：從 git 歷史還原每個版本號第一次出現的時間，對上 changelog 與 commit
- **近期使用**：Claude Code、Codex、Grok Bot（或任何平台）各用了幾次、最後一次是哪天、在哪些專案
- **健檢清單**：哪些該升版號、該拆檔、觸發詞跟別的 skill 撞到、第三方 skill 落後上游、很久沒用……

零相依（只用 Node.js 內建模組），不需要 `npm install`。

## 隱私

這個 repo 只放程式。你的 skill 清單、版本、使用紀錄都只產生在本機：

- `skill-hub.config.json`（指向你的 repo 路徑）與 `out/`（產出的儀表板）都在 `.gitignore` 裡
- 使用紀錄只取 **skill 名稱、時間、專案資料夾名**，不讀取、不保存任何對話內容
- 整個流程不連網；只有加上 `--remote` 時才會用 `git ls-remote` 查第三方 skill 的上游版本

## 快速開始

需要 Node.js 20 以上與 git。

```bash
git clone <this repo> skill-hub
cd skill-hub
node bin/skill-hub.mjs init        # 產生 skill-hub.config.json
# 編輯 skill-hub.config.json 的 sources，指向你的 skill 正本 repo
node bin/skill-hub.mjs build --open
```

想先看看長什麼樣子：`npm run demo`，會用 `examples/` 裡的假資料產生 `out/demo/index.html`。

## 指令

| 指令 | 說明 |
|---|---|
| `skill-hub build [--open]` | 產生 `out/index.html`（資料內嵌，雙擊就能開）與 `out/skills.json` |
| `skill-hub check` | 在終端機列出健檢結果；有「錯誤」時 exit 1，可放進 pre-push hook 或 CI |
| `skill-hub usage [--days 30]` | 列出近期用過與沒用到的 skill |
| `skill-hub serve [--port 4173]` | 用 `http://127.0.0.1:4173` 開啟已產生的儀表板 |

共用選項：`--config <檔案>`、`--remote`（比對上游）、`--json`（`check`／`usage` 輸出 JSON）。

## 設定檔

```json
{
  "sources": [
    { "name": "my-skills", "path": "~/dev/skills" },
    { "name": "work-skills", "path": "D:/work/skills" }
  ],
  "usage": {
    "claudeCode": { "enabled": true, "dir": "~/.claude/projects" },
    "codex": { "enabled": true, "dir": "~/.codex/sessions" },
    "imports": [{ "platform": "grok-bot", "file": "usage/grok-bot.jsonl" }]
  },
  "checks": { "unusedDays": 60, "descriptionMax": 1024, "bodyMaxLines": 500, "remote": false },
  "outDir": "out"
}
```

- `sources` 可以有多個。每個來源底下「含有 `SKILL.md` 的資料夾」就是一個 skill（也支援 `skills/<name>/SKILL.md` 排法）。開頭是 `_` 或 `.` 的資料夾會略過。
- 來源是 git repo 時才有版本歷史；不是的話仍會列出 skill 與健檢。

## 使用量怎麼算

| 平台 | 讀哪裡 | 怎麼判斷 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | `Skill` 工具呼叫，加上使用者直接打的 `/skill-name`（同一對話 2 分鐘內只算一次；`/compact` 等內建指令不算） |
| Codex | `~/.codex/sessions/**/*.jsonl` | Codex 用指令讀 `skills/<name>/SKILL.md`，從工具呼叫的參數找這個路徑；同一個 session 算一次 |
| Grok Bot 或其他 | `usage.imports` 指定的 JSONL | 每行一筆，見下方格式 |

在雲端跑的平台（例如 Grok Bot）本機沒有紀錄，請讓它在用到 skill 時寫一行事件，再把檔案放到 `imports` 指定的位置：

```json
{"ts":"2026-10-27T09:12:00Z","skill":"meeting-notes","platform":"grok-bot","session":"可省略","project":"可省略"}
```

`skill` 可以帶前綴（`plugin:meeting-notes`），會自動取冒號後面的名字。

有使用紀錄、但不在任何來源 repo 裡的 skill（平台內建或另外安裝的），會列在儀表板的「未納管的 skill」。

## 健檢規則

規則依 [Agent Skills](https://agentskills.io) 的 SKILL.md 格式設計，門檻可在 `checks` 調整。

| 等級 | 規則 |
|---|---|
| 錯誤 | 沒有 frontmatter、缺 `name`／`description`／`metadata.version`、`name` 與資料夾不同、疑似含有密鑰 |
| 警告 | description 超過 1024 字元、description 沒有觸發關鍵字、本文超過 500 行、版本號不是 `主.次.修`、改了 skill 卻沒升版號、超過 N 天沒用、第三方 skill 缺 `source`／`source_commit`／`license`、上游有新版（`--remote`）、多個來源有同名 skill |
| 提示 | 從未使用、有未 commit 的修改、changelog 沒跟上目前版本、觸發詞與其他 skill 重疊 |

「觸發關鍵字」指 description 裡用「」或 "" 括起來的詞。觸發詞重疊不一定是錯，但兩個 skill 搶同一個詞時，模型可能叫錯。

## 建議的 frontmatter

```yaml
---
name: meeting-notes
description: |
  把會議逐字稿整理成決議與待辦。會議結束、貼上逐字稿時啟動。
  只要使用者提到「會議紀錄」「逐字稿」「待辦清單」等，也應主動調用此技能。
license: MIT                       # 第三方 skill 才需要
metadata:
  version: "1.2.0"
  source: https://github.com/<owner>/<repo>   # 第三方 skill 才需要
  source_commit: <commit hash>
  changelog: "1.2.0: 新增負責人欄位 | 1.0.0: 初版"
---
```

## 開發

```bash
npm test          # node:test，不需安裝任何套件
npm run demo
```

結構：`src/frontmatter.mjs`（精簡 YAML 解析）、`src/sources.mjs`（掃描 repo 與 git 歷史）、`src/usage.mjs`（各平台紀錄）、`src/checks.mjs`（健檢）、`src/report.mjs`（彙整）、`web/dashboard.html`（儀表板範本）、`bin/skill-hub.mjs`（CLI）。

新增平台：在 `src/usage.mjs` 寫一個回傳 `{ platform, skill, ts, session, project }` 陣列的函式，接到 `collectUsage`。

## 授權

MIT
