# 公開發布規範

這個 repo 是公開的開源專案。任何人都看得到裡面每個檔案、每個 commit 的內容、作者與訊息，而且**一旦推送，就算之後刪掉，也可能已經被複製、快取或索引**。所以推送前要確定：裡面只有通用的程式與文件，沒有任何維護者或使用者的個人資訊。

本規範適用於所有推送到這個 repo 的內容，包括人工撰寫與 AI 助手（Claude Code、Codex 等）產生的內容。

---

## 1. 絕對不能出現的內容

| 類別 | 例子 | 為什麼 |
|---|---|---|
| 身分 | 真名、個人 GitHub 帳號名稱、帳號 ID、個人信箱、電話 | 能直接找到維護者本人 |
| 組織與客戶 | 公司名稱、品牌名稱、客戶名稱、合作案名稱 | 洩漏商業關係 |
| 本機路徑 | `C:\Users\<名字>\…`、`/home/<名字>/…`、`/Users/<名字>/…`、自己電腦上的專案路徑 | 帶出使用者名稱與專案結構 |
| 私人專案資訊 | 私人 repo 名稱與網址、私人專案的資料夾名稱、內部代號與任務編號 | 洩漏未公開的工作 |
| 個人資料產出 | 自己的 skill 清單、版本、使用紀錄、審查紀錄、儀表板輸出 | 這些是工具「處理」的資料，不是工具本身 |
| 機密 | API Key、Token、密碼、私鑰、`.env` 內容、連線字串 | 會被立即濫用 |
| 隱藏內容 | 零寬字元、雙向控制字元、Unicode tag 字元 | 可能藏有看不見的指令或資訊 |

需要舉例時，一律使用明顯是假的內容：

- 人名、帳號：`example`、`your-name`
- 路徑：`~/dev/skills`、`C:\work\proj`、`C:\Users\u\…`、`/home/u/…`（使用者名稱固定用 `u`）
- 網址：`https://github.com/example/…`、`https://github.com/<owner>/<repo>`
- skill 名稱：`meeting-notes`、`release-checklist`、`tone-polisher` 這類通用名稱

## 2. 永遠只留在本機的檔案

這些檔案已列在 `.gitignore`，**不可以用 `git add -f` 強制加入**：

| 檔案 | 內容 |
|---|---|
| `skill-hub.config.json` | 指向你自己 skill 資料夾的設定、你的分類對照表 |
| `out/` | 儀表板與 `skills.json`（含 skill 清單、專案名稱、使用紀錄） |
| `data/` | 資安審查紀錄 |
| `usage/*.jsonl` | 其他平台的使用紀錄匯入檔 |
| `.privacy-keywords.local` | 你的私人敏感詞清單（見第 5 節） |
| `.claude/` | AI 助手的本機工作紀錄與預覽設定 |
| `.env`、`*.local` | 任何本機機密或個人設定 |

要給別人參考的設定，改寫成假資料放進 `skill-hub.config.example.json` 或 `examples/`。

## 3. commit 身分

- 作者與提交者信箱只能是 GitHub 的 noreply 信箱（`…@users.noreply.github.com`），或共同作者標記用的 `noreply@anthropic.com`。
- 維護者在這個 repo 用專案身分 commit，**只設定在這個 repo**，不要改全域設定：

  ```bash
  git config user.name "skill-hub-dev"
  git config user.email "skill-hub-dev@users.noreply.github.com"
  ```

- 不要用帶有個人帳號名稱或帳號 ID 的 noreply 信箱（例如 `12345678+個人帳號@users.noreply.github.com`），那會把 commit 連回個人帳號。
- 建議在 GitHub 的 Settings → Emails 開啟「Keep my email addresses private」與「Block command line pushes that expose my email」。

## 4. commit 訊息、分支、標籤

