# 國立臺中科技大學專題展報告抽籤系統

React + Vite 前端、Express API、Cloudflare Workers 與 Durable Objects SQLite。正式網站不依賴 Supabase、D1 或其他外部資料庫。

## 架構

- Workers 提供 HTTPS 網站、前端 Static Assets 與 `/api/*` 路由。
- `API_BACKEND` 的 `ApiBackend` 物件分攤 API 和本地密碼驗證，不保存業務資料。一般部署維持此模式。
- 可選的分散驗證版本位於 `wrangler.distributed.jsonc`，隔離雲端測試已完成 1000/1000 筆驗證，完整千人登入仍待驗收，不隨一般部署啟用。該模式以固定 API 物件管理學生／工作人員登入佇列，再透過私有 `PASSWORD_VERIFIER_0` 至 `PASSWORD_VERIFIER_3` binding，將驗證分散到四個獨立 Worker。每個服務固定使用一個 `password-v1` 物件，一次執行一筆 scrypt，等待最多 32 筆、15 秒；不提供公開驗證路由、不讀取資料庫、不持久化驗證資料。
- `LOTTERY_DATABASE` 的 `LotteryDatabase` 物件（固定名稱 `lottery-v1`）持久化名冊、領域、資料版本、工作人員帳號、學生及工作人員 Session、操作紀錄。所有 API 物件共用這個資料庫；不能將它改成隨機分片，否則會看到不同資料。
- SQLite 的讀取、版本檢查與寫入在 `transactionSync` 中同步完成，不在交易內等候密碼驗證或網路。名冊／領域／版本與對應操作紀錄一同提交；其中一項失敗就全部回復。兩個使用同一版本的抽籤或儲存最多一個成功，另一個回傳 409。
- `LOGIN_LIMITER` 保留共用限流。校網模式將學生 IP 額度放寬至設定的 50 倍，仍保留帳號、Session、IP 和整體額度。這個旗標不會限制網站的網路來源，須先在防火牆／Cloudflare 設定限制來源。
- Workers Cron 每 10 分鐘清理過期 Session（每張表最多 500 筆）及超過臺灣日曆三個月的操作紀錄（最多 2500 筆）。沒有公開清理介面。

## 本機開發

使用 Node.js 22.13 以上（內建 `node:sqlite`；較舊 Node 22 版本可能顯示實驗性提示），建議目前的 Node LTS。

```sh
pnpm install
cp .env.example .env.local
openssl rand -hex 32
npm run staff:hash
```

將隨機字串填入 `.env.local` 的 `SESSION_SECRET`，將 `staff:hash` 印出的完整 `scrypt-v1$...` 填入 `ADMIN_PASSWORD_HASH`，並設定管理員 `ADMIN_EMAIL`。管理員與抽籤人員密碼須至少 8 字元、最多 128 字元。互動輸入的密碼不顯示，也不透過命令列參數傳送。這三項不能使用 `VITE_` 前綴。

```dotenv
SESSION_SECRET=你的隨機字串
ADMIN_EMAIL=admin@example.edu.tw
ADMIN_PASSWORD_HASH=scrypt-v1$完整雜湊
SQLITE_PATH=data/lottery.sqlite
PORT=3000
```

執行 `npm run dev`，開啟 `http://localhost:3000/admin`，使用設定的 Email 和原密碼登入。本機資料持久化在 `data/lottery.sqlite`，重新啟動保留資料。`npm start` 仍依 `NODE_ENV` 選擇開發／正式模式；Node 正式部署請先 build，再設定 `NODE_ENV=production` 啟動。

`ADMIN_EMAIL`／`ADMIN_PASSWORD_HASH` 只在資料庫完全沒有工作人員帳號時建立第一個管理員；後續修改環境設定不會重設帳號或新增另一個管理員。登入後可從右上角帳號選單開啟獨立的「工作人員帳號管理」頁面 `/accounts`，新增、改角色、設定密碼或停用帳號。變更後該帳號的現有 Session 立即失效，最後一個啟用的管理員不能被停用或降權。

## Cloudflare 部署

`wrangler.jsonc` 已保留原有 `v1` migration，追加 `v2` 建立 `LotteryDatabase` SQLite 物件，既有登入限流物件不會被移除。前端與 API 使用同一個 Worker 和網域。設定目前包含 `lottery.nutc.cc.cd` 自訂網域；部署到其他帳號或網域前請修改／移除 `routes`。

```sh
npx wrangler login
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD_HASH
npm run deploy:check
npm run deploy
```

`deploy:check` 僅檢查一般網站封裝；`deploy` 使用 `wrangler.jsonc`，明確設定 `PASSWORD_VERIFICATION_MODE=local`，不建立或啟用分散驗證服務。實驗版本另以 `npm run check:distributed` 檢查封裝，詳細狀態與啟用方式見 `security/PASSWORD_VERIFICATION_POOLS.md`。

