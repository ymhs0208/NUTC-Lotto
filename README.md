# 國立臺中科技大學專題展報告抽籤系統

React + Vite 前端與 Express API，全套後端使用 Cloudflare Workers、Static Assets 與 SQLite Durable Objects。正式執行不需要 Supabase 或獨立 Node 伺服器。新版從空名冊開始，不轉移舊資料。

## 本機開發

1. 安裝 Node.js 22.12 以上版本與套件：`pnpm install` 或 `npm install`。SQLite 單元測試建議使用 Node.js 22.13 以上。
2. 複製 `.env.example` 為 `.dev.vars`，分別替換 `SESSION_SECRET` 與 `SETUP_TOKEN`。可使用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 產生兩個不同的隨機值，每個至少 32 字元。不要提交這些值。
3. 執行 `npm run dev`，開啟 `https://localhost:3000`。Wrangler 的本機 HTTPS 憑證為自簽憑證，瀏覽器首次會提示確認。本機資料保存於 `.wrangler/state`，重新啟動不會清空。
4. 依下節建立管理員與抽籤人員帳號，登入 `/admin` 與 `/stage`。學生入口為首頁。名冊初始為空，預設保留七個領域設定；可由管理員重新匯入 Excel。

`npm run dev:cloudflare` 與 `npm start` 使用相同的 Workers 本機環境。啟動前會編譯前端；修改前端後需重新編譯，Worker 與後端程式由 Wrangler 監看更新。

## 工作人員帳號

帳號、角色與 scrypt 密碼雜湊存放在 Cloudflare SQLite，登入不再呼叫外部 Auth 服務，也沒有預設帳密或公開註冊。

在已被 Git 忽略的 `data/staff-accounts.json` 建立帳號檔，將範例 Email 與密碼替換為實際值：

```json
[
  { "email": "admin@example.edu.tw", "role": "admin", "password": "replace-with-your-private-password" },
  { "email": "stage@example.edu.tw", "role": "stage", "password": "replace-with-another-private-password" }
]
```

密碼須為 8 至 128 字元。CLI 在本機計算雜湊，只將雜湊送至 Cloudflare。執行：

```sh
TARGET_URL=https://localhost:3000 SETUP_TOKEN='<與 .dev.vars 相同的值>' npm run accounts:setup -- data/staff-accounts.json
```

也可將 CLI 的 `TARGET_URL` 與 `SETUP_TOKEN` 放在 `.env.local`，避免將憑證寫進 shell 歷史。CLI 會讀取 `.env.local` 與 `.env`；Wrangler 的執行設定則使用 `.dev.vars` 或正式 Secrets。

同 Email 再次執行會更新該帳號的角色與密碼，保留 ID；密碼更新立即使舊 session 失效。未列出的帳號會保留。設定完後刪除帳號檔與 CLI 的 `SETUP_TOKEN`，並移除執行環境的 `SETUP_TOKEN` 以關閉 `/api/cloudflare/setup`。未設定 token 時此端點回傳 404。日後需要設定帳號時，再臨時加入 token。

## 正式部署

部署前先登入 Cloudflare，設定正式 Secrets。正式與本機帳號、資料庫完全獨立：

```sh
npx wrangler login
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SETUP_TOKEN
npm run deploy:check
npm run deploy
```

`wrangler.jsonc` 的 Worker 名稱為 `nutc-lotto`，與 `lottery.nutc.cc.cd` 實際綁定的 Worker 一致。Secrets 必須設定在這個 Worker。部署使用新增的 `v2` migration 建立 `LotteryDatabase`，並保留既有 `v1` 的 API 與限流物件。資料庫 schema 在物件首次啟動時自動建立，不需要手動執行 SQL 或填 D1 ID。

