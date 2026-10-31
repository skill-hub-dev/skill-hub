# skill-hub

公開的開源專案：讀取 Agent Skills 正本 repo 與各平台本機紀錄，產生本機儀表板。零相依，只用 Node.js 內建模組。

## 公開發布（最優先）

這個 repo 是公開的。推送前一律遵守 [docs/publishing-rules.md](docs/publishing-rules.md)，重點：

- 檔案、測試、範例、commit 訊息都不能出現真實的帳號、信箱、本機路徑、公司或客戶名稱、私人專案名稱、機密。需要舉例時用規範第 1 節的假資料（路徑的使用者名稱用 `u`）。
- `skill-hub.config.json`、`out/`、`data/`、`usage/*.jsonl`、`.privacy-keywords.local`、`.claude/` 永遠不進版控，不可 `git add -f`。
- commit 身分只用 repo 內設定的 `skill-hub-dev <skill-hub-dev@users.noreply.github.com>`，不要改全域設定。
- 每次 commit 與推送前執行 `npm run privacy`，沒過不推；不可用 `--no-verify` 跳過 hook。
- 推送後從 GitHub 公開 API 核對 commit 作者與檔案清單，並回報使用者。

## 開發

- 測試：`npm test`（node:test）
- 示範：`npm run demo`（只讀 `examples/` 的假資料）
- 結構見 README 的「開發」一節
