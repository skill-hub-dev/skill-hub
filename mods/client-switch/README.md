# client-switch（Claude Code Mod）

管理很多客戶帳號用的 mod：讓 Claude 知道目前的專案是哪個客戶的，之後再依客戶切換 git 身分、擋下推錯帳號的動作。

進度見 `.claude/progress.md`。

## 名冊：`~/.claude/clients.json`

放在使用者資料夾，不進任何 repo。**只放名稱、帳號、ID，不放密碼或 token。** 範例見 [`clients.example.json`](clients.example.json)。

- `clients`：每個客戶一筆，記錄 GitHub owner／帳號／email、Vercel team、Supabase 專案、Cloudflare account id、Google email。
- `projects`（選填）：指定某個資料夾屬於哪個客戶，也可以記錄它關聯的服務（`links`）。子資料夾也算，寫得越深的優先。
  - `accounts`（選填）：哪些服務用另一個客戶的帳號，例如 `{ "github": "乙工作室", "cloudflare": "乙工作室" }`；服務名稱是 `github`、`vercel`、`supabase`、`cloudflare`、`google`。沒寫的服務用 `client` 的帳號。之後的切換與核對都照這個。
  - `deploy`（選填）：一句話說明這個專案怎麼部署。
- `skillHub`（選填）：Skill Hub 資料夾，例如 `"C:/work/skill-hub"`。有寫的話，名冊一改，mod 就把對照表寫到 `~/.claude/client-switch/skill-hub-table.json` 並重建 Skill Hub，儀表板多一個「帳號對照」分頁（依專案／依客戶／依服務）。Skill Hub 的 `skill-hub.config.json` 要有 `"tables": ["~/.claude/client-switch/skill-hub-table.json"]`。

## 怎麼判斷專案是哪個客戶的

1. `projects` 有寫這個資料夾 → 就是那個客戶（橫條顯示「專案設定」）。
2. 沒寫 → 看 git 的 origin：`github.com/<owner>/...` 的 owner 列在哪個客戶的 `github.owners` 裡，就算那個客戶的（橫條顯示「依 git remote 判斷」）。
3. 都對不到 → 「客戶：未指定」，只警告不擋。

改了 `clients.json` 不用重開，10 秒內或送出下一則訊息時就會更新。

## 載入

`~/.claude/settings.json` 的 `env.CLAUDE_CODE_PLUGIN_DIRS` 加上本資料夾（多個路徑用 `;` 分隔），改完重開桌面 app。

## 檢查

- `claude plugin validate .`
- `claude plugin test .`
- `npx -y -p typescript@5.9.3 tsc -p . --noEmit`（mod 載入過一次、`.claude-plugin/types/` 產生之後才能跑）
