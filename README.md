# Skill Hub

把 skill 放在 GitHub 上給各 AI 平台共用，用久了就會忘記手上有哪些 skill、哪個是最新版、哪個早就沒在用。Skill Hub 是另外一個管理工具：讀取你的 skill 正本 repo 和各平台的本機紀錄，產生一個儀表板，在同一個畫面上看：

- **用途與指令**：description、`/指令`、觸發關鍵字、章節大綱
- **分類**：行銷、開發、設計……可以自己指定，沒指定的依關鍵字自動判斷
- **版本紀錄**：從 git 歷史還原每個版本號第一次出現的時間，對上 changelog 與 commit
- **近期使用**：Claude Code、Codex、Grok Bot（或任何平台）各用了幾次、最後一次是哪天
- **用在哪些專案**：每個專案用了哪些 skill、各幾次
- **資安審查**：哪些 skill 已經審查過、審查後有沒有被改過、腳本會不會連網或執行其他程式
- **健檢清單**：哪些該升版號、該拆檔、觸發詞跟別的 skill 撞到、第三方 skill 落後上游、很久沒用……

零相依（只用 Node.js 內建模組），不需要 `npm install`。

## 隱私

這個 repo 只放程式。你的 skill 清單、版本、使用紀錄、審查紀錄都只產生在本機：

- `skill-hub.config.json`（設定）、`out/`（儀表板）、`data/`（資安審查紀錄）、`usage/*.jsonl`（匯入檔）都在 `.gitignore` 裡
- 使用紀錄只取 **skill 名稱、時間、工作資料夾**，不讀取、不保存任何對話內容
- 整個流程不連網；只有加上 `--remote` 時才會用 `git ls-remote` 查第三方 skill 的上游版本

## 快速開始

需要 Node.js 20 以上與 git。

```bash
git clone https://github.com/skill-hub-dev/skill-hub.git
cd skill-hub
node bin/skill-hub.mjs init
node bin/skill-hub.mjs build --open
```

`init` 是首次設定精靈：

1. 找出這台電腦上含 `SKILL.md` 的資料夾（`~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills`，以及 `~/dev`、`~/code` 等資料夾底下名稱有 skill 的），標出哪個是 git repo、哪個只是平台的複本，預設選 git repo 那個當正本
2. 找出 Claude Code、Codex 的本機紀錄，問你要不要統計
3. 問你有沒有其他平台要用匯入檔記錄
4. 寫出 `skill-hub.config.json`

只會讀取，不會修改你的 skill 資料夾。加 `--yes` 可以不問問題、直接採用偵測結果。

想先看看長什麼樣子：`npm run demo`，會用 `examples/` 裡的假資料產生 `out/demo/index.html`。

## 儀表板

| 分頁 | 內容 |
|---|---|
| Skill 清單 | 全部 skill，可搜尋、依分類／狀態篩選、排序 |
| 依分類 | 同樣的清單，按分類分組 |
| 依專案 | 每個專案用過哪些 skill、各幾次（虛線框是不在來源 repo 裡的 skill） |
| 設定與說明 | 目前讀到哪些路徑、各平台抓到幾筆、常用指令 |

畫面上的記號：

| 記號 | 意思 |
|---|---|
| 綠／黃／紅圓點 | 健檢正常／有警告／有錯誤 |
| 長條圖 | 近 26 週每週使用次數，深色是最近 4 週 |
| 已檢查 | 有完整的資安審查紀錄，審查後沒有再修改 |
| 部分檢查 | 只審查了部分內容（例如併入的外部資料） |
| 需重審 | 審查之後 skill 又被修改 |
| 未通過 | 最近一次審查沒通過 |
| 未檢查 | 沒有審查紀錄；第三方 skill 會用警告色標示 |

點任一個 skill 會打開詳細面板：用途、可複製的指令、觸發詞、使用狀況與專案、資安、版本紀錄、最近修改、章節大綱。

## 指令

| 指令 | 說明 |
|---|---|
| `skill-hub init [--yes]` | 首次設定精靈 |
| `skill-hub build [--open]` | 產生 `out/index.html`（資料內嵌，雙擊就能開）與 `out/skills.json` |
| `skill-hub check` | 在終端機列出健檢結果；有「錯誤」時 exit 1，可放進 pre-push hook 或 CI |
| `skill-hub usage [--days 30]` | 列出近期用過與沒用到的 skill |
| `skill-hub review` | 列出每個 skill 的資安審查狀態 |
| `skill-hub review <skill> --result pass` | 記錄一次資安審查（見下方） |
| `skill-hub serve [--port 4173]` | 用 `http://127.0.0.1:4173` 開啟已產生的儀表板 |

共用選項：`--config <檔案>`、`--remote`（比對上游）、`--json`（`check`／`usage` 輸出 JSON）。

## 設定檔

```json
{
  "sources": [{ "name": "my-skills", "path": "~/dev/skills" }],
  "usage": {
    "claudeCode": { "enabled": true, "dir": "~/.claude/projects" },
    "codex": { "enabled": true, "dir": "~/.codex/sessions" },
    "imports": [{ "platform": "grok-bot", "file": "usage/grok-bot.jsonl" }]
  },
  "categories": { "行銷": ["meeting-notes"], "開發": ["release-checklist"] },
  "projects": { "roots": [], "aliases": { "my-shop-v2": "my-shop" } },
  "securityReviews": "data/security-reviews.json",
  "checks": { "unusedDays": 60, "descriptionMax": 1024, "bodyMaxLines": 500, "remote": false },
  "outDir": "out"
}
```