- 只描述「改了什麼功能」，不寫客戶名稱、私人專案名稱、內部任務編號、個人電腦的路徑。
- 不要貼終端機輸出或錯誤訊息原文，裡面常帶有本機路徑與使用者名稱；需要時先改成假路徑。
- 分支與標籤名稱同樣只用功能描述，例如 `feat/categories-projects`。

## 5. 推送前檢查（必做）

### 5.1 自動檢查

```bash
npm run privacy
```

`scripts/privacy-check.mjs` 會檢查：

1. **要公開的檔案**（目前 HEAD 加上暫存區）：機密格式、本機使用者路徑、非白名單的信箱與網址、隱藏字元、私人敏感詞
2. **不該被追蹤的檔案**：第 2 節列出的檔案是否被 commit
3. **所有 commit 的中繼資料**：作者、提交者信箱是否為 noreply；commit 訊息裡有沒有路徑、信箱、私人敏感詞

有任何問題就 exit 1，**不能推送**。

### 5.2 私人敏感詞清單

通用的規則抓不到「你自己的」名稱，例如帳號、公司、客戶、專案代號。把它們寫進 repo 根目錄的 `.privacy-keywords.local`，一行一個（不分大小寫，`#` 開頭是註解）：

```text
# 我的帳號與信箱
your-account
your-name@example.com
# 公司、品牌、客戶
your-company
# 私人專案代號
secret-project
```

這個檔案本身不進版控。檢查腳本找不到它時會警告，請每台要推送的電腦都建一份。

### 5.3 推送前自動擋下

```bash
npm run install-hooks
```

會在這台電腦的 `.git/hooks/pre-push` 加上檢查，之後每次 `git push` 都會先跑 `npm run privacy`，沒過就不會推送。hook 不會被 commit，換電腦要重新執行一次。

### 5.4 人工確認

自動檢查只能抓到已知的樣式。推送前再看一次：

```bash
git diff origin/main --stat
git log origin/main..HEAD --format="%h %an <%ae> %s"
```

確認每個檔案都是你預期要公開的、每個 commit 的作者都是專案身分。

## 6. AI 助手的規則

在這個 repo 工作的 AI 助手（Claude Code、Codex 等）必須：

1. 寫入範例、測試、文件時，只用第 1 節的假資料，不得引用對話中看到的真實帳號、路徑、專案名稱或客戶名稱。
2. 不得 `git add -f` 第 2 節的任何檔案。
3. 每次 commit 前執行 `npm run privacy`；每次推送前再執行一次，並把結果回報給使用者。
4. 檢查沒過時，修正後重跑，不可以跳過 hook（`--no-verify`）。
5. 終端機輸出、錯誤訊息只放在對話裡，不寫進 commit 訊息或檔案。
6. 推送後，從 GitHub 公開 API 核對 commit 作者與檔案清單。

## 7. 萬一推送了不該公開的內容

依嚴重程度處理，**越快越好**：

1. **機密（Key、Token、密碼）**：立刻到該服務撤銷並換新。不要只刪檔案，因為推送的那一刻就要當成已外洩。
2. **個人資訊或私人名稱**：
   - 只在最新 commit、還沒有人 fork：修正後用新 commit 覆蓋，再評估是否改寫歷史。
   - 已經在歷史裡：用 `git filter-repo` 移除後強制推送，並請 GitHub Support 清除快取的 commit 檢視。
3. 把漏掉的樣式加進 `scripts/privacy-check.mjs` 或 `.privacy-keywords.local`，避免再發生。
4. 記錄發生什麼事、怎麼處理（記在本機，不要寫進公開 repo）。

## 8. 新增功能時的自我檢查

- [ ] 新功能讀取的使用者資料，輸出位置都在第 2 節的忽略清單內
- [ ] 新增的設定欄位，範例都用假資料
- [ ] 新增的測試，路徑與名稱都用假資料
- [ ] `npm test` 通過
- [ ] `npm run privacy` 通過
- [ ] 人工確認 diff 與 commit 作者