依提示分別輸入隨機 Session secret、管理員 Email 和本機生成的完整密碼雜湊。線上不需要 `SQLITE_PATH`、`PORT` 或任何 Supabase 金鑰。首次登入成功後可移除 `ADMIN_EMAIL`／`ADMIN_PASSWORD_HASH` bootstrap secrets；保留它們也不會覆蓋既有帳號。

本機 Workers 執行環境：將同樣三項設定寫入未提交的 `.dev.vars`，然後執行 `npm run dev:cloudflare -- --local-protocol https`。分散驗證的本機開發另用 `npm run dev:distributed -- --local-protocol https`，會同時啟動五個服務。資料存在 `.wrangler/state`，與 Node 的 SQLite 檔案分開。

`SESSION_SECRET` 必須長期固定並在所有 API 物件相同。輪替會使既有 Cookie 與登入挑戰失效，所有使用者須重新登入。Cookie 具用途綁定 HMAC、HttpOnly、Secure、SameSite=Strict；SQLite 僅保存 token 雜湊。工作人員及學生 Session 有效期為一小時，密碼或帳號狀態變更後仍會重新核對有效性。

## 儲存庫既有 SQLite 升級

沿用 `nutc-lotto` Worker、`lottery.nutc.cc.cd` 網域、`LOTTERY_DATABASE` binding、`LotteryDatabase` 類別及 `lottery-v1` 物件名稱。首次讀取舊的 metadata／projects／accounts／staff_logs 格式時，在同一 SQLite 交易升級資料表，保留名冊、結果、版本、既有工作人員密碼雜湊和紀錄；失敗整筆回復。舊 Session 不再接受，使用者需重新登入。既有 SQLite 帳號不需要重新建立；bootstrap 只用於尚無帳號的新資料庫。

## 舊資料搬移

這次程式變更不會自動讀取或刪除舊線上資料。新 SQLite 資料庫初始為空名冊與預設領域，應在正式切換前安排搬移。

1. 暫停舊系統的抽籤及名冊寫入。在舊 PostgreSQL 的 SQL Editor 執行唯讀的 `scripts/export-legacy-state.sql`，將 `backup` 欄位內容保存為私人的 JSON 檔。格式是 `{ "projects": [...], "domainConfigs": [...] }`。若匯出工具外包了陣列／欄位，請取出 `backup` 的物件本體。
2. 需要搬移舊 JSON 時，可透過下述本機搬移指令，或管理員 API `/api/data/import` 匯入。API 只允許完全未操作的目標資料庫，已有資料或版本非零時會拒絕。匯入保留名冊、領域、評審、場次與抽籤結果，驗證不通過整筆回復。
3. 匯入會清除舊學生密碼／密碼雜湊，請在新後台重新產生共用密碼或設定個別密碼。工作人員帳號需在新後台重新建立；舊 Session、Supabase Auth 密碼與舊操作紀錄不自動搬移。舊紀錄請另行保存，新系統開始記錄新的操作。
4. 確认管理員及抽籤人員登入、名冊件數、學生查詢、公開結果和操作紀錄，再停止使用舊系統。確認備份與新系統正常前，保留舊資料庫。

搬入 Node 本機：`npm run migrate:local -- /絕對路徑/backup.json`。這會拒絕覆蓋已被操作的本機資料庫，同樣移除學生舊密碼。

管理員 API `/api/data/export` 可匯出名冊與結果備份。JSON 包含學生密碼雜湊，請妥善保存；不包含工作人員帳號、Session 或操作紀錄。匯入仍只允許空白資料庫，而且會清除學生密碼；它是資料搬移工具，並非完整帳號與稽核資料的災難復原工具。完整 SQLite 復原可使用 Cloudflare Durable Objects 的時間點復原功能，操作前應確認要復原的物件與時間。

## 功能與保護

管理員後台的「學生共用密碼」區塊可選擇「自行設定密碼」或隨機產生。自行設定需輸入並確認 8 至 128 字元的密碼，不可使用任一組長學號。儲存後全體學生使用同一組新密碼，現有學生登入失效；成功畫面可立即複製，關閉後無法讀回原文。資料庫僅保存 scrypt 雜湊，操作紀錄記錄「設定共用密碼」，不記錄密碼內容。原有隨機產生與停用功能保留。

前端保留管理員 `/admin`、抽籤人員 `/stage`、學生查詢 `/`、公開結果 `/results`、工作人員紀錄 `/audit` 和工作人員帳號管理 `/accounts`。保留 Excel 匯入匯出、場次與評審設定、利益迴避、各組容量、抽籤試跑、分領域抽籤、重設、公開榜單、資料版本衝突檢查。工作人員 API 依角色授權；公開結果只輸出抽籤編號、場次、專題名稱、組長姓名。學生查詢不論使用共用或個別密碼，皆只回傳自己的遮罩學號、專題名稱與抽籤狀態；抽籤完成後才提供領域、抽籤編號與報告場次，不回傳抽籤時間、評審名單、完整學號、名冊或密碼。