Wrangler 的 `build.command` 已設定為 `npm run build`，本機直接執行 `npx wrangler deploy` 會先產生 `dist`。Cloudflare Workers Builds 不採用此自訂編譯設定，因此後台必須另外將 Build command 設為 `npm run build`、Deploy command 設為 `npx wrangler deploy`。連接 `ymhs0208/NUTC-Lotto` 的 `main` 分支，Root directory 使用儲存庫根目錄。請參閱 [Cloudflare Builds 官方設定說明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

部署後以正式 `TARGET_URL=https://lottery.nutc.cc.cd` 與正式 `SETUP_TOKEN` 執行帳號設定，再關閉設定端點：

```sh
npx wrangler secret delete SETUP_TOKEN
```

原 Supabase secrets 已不被程式使用，可於 Cloudflare 設定移除。`supabase/migrations` 僅為舊版本歷史，新版不會讀取或執行。更換 `SESSION_SECRET` 會使所有既有登入 cookie 失效。

## 儲存與權限

- `LOTTERY_DATABASE` 的固定物件 `lottery-v1` 保存所有名冊、領域設定、資料版本、工作人員帳號與登入 session。專題以獨立 SQLite 資料列保存，ID 與正規化組長學號有唯一索引。
- 所有名冊、設定、抽籤及重設寫入在 `transactionSync` 交易內比對版本並提交。兩個裝置使用同一版本寫入時只有一筆成功，另一筆收到 HTTP 409；失敗不會留下部分結果。
- `API_BACKEND` 仍使用多個物件處理請求與 scrypt，避免密碼雜湊阻塞資料庫。`LOGIN_LIMITER` 保存共享、原子更新的登入與匿名端點限流計數。SQLite 物件僅透過 Worker binding 存取，無公開資料庫網址。
- 工作人員與學生使用一小時的 HttpOnly、Secure、SameSite=Strict 簽名 cookie。資料庫只保存隨機 token 的 SHA-256，不保存工作人員 access token。密碼更新或學生專題刪除會使相應登入失效；登出刪除 session。Durable Object alarm 每小時清除過期 session。
- 管理員可管理名冊、評審及設定；抽籤人員可抽籤、重設及展示結果。管理員 API 不回傳密碼雜湊，抽籤人員 API 不回傳學號、班級、指導老師與評審名單。
- 學生登入依組長學號查詢單筆專題，查榜以 session 綁定專題，不接受前端指定其他專題。公開結果僅含領域、編號、分組與順位。跨站 JSON 寫入會被拒絕。
- 學生個別密碼使用 scrypt（N=32768、r=8、p=3）與隨機 salt。密碼留空保留既有雜湊，新名冊不自動產生預設密碼；變更學號須重新設定密碼。共用密碼功能產生 8 碼隨機密碼，僅顯示一次；輪替或停用會使舊 session 失效。
- 名冊最多 2000 筆，匯入與寫入上限 5 MB；單次最多設定 100 組學生密碼。小操作上限 64 KB，登入上限 4 KB。登入入隊、scrypt、session 工作保留原有並行與等待限制。
- 本版公開結果直接讀取同一 SQLite 快照，成功寫入後立即可見；不使用跨 isolate 的舊快取。資料庫不可用時回傳錯誤，不改用本機 JSON 或前端抽籤。

## 抽籤與展示

抽籤保留指導老師利益迴避、領域多選、指定每組件數、領域顯示順序及全螢幕結果輪播。多領域抽籤在一次交易中提交，任一領域配置無解時整次不儲存。已有結果的領域或組別須先重設才能刪除或縮減。

A～G 領域使用領域字母加至少兩位數字，例如 A01、A100；原始編號與抽籤編號分開，重設不會重新編排名冊。Excel 匯出依原始編號排序，不含密碼或雜湊。管理員測試抽籤只試跑，不變更正式資料或版本。

## 驗證

```sh
npm run lint
npm test
npm run deploy:check
npm run benchmark:student-login -- --students=300
```

測試包含 SQLite 交易回復、版本衝突、單筆學生查詢、session 到期清理，以及實際本機 workerd 的登入、角色限制、抽籤、公開資料白名單、密碼輪替與重啟持久性。整合測試與 benchmark 使用暫存的獨立資料庫及合成帳號，不修改正式或開發資料。Benchmark 測量本機 Workers 與 SQLite，不代表正式校園網路容量。

SQLite Durable Objects 的儲存與交易行為可參考 [Cloudflare 官方文件](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)。

## 各領域結果查詢

免登入開啟 `/results`，或點選頁面頂端「各領域結果」。選擇領域後可查詢已抽籤專題的編號、報告場次與專題名稱；支援卡片／表格切換、每次增加 50 件及手動更新。切換顯示方式使用已載入資料。

唯讀 API：`GET /api/public/results?field=領域名稱`。未指定領域時只取得領域選單；結果依場次與報告順序排列。不回傳組長學號、密碼、評審或未抽籤專題。沿用現有 Cloudflare SQLite 資料庫，不需新增資料庫 migration。