- **sources**：可以有多個。每個來源底下「含有 `SKILL.md` 的資料夾」就是一個 skill（也支援 `skills/<name>/SKILL.md` 排法）。開頭是 `_` 或 `.` 的資料夾會略過。來源是 git repo 才有版本歷史。
- **categories**：分類名稱對應 skill 名稱清單，名稱和順序都可以自訂。判斷順序是 SKILL.md 的 `metadata.category` → 這裡的對照表 → `categoryRules` 關鍵字自動判斷 → 未分類。自動判斷只是起點，大約七成準，建議在這裡列清楚。
- **categoryRules**：自動判斷用的關鍵字（選填，有內建預設）。英數關鍵字要整個字相符，中文用包含。
- **projects**：專案名稱預設取「往上找到的 git repo 資料夾名稱」，Claude Code／Codex 的 worktree 會歸回原專案。`roots` 可以指定「這個資料夾底下第一層就是專案」；`aliases` 把不同名稱合併成同一個專案。
- **securityReviews**：資安審查紀錄的位置。
- 設定檔可以用記事本編輯，開頭有 BOM 也讀得到。

## 使用量怎麼算

| 平台 | 讀哪裡 | 怎麼判斷 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | `Skill` 工具呼叫，加上使用者直接打的 `/skill-name`（同一對話 2 分鐘內只算一次；`/compact` 等內建指令不算） |
| Codex | `~/.codex/sessions/**/*.jsonl` | Codex 用指令讀 `skills/<name>/SKILL.md`，從工具呼叫的參數找這個路徑；同一個 session 算一次 |
| Grok Bot 或其他 | `usage.imports` 指定的 JSONL | 每行一筆，見下方格式 |

在雲端跑的平台（例如 Grok Bot）本機沒有紀錄，請讓它在用到 skill 時寫一行事件，再把檔案放到 `imports` 指定的位置：

```json
{"ts":"2026-10-27T09:12:00Z","skill":"meeting-notes","platform":"grok-bot","project":"可省略","session":"可省略"}
```

`skill` 可以帶前綴（`plugin:meeting-notes`），會自動取冒號後面的名字。

有使用紀錄、但不在任何來源 repo 裡的 skill（平台內建或另外安裝的），會列在儀表板的「未納管的 skill」。

## 資安審查

skill 的文字會變成模型的指令，腳本會在你的電腦上執行，所以第三方 skill 收錄前、更新前都應該逐份審查。Skill Hub 不替你審查，它做兩件事：

1. **記錄審查結果**：照你的審查流程做完後記一筆

   ```bash
   node bin/skill-hub.mjs review some-skill --result pass --ref <上游 commit> --note "逐份讀完，腳本只讀本機檔案"
   ```

   只審查了部分內容加 `--scope partial`；補登過去的審查加 `--date 2026-10-25`（會自動找出當天的版本）。審查之後 skill 又被修改，狀態會自動變成「需重審」。

2. **自動初篩**：每次 build 都會掃描每個 skill 資料夾的密鑰格式、隱藏字元（零寬、雙向控制、tag 字元），以及腳本裡的連網、執行其他程式、寫檔或刪檔。初篩有結果不代表有問題，沒結果也不代表安全，「已檢查」只以人工審查紀錄為準。

## 健檢規則

規則依 [Agent Skills](https://agentskills.io) 的 SKILL.md 格式設計，門檻可在 `checks` 調整。

| 等級 | 規則 |
|---|---|
| 錯誤 | 沒有 frontmatter、缺 `name`／`description`／`metadata.version`、`name` 與資料夾不同、疑似含有密鑰、資安審查未通過 |
| 警告 | description 超過 1024 字元、沒有觸發關鍵字、本文超過 500 行、版本號不是 `主.次.修`、改了沒升版號、超過 N 天沒用、第三方 skill 缺 `source`／`source_commit`／`license`、第三方 skill 沒有資安審查、審查後又被修改、含隱藏字元、上游有新版（`--remote`）、多個來源有同名 skill |
| 提示 | 從未使用、有未 commit 的修改、changelog 沒跟上、觸發詞與其他 skill 重疊、未審查的 skill 腳本含連網／執行／寫檔 |

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
  category: 管理                    # 選填：在儀表板的分類
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

| 檔案 | 負責 |
|---|---|
| `src/frontmatter.mjs` | 精簡 YAML 解析 |
| `src/sources.mjs`、`src/git.mjs` | 掃描 repo 與 git 歷史 |
| `src/usage.mjs` | 各平台紀錄 |
| `src/projects.mjs` | 工作資料夾對應到專案 |
| `src/categories.mjs` | 分類 |
| `src/security.mjs` | 資安審查紀錄與自動初篩 |
| `src/checks.mjs` | 健檢 |
| `src/setup.mjs` | 首次設定的偵測與建議 |
| `src/report.mjs` | 彙整 |
| `web/dashboard.html` | 儀表板範本 |
| `bin/skill-hub.mjs` | CLI |

新增平台：在 `src/usage.mjs` 寫一個回傳 `{ platform, skill, ts, session, cwd }` 陣列的函式，接到 `collectUsage`。

## 授權

MIT