名冊最多 2000 筆，領域最多 100 筆，組數最多 50。Workers 每次最多設定 100 組個別學生密碼，共用密碼只驗證一次雜湊並短期合併同時請求。密碼使用現有 scrypt-v1 格式（N=32768、r=8、p=3），不需重設既有密碼。預設仍在本地驗證，Workers 預設每 isolate 一個雜湊工作；可選的分散模式才會使用四個獨立服務，同時適用學生與工作人員登入。新增／重設密碼仍在 API 本地計算；`PASSWORD_HASH_CONCURRENCY` 只控制本地雜湊。須在正式環境測試 CPU／記憶體與費用。

資料庫物件只接受私有 binding 的固定操作，外部 URL 不能執行 SQL、讀取帳號雜湊或直接呼叫資料庫。帳號權限在資料寫入與 Session 建立時再次核對。帳號變更、資料搬移、成功登入／登出、共用密碼操作、正式抽籤與重設有交易內操作紀錄。日誌不輸出密碼、Cookie 或資料庫錯誤細節。

一般 API 讀取期限 15 秒、學生查詢 30 秒、工作人員登入 45 秒、學生登入 180 秒、寫入 60 秒。取消／逾時可能發生在後端已提交之後，抽籤、匯入、登入及寫入不會因網路失敗自動重送；先重新載入確認再決定是否重試。

學生登入每個程序／isolate 最多同時執行 16 筆、等待 1024 筆，最長等待 120 秒；Session 資料庫工作最多同時執行 16 筆、等待 1024 筆，最長等待 10 秒。這是尖峰緩衝上限，並不代表能在期限內完成千人登入。學生登入只有在後端明確回覆「尚未進入登入處理」的 503（`loginRetrySafe: true`）時，前端才會依 Retry-After 加上隨機延遲，最多重送兩次，且仍受原本 180 秒總期限限制。進入登入處理後的失敗及不確定是否提交的網路錯誤不會自動重送。

## 千人負載驗證

```sh
npm run test:load -- --users=1000 --mode=shared
npm run test:load -- --users=1000 --mode=individual
```

工具會建立暫存 SQLite 與合成名冊，在本機送出 1000 筆登入，接著對成功的 Session 同時查詢，逐筆核對回傳的專題。結束後刪除暫存資料；不讀取 `.env`、不連正式網站、不修改現有資料。輸出成功數、HTTP 狀態分布與 p50／p95／p99 等待時間；失敗時 exit code 為 1。個別密碼模式每筆均執行真正的雜湊驗證；合成資料沿用相同測試密碼與雜湊，不代表正式帳號的密碼設定方式。

測試先分批建立每位使用者的 HTTP keep-alive 連線，再同時送出登入；不將本機瞬間建立 TCP 連線的 backlog 限制混入登入處理時間。測試不自動重試失敗的登入。2026-10-17 的本機結果見 `security/SQLITE_CAPACITY_1000_2026-10-17.md`。

這項測試驗證 Node 與真實 SQLite 的流程，不能當成 Cloudflare 容量證明。正式上線前，仍須在獨立的 Workers 測試部署，用合成帳號測試共用／個別密碼、同一校網 IP、登入與查詢混合負載，並同時確認管理員能抽籤。應記錄成功率、p95／p99、429／503／逾時數與平台 CPU／記憶體限制；若期限內無法完成，須再調整架構或分批入場，不能只繼續加大佇列。校網模式須由部署者確認來源限制後設定，程式不會自動啟用。

獨立驗證服務的本機比較（真實 Wrangler/workerd + scrypt；只測驗證，不含限流、資料庫及 Session）：

```sh
npm run test:password-load -- --users=1000 --pools=1
npm run test:password-load -- --users=1000 --pools=4
```

工具只啟動隔離的本機測試服務，使用合成憑證，每個物件一筆驗證，入口最多同時處理 16 筆登入。1000 筆驗證一起提交，但用戶端只使用 32 條連線，多餘工作會在用戶端等待；這是吞吐量比較，不是 1000 條同時連線測試。`--pools=1` 將四個 binding 都指向同一個測試服務；`--pools=4` 使用四個獨立 Worker。測試不會部署或產生 Cloudflare 帳單，不能用來推算正式環境的加速倍數或實際費用。部署與費用說明見 `security/PASSWORD_VERIFICATION_POOLS.md`。

## 驗證

```sh
npm run lint
npm test
npm run test:cloudflare
npm run deploy:check
```

`npm test` 包含真實本機 SQLite 的交易回復、版本衝突、憑證更新失效、持久化、公開欄位與 1201 筆查詢、清理及 HTTP 功能測試。`test:cloudflare` 啟動隔離的 Wrangler 本機環境，以真正 Durable Objects SQLite 執行登入、抽籤、重設、權限及重新啟動持久化測試，不呼叫外部資料庫或部署到帳號。只有該測試程序允許自簽的本機 HTTPS 憑證。

`deploy:check` 只確認建置及部署封裝，不會上線。原有 Supabase SQL、測試和說明保存在 `legacy/supabase/` 供回查，不參與目前執行或測試。`security/evidence/` 的舊壓測以模擬 Supabase 產生，不能當作這個 SQLite 架構的容量證明；正式使用前須再以預計學生人數進行負載測試。
