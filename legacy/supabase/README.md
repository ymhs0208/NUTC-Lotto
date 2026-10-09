# 國立臺中科技大學專題展報告抽籤系統

React + Vite 前端，Express API 統一使用 Supabase Database 與 Supabase Auth。支援 Cloudflare Workers（含 Static Assets 與 SQLite Durable Objects）及本機 Node.js。

## 啟動

1. 安裝 Node.js 22.12 以上版本與相依套件：`npm install`（或 `pnpm install`）。
2. 在 Supabase 專案的 SQL Editor 依序執行 [初始資料庫 migration](supabase/migrations/202610010001_lottery_state.sql)、[學生資安 migration](supabase/migrations/202610010002_student_security.sql)、[工作人員 session migration](supabase/migrations/202610010003_staff_sessions_and_preferences.sql)、[移除音效偏好資料表 migration](supabase/migrations/202610010004_remove_staff_preferences.sql)、[專題獨立資料列 migration](supabase/migrations/202610020001_project_rows.sql)、[學生查榜單次查詢 migration](supabase/migrations/202610020002_student_lookup.sql) 與 [學生登入交易 migration](supabase/migrations/202610030001_student_login_finalize.sql)。已有資料庫請依序執行尚未套用的 migration；第二份會移除所有舊明文學生密碼，之後須重新設定。
3. 複製 `.env.example` 為 `.env.local`，填入：

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   PORT=3000
   ```

   亦支援舊版 `SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`。Secret / service role key 僅供伺服器使用，不能使用 `VITE_` 前綴，也不要提交至版本控制。[Supabase 官方金鑰說明](https://supabase.com/docs/guides/getting-started/api-keys)

4. 在 Supabase Authentication → Users 建立並確認管理員與抽籤人員的 Email 帳號。將下列 SQL 的 Email 改為實際帳號後執行；權限存於 `app_metadata`，使用者不能自行更改：

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'admin@example.edu.tw';

   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"stage"}'::jsonb
   where email = 'stage@example.edu.tw';
   ```

5. 執行 `npm run dev`，開啟 `http://localhost:3000`。管理員使用 `/admin`，抽籤人員使用 `/stage`。登入使用上述 Email 與密碼，舊示範帳密已移除。

## 資料與權限

- 免登入結果頁可直接開啟 `/results`。選擇領域後可切換卡片或表格顯示已抽籤專題的抽籤編號、報告場次、專題名稱與組長姓名，顯示方式會記住在目前瀏覽器，切換時沿用已載入結果，不會重新查詢。按「更新結果」取得最新資料；未抽籤專題不公開。公開 API `/api/public/results?field=領域名稱` 只回傳領域選單與上述四個結果欄位。
- 公開結果直接從 `ntcust_projects` 依領域篩選已抽籤專題，僅讀取四個公開結果欄位，並由資料庫依場次與報告順序排列；分批讀取可涵蓋完整 2000 筆名冊。後端結果快取 5 秒並合併同時請求，每次查詢先確認資料庫版本號；跨伺服器的資料變更也會切換快取版本，本機成功儲存後立即清除快取。前端暫存各領域結果，切回領域與手動更新時保留卡片並提示更新中，取得新版本後清除其他舊領域快取。
- 在 Supabase SQL Editor 套用 `supabase/migrations/202610070001_public_results_index.sql`（需先完成 project_rows migration），為公開結果的領域篩選與場次／順序／ID 排序加入部分索引；只涵蓋已抽籤且編號非空的專題。SQL 可重複執行，不修改名冊或權限。推送與部署不會自動執行 SQL。
- 再套用 `supabase/migrations/202610070002_public_results_snapshot.sql`，公開查詢以一次 RPC 取得一致版本、領域設定及四個公開結果欄位；快取命中時仍用一次 RPC 確認版本，但不重新讀取結果列，跨伺服器修改可立即辨識。只有缺少 RPC（PGRST202）才回退原本查詢。函式僅授權 service_role，推送不會自動套用 SQL。
- 公開結果頁採獨立程式區塊載入；卡片與表格每次先顯示 50 件，再按「載入更多」增加 50 件。切換領域後從前 50 件開始；更新與卡片／表格切換保留目前顯示件數，不增加額外資料庫請求。
- 組長姓名可在後台新增／編輯專題時填寫，或用 Excel 的「組長姓名」（亦接受「組長名」）欄位匯入；匯出會保留姓名。舊名冊可不填此欄，公開頁顯示「尚未提供」。
- Excel 名冊可用「分組場次」「場次」「報告場次」或「組別」欄匯入場次，接受 1 至 50、`第1場次`、`第一場次` 等格式。空白或待分配文字視為未提供；無效值與互相矛盾的場次欄會提示列號並拒絕匯入。結果匯出的「場次」欄可重新匯入。更新既有學號的場次須使用覆蓋模式；追加模式只新增未存在的學號。
- 抽籤結果僅使用場次與抽籤編號，不儲存組內順序；展示依場次及抽籤編號的數字順序排列。只有場次而沒有抽籤編號仍視為不完整。完整名冊的抽籤編號不得重複，包含跨領域、跨場次，以及追加匯入與既有結果撞號；大小寫、首尾空白與等值數字格式（例如 A1／A01）視為同一編號。Excel 匯入與後端儲存使用相同檢查，拒絕時不變動名冊、結果或資料版本；舊 Excel 的組內順序欄會被忽略。資料庫請套用 `202610080001_remove_draw_order.sql` 清除舊欄位並更新公開查詢索引與函式。

- 專題已有場次、抽籤編號或抽籤時間時，須先在抽籤現場重設原領域，才可修改專題領域；直接編輯及 Excel 覆蓋匯入皆適用，後端以專題 ID 與組長學號核對原資料，不能在同一份名冊寫入中清除結果並換領域。未抽籤或已重設的專題可直接換領域。名冊儲存會核對所有場次不超過該領域設定組數，並依目前領域與場次同步評審；未分配場次不保留評審。拒絕時不變動名冊、密碼、領域設定或資料版本。

- 刪除領域前，前端與後端會確認該領域沒有抽籤結果。已有結果時必須先重設該領域再刪除；後端拒絕時不修改名冊、設定或版本。重設後刪除，專題依原規則移入剩餘第一個領域並保持未抽籤。

- 評審名單的組別只能使用 1 至設定組數的標準整數，例如 2 組只能設定 `1`、`2`，不接受 `01` 或第 3 組。編輯領域縮減組數時，前端僅保留仍存在組別的評審名單；後端再次驗證，無效設定整筆拒絕儲存。

- 頁面顯示錯誤、更新後模組載入失敗，以及入口檔案載入失敗或超過 15 秒未完成時，會顯示中文提示與「重新載入頁面」。重新載入由使用者手動操作，不會自動重送抽籤、匯入或儲存；尚未送出的編輯會清除。正式 Node 與 Workers 的 HTML 使用 `no-cache` 重新確認版本，版本化資源保留長期快取；遺失的 `/assets/` 檔案回傳 404，避免誤回傳 HTML。

- Excel 匯出依「編號（抽籤後）」排列：A01、A02、A03…B01、B02、B03…，支援自訂 A–Z 代碼。流水號按數值排序（A99 在 A100 前），未抽籤專題集中於最後，再依原始編號與序號排序；匯出不改動名冊或抽籤結果。

- 管理後台「專題展領域、分組數與評審委員設定」固定依領域代碼 A–Z 排列，不提供手動顯示順序。可在「編輯」修改對應字母，儲存後領域選單、抽籤現場及輪播同步依新代碼排序。

- 原始「編號」同樣使用 A～G 領域字母＋至少兩位數字，例如 A01、A02、B01。既有名冊載入時會套用此格式，下次成功儲存時寫回資料庫；匯入與手動新增也由後端統一編號。已符合格式且不重複的編號會保留，新增資料取得未使用流水號；變更領域時改用新領域字母。此編號與抽籤順序分開，不會因抽籤、重設而重編。自訂領域保留原始編號。

- 新抽籤編號使用「領域字母＋至少兩位數字」：A 企業智慧化、B 數位內容與多媒體應用、C 網路應用與資通安全、D 嵌入式系統與行動計算、E 智慧運算創新應用、F 智慧流通應用與研究、G 進修部。例如 A01、A02；同領域跨組連續編號，各組報告順序仍各自從 1 開始。超過 99 件時繼續為 A100，不截斷。自訂領域沿用原編號格式；已儲存結果不會自動改號，需重設後重新抽籤。
- 縮減分組數時，後端會拒絕移除仍有抽籤結果的組別，提示先重設該領域；拒絕時設定、結果與資料版本均不變。增加組數或只移除空組可直接儲存，不會重新抽籤。
- 在領域的「編輯」視窗勾選「直接指定每組件數」，可逐組填寫專題件數，例如第 1 組 10 件、第 2 組 12 件；0 件表示不分配。設定可先儲存，抽籤時各組件數合計須等於該領域名冊件數。指定件數採容量配對，會重新安排先前分配以滿足合法方案；若件數與指導老師迴避無法同時滿足，拒絕整次抽籤並保留原資料。各組編號仍隨機分配，A–G 編號規則不變。取消勾選沿用原本自動分組；已抽結果若不符合新件數，須先重設該領域。
- 管理後台的「測試抽籤」會先開啟視窗，選擇全校或單一領域後，按「開始測試」才使用已儲存名冊與設定試跑一次，列出各組實際／指定件數、容量無解、利益衝突、重複編號與評審未設定提醒，並展開試跑結果。僅 admin 可呼叫測試 API；已有正式結果仍可測試，不會寫入資料庫、變動資料版本或覆蓋正式結果。單次試跑不是所有隨機分配的保證；正式抽籤會重新產生結果。
- 評審名單中的姓名不可空白或只有「教授」「老師」等職稱；儲存時會提示領域與組別。利益迴避比對會忽略正規化後為空的姓名，避免既有無效姓名造成誤判；空評審名單仍可保留待設定。

- 每件專題以 JSONB 獨立儲存於 `ntcust_projects`，保留 `assigned_group`、`evaluators` 等欄位；`ntcust_lottery_state` 儲存領域、評審設定與資料版本。整份名冊取代時，刪除與清空也會同步生效。
- 每次修改以 `version` 比對更新，名冊與設定在同一個資料庫操作提交。其他裝置已更新時回傳 HTTP 409，請重新載入後再操作。
- 匿名 `/api/health` 只回 status，使用小型 HEAD 查詢與 2 秒後端快取；每 IP 每分鐘最多 120 次，全站 3600 次。Workers 使用共享 Durable Object 計數，Node 單行程使用有上限的記憶體計數。超限回 429 與 Retry-After。
- 登入 JSON 上限 4 KB，其他小操作 64 KB。名冊寫入先驗證管理員才解析最多 5 MB，另限制文字欄位、領域與評審數量。學生登入每個行程／isolate 最多 16 件執行、768 件等待，等待最多 120 秒；工作人員為 2 件執行、8 件等待、3 秒，兩者獨立。限流先於入隊，查榜不進登入隊列。
- scrypt 在 Node 同一行程預設同時執行 8 件，Workers 同一 isolate 預設仍為 1 件；最多等待 32 件／15 秒，涵蓋學生登入、個別密碼更新與共用密碼產生。密碼強度與隨機 salt 不變。可用 `PASSWORD_HASH_CONCURRENCY` 調整（Node 1–8、Workers 1–2），第一次雜湊才讀取設定，以支援 dotenv／Worker bindings；更改需重啟。Workers 增至 2 前需確認記憶體與 CPU；Node 預設適用於本次規劃的學校 12 核心伺服器，其他主機應依實際資源調低並壓測。增加設定值不保證加速。所有 ApiBackend 在同一 isolate 共享有上限的雜湊 executor。滿載或等待逾時回 503 與 Retry-After: 2。Supabase 請求設 5 秒期限；匿名快取刷新也有總共 5 秒期限，不會快取失敗回應。
- 學生個別查榜不快取，仍直接讀取自己的專題。這些程式界限不能取代 Cloudflare WAF 或正式容量測試。
- 校網限定模式：設定後端 `CAMPUS_NETWORK_ONLY=true` 後，學生登入取消每 IP 額度；學生 session 查詢取消每 IP 額度，保留每 token 600 次／分鐘、學生與工作人員共用全站 12000 次／分鐘。帳號計算挑戰、工作人員限制、健康檢查限制、密碼驗證與資料庫並行／排隊上限維持原設定。只有字串 `true` 啟用，未設定維持以下預設。此開關不會限制校外存取，須先在防火牆／反向代理限制網站、API 及所有後端入口；Workers 須涵蓋自訂網域、workers.dev 與預覽網址，或停用額外公開入口。Node 設定於 `.env` 並重啟；Workers 設定同名環境變數並部署。校網模式仍須在實際主機測試容量。
- 登入額度（預設模式）：學生來源 IP 1200 次／15 分鐘，工作人員來源 IP 100 次／15 分鐘；成功與失敗皆計入。帳號跨 IP 共用 10 次／15 分鐘的免計算驗證額度，達門檻後不硬鎖帳號，改回傳密碼驗證前的計算挑戰。瀏覽器在原請求期限內自動完成 SHA-256 16 個前導零位元驗證並送出一次，不新增等候提示；一般 429、網路失敗與資料寫入不會因此重送。計算挑戰提高不同密碼嘗試的成本，並非 CAPTCHA 或多因素驗證，也不能取代 WAF。
- 挑戰有效期 2 分鐘，以伺服器金鑰簽署並綁定帳號、來源 IP、登入類別與本次密碼；不回傳或保存明文密碼。換密碼、帳號、IP、類別或金鑰均不可沿用。相同證明僅可重送相同憑證，仍受 IP 額度及登入／雜湊排隊限制。需要支援 Web Crypto 的瀏覽器及 HTTPS（本機 localhost 例外）。
- Node 登入額度在同步檢查後一起更新；Workers 使用每個登入類別一個共享 Durable Object 交易，一起檢查與更新 IP／帳號桶，IP 拒絕或尚未完成挑戰時都不扣任何額度。Workers 同類別使用共同 15 分鐘計數區間，重啟仍保留；Node 使用每個桶自第一次請求起的區間，程序重啟清零。兩者最多保留 10000 個桶。部署新版 Workers 時使用 `login-budgets-v2` 計數命名空間，舊登入額度不搬移，首次部署會重新計數；session 額度不變。
- 登入限流固定以實際認證帳號計數：工作人員使用 Email、學生使用組長學號。額外欄位不能改變限流帳號；同帳號大小寫與前後空白統一，跨 IP 仍共用帳號次數。無效帳號在建立限流桶前拒絕。
- RLS 與資料表權限禁止瀏覽器直接存取，由 API 查驗後端 session 與 Supabase Auth 身分後讀寫。`admin` 可修改名冊與設定；`stage` 可抽籤及重設。
- 完整名冊與領域設定 API 僅限已登入的 admin / stage。公開結果 API 已移除，不提供匿名全校結果查詢。
- 學生頁不預先下載名冊。登入後透過 HttpOnly、SameSite=Strict cookie 查詢 `/api/student/me`，後端 session 綁定唯一專題 ID，不接受前端選擇其他專題。學生回應僅回傳遮罩後的組長學號（末四碼），不回傳完整學號，不提供名冊序號、班級、學制、系所或指導老師；學生頁只在登入狀態列顯示遮罩學號，登入成功後清除學號及密碼輸入。正式環境 cookie 設為 Secure，必須使用 HTTPS。
- 學生密碼使用 scrypt（N=32768、r=8、p=3）及每筆隨機 salt 保存雜湊；API 不回傳密碼或雜湊，管理員只能設定／重設密碼與查看設定狀態。新密碼須為 8 至 128 字元，不可使用學號。留空不建立預設密碼：既有帳號保留其雜湊，新帳號須由管理員設定密碼後才能登入；變更學號時也需重新設定密碼。
- 管理後台可按「產生全體共用密碼」一次產生 8 碼隨機英數密碼（避開易混淆字母），所有學生使用自己的組長學號及同一組密碼登入。密碼只顯示一次，資料庫僅保存雜湊；重新產生會使舊密碼及登入 session 失效。新增或匯入的專題會自動沿用共用密碼。共用密碼模式下顯示目前登入的組長學號、專題名稱及抽籤結果，不顯示班級、指導老師或評審；知道其他組長學號的人也能查詢該組專題名稱與抽籤結果。停用共用密碼後，所有學生須重新設定個別密碼才能登入。
- **所有舊明文密碼視為已暴露並停用**，即使未執行第二份 migration，後端也不再接受它們。執行 migration 後，管理員在專題編輯畫面重新設定並私下提供新密碼。歷史 JSON／Excel 備份仍需由管理員妥善控管，不要提交至版本控制。
- 學生 session 期限為一小時，資料庫僅保存 token 的 SHA-256；重設密碼或刪除專題會使相關 session 無效。學生登出先確認後端 session 刪除成功，再移除 cookie；刪除失敗時回傳中文錯誤並保留 cookie 供重試。可用 privileged 排程定期清除 `ntcust_student_sessions` 的過期資料列。
- 登入每帳號最多 10 次／15 分鐘；工作人員每 IP 100 次、學生每 IP 1200 次／15 分鐘，跨站 JSON 操作會被拒絕。Cloudflare 使用 Durable Object 原子計數，跨地區／重啟共用相同限制，僅保存帳號與 IP 的雜湊索引及短期計數；本機 Node.js 使用行程內限流。
- Excel 套件固定使用官方來源 `xlsx@0.20.3`，鎖定檔保存完整性；匯入上限 5 MB／2000 筆。匯入自動新增領域後，連同既有空領域的總數最多 100 個；同名領域僅計算一次。與領域設定使用同一驗證，超限時在處理密碼與儲存前整批拒絕，保留原有名冊、設定及資料版本。密碼欄位可留空，後續於後台設定；有填密碼時須符合新規則，匯出結果不包含憑證。
- 跨裝置寫入使用資料庫版本比對；兩個裝置以同一版本儲存時，只有第一筆成功，另一筆收到 409，須重新載入後再操作。前端版本號與畫面資料一起更新；若載入新版時有開啟中的舊草稿，會保留其輸入供複製但禁止儲存。Excel「完全覆蓋」會替換名冊；已有抽籤結果時須另外勾選確認。相同組長學號的匯入專題會保留原專題 ID，以維持未重設的學生密碼。
- 管理員／展演人員的登入 session 與 Supabase access token 存在 `ntcust_staff_sessions`，不再回傳 token 或寫入 localStorage／sessionStorage。瀏覽器只持有 HttpOnly 隨機 cookie；每次操作均查驗後端 session、到期時間與 Supabase 身分。登出刪除 session，舊 cookie 立即失效。勾選「記住我」只決定 cookie 是否保留至 token 到期，不延長登入期限。
- 音效播放與音效開關已移除；抽籤動畫保留。未提交表單、搜尋／篩選、彈窗、載入狀態與動畫仍留在前端。第四份 migration 會移除第三份曾建立的音效偏好資料表；保留既有 migration 以支援已部署的資料庫。
- 所有正式業務資料、學生與工作人員 session均由 Supabase 保存；前端記憶體僅供畫面顯示。後端重啟不會遺失已提交資料，沒有本機資料庫備援。可定期清除 session 表的過期資料列。
- 資料連線或儲存失敗會顯示錯誤，不會改用本機 JSON、localStorage 或前端計算抽籤結果。學生按「重新整理」取得最新資料。
- 初始名冊為空，可由管理員匯入 Excel。未設定連線資訊時 API 回傳 503，不會自動建立示範資料。

## 專題資料列與既有資料庫升級

- 名冊改存於 `ntcust_projects`，每件專題一列；`document` 保存該專題全部欄位，`position` 保留名冊順序。`id` 為主鍵，正規化的組長學號 `leader_key` 有唯一索引，查榜不必讀取其他專題。
- 學生登入依組長學號查詢一列；登入後依 session 的專題 ID 查詢一列。密碼雜湊、共用密碼顯示限制與密碼重設後的 session 失效規則保持一致。
- 管理、匯入、抽籤、重設與匯出仍需完整名冊。讀取 RPC 提供一致的名冊／設定／版本快照；儲存 RPC 鎖定版本，在同一交易內更新有變動的專題、刪除移出的專題、保存設定並遞增版本。失敗全部回復，過期版本回傳 409。
- 資料表啟用 RLS，匿名與一般登入角色沒有存取權限；後端角色只能讀取專題，寫入必須經過受限的儲存 RPC，避免繞過版本檢查。現有名冊上限仍為 2000 筆。

已有資料的升級順序：

1. 備份 Supabase 資料庫，確認前四份 migration 已套用。
2. 先部署新版 API；第五份 migration 尚未套用時，新版暫時沿用舊 JSON 儲存方式，網站仍可使用，但尚無單筆查詢效益。
3. 確認新版部署完成，暫停管理員匯入、抽籤等寫入操作，在 Supabase SQL Editor 執行 [專題資料列 migration](supabase/migrations/202610020001_project_rows.sql)。SQL 會將原名冊完整移入專題資料表、保留 ID／順序／抽籤結果／密碼雜湊與版本，再移除原名冊欄位。若 ID 或正規化學號重複、共用密碼不一致，整個交易失敗，原資料保留，請先修正資料再重試。
4. 確認 SQL 成功後，檢查 `/api/health`、管理名冊與學生查榜。正常查榜只查 `ntcust_projects` 的一列；相容流程僅在 schema 尚不存在時啟用，不會掩蓋斷線或權限錯誤。

第五份 migration 只需執行一次。套用後不要回退到仍直接寫入舊 `projects` 欄位的 API；回退新版程式需搭配備份還原或另外準備反向遷移。本機測試已驗證 SQL，正式 Supabase 的遷移仍須另外執行，推送程式不會自動修改資料庫。

學生查榜加速：先部署新版程式，再於 Supabase SQL Editor 執行第六份 [學生查榜單次查詢 migration](supabase/migrations/202610020002_student_lookup.sql)。需先完成第五份 migration；此 SQL 不變更名冊、密碼或既有登入 session。套用後 `/api/student/me` 一次 RPC 同時讀取有效 session 與自己的專題，後端仍檢查密碼指紋；函式僅開放 service_role。未套用時僅在 RPC 缺少（PGRST202）時回退既有索引查詢，其他資料庫錯誤直接回 503。推送不會自動執行 SQL。

## 舊資料移轉

保留原始 `data/server-db.json` 作為備份。完成建表與環境設定後，在尚未操作過的空白 Supabase 資料庫執行：

```sh
npm run migrate:local
# 或指定其他備份檔
npm run migrate:local -- /absolute/path/server-db.json
```

移轉工具會保留專題與領域設定、移除舊明文密碼，並拒絕覆蓋已使用的資料庫。舊瀏覽器 localStorage 快取不會自動上傳。

## 驗證與部署

```sh
npm run lint
npm run test
npm run build
NODE_ENV=production npm start
```

`npm start` 與 `npm run dev` 透過 `scripts/start-server.mjs` 啟動 Node，在子行程啟動前設定 `UV_THREADPOOL_SIZE`（預設 8）。設定讀取順序為啟動環境、`.env.local`、`.env`，既有設定優先；兩個環境檔仍由伺服器正常讀取。可在環境檔設定 `PASSWORD_HASH_CONCURRENCY`（Node 1–8）及 `UV_THREADPOOL_SIZE` 以調整，修改後需重啟。若既有環境檔寫有 `PASSWORD_HASH_CONCURRENCY=4`，會繼續使用 4；請改為 8 或移除該項才會使用新預設。直接執行 `tsx server.ts` 不經此啟動器，必須自行在啟動前設定執行緒池。

學校伺服器請先以單一 Node 行程、密碼驗證並行 8／執行緒池 8 測試；不要直接將並行數設為 24。以學校網路同一出口 IP 測試 500 個不同帳號登入與同步查詢，確認成功率、P95 延遲、CPU 及 Supabase 延遲後再上線。

### Cloudflare Workers 部署

目前部署網址：[學生查榜首頁](https://nutc.cc.cd/)、[管理後台](https://nutc.cc.cd/admin)、[台上抽籤](https://nutc.cc.cd/stage)。備用網域：`special-exhibition-lottery.ymhs0208.workers.dev`。

首頁固定使用 `/`，管理後台使用 `/admin`，台上抽籤使用 `/stage`，不再附加重複的 `#/...`。舊 `/student`、`/manage`、`/lottery`、`/inquiry`、`?view=...` 與角色 hash 網址會整理為對應路徑；明確頁面路徑優先於 query/hash。其他查詢參數與 `#main-content` 等內容錨點保留，瀏覽器上一頁／下一頁會同步畫面與標題。點擊頁首標誌可返回首頁。

使用 Workers，並在 Workers & Pages 建立 Worker、連接本 GitHub 儲存庫。不要選擇只部署 `dist` 的純靜態 Pages。

- 儲存庫：`ymhs0208/Special-Exhibition-Lottery`，分支：`main`，根目錄：`/`。
- 建置命令：`npm run build`；部署命令：`npx wrangler deploy`。
- 使用 Bun 的 Workers Builds 可保留建置命令 `bun run build`。`bun.lock` 採用 Bun 1.2.15 可讀取的版本 1 格式，套件版本與完整性保持鎖定；更新依賴時須確認 `bun install --frozen-lockfile` 可在建置環境使用的 Bun 版本通過，避免產生舊版 Bun 無法解析的鎖定檔。
- 在 Worker 的 Settings → Variables and Secrets 設定 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`；`SUPABASE_SECRET_KEY` 必須選 **Secret**。這些是執行階段設定，不只是在 Builds 裡的建置變數。
- `wrangler.jsonc` 配置 API、前端 SPA 路由、自訂網域與 Durable Object migration；不含任何實際金鑰。`keep_vars` 保留 Dashboard 中已設定的執行階段變數，避免後續部署移除連線設定。`/api/*` 優先執行後端，即使直接從網址列開啟也不會回傳前端 HTML。
- 管理員與學生 cookie 在 Workers 正式環境一律使用 Secure / HttpOnly / SameSite=Strict；前端與 API 共用網域，不需開放跨站 CORS。

本機 CLI 部署：

```sh
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
npm run deploy
```

若使用私人的 `.env.local` 一次上傳三個執行階段設定，可用 `npm run build` 後執行 `npx wrangler deploy --secrets-file .env.local`；該檔案不得提交 Git。線上不需要 `PORT`。

API 在 `ApiBackend` Durable Object 執行，提供密碼雜湊所需的 CPU 時間；正式名冊、登入 session 與抽籤結果仍保存於 Supabase。`LoginLimiter` Durable Object 只保存短期限流計數。SQLite Durable Objects 支援 Workers Free；請留意實際用量配額。參考 [Workers CPU 限制](https://developers.cloudflare.com/workers/platform/limits/) 與 [Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)。

Cloudflare 單次最多設定 100 組學生密碼，請分批設定；不設定新密碼的名冊仍可匯入 2000 筆。後端逐筆雜湊並限制同一 API shard 的並行操作，避免記憶體與執行時間超額。已有雜湊可留空保留。

部署後檢查 `https://你的網域/api/health` 應回傳 `status: ok`，此檢查包含業務資料表與兩種登入 session 資料表。若回傳 503，確認 Supabase URL、Secret key 及 SQL migrations／資料表權限；Secret key 不可誤填 Publishable key。

### 本機 Workers 驗證

```sh
npm run build
npm run test:cloudflare
npm run deploy:check
npm run dev:cloudflare
```

`test:cloudflare` 使用真正的 workerd 引擎與模擬 Supabase，驗證前端路由、API 權限、scrypt 雜湊、cookie、抽籤、資料庫版本衝突、登入限流及 Workers 重啟；不會寫入正式 Supabase。

一般 Node.js 部署仍可用 `NODE_ENV=production npm start`。`vite preview` 僅供靜態預覽，不提供 API。

學生共用密碼驗證：同一 process／isolate 內，相同共用密碼與目前儲存 hash 的請求合併驗證，成功結果快取 30 秒，最多保留 32 個項目。快取鍵為程序隨機 key 的 HMAC，不儲存明文密碼；錯誤密碼與服務錯誤不保留。個別密碼及不存在的帳號維持原驗證流程。共用密碼更換／停用後清除本地快取，其他 shards 透過每次讀取的最新 hash 隔離舊快取；建立 Session 時由登入 RPC 在同一交易內核對最新密碼版本（未套新 SQL 時仍另查核）。每位學生仍獨立查核學號、建立 Session，登入限流與排隊上限不變。此最佳化不代表已通過正式環境 300 人同時登入壓測。

Session 負載防護（S09）：學生與工作人員 Cookie 使用綁定用途的 HMAC 簽章，簽章 key 從後端 `SUPABASE_SECRET_KEY`（或 `SUPABASE_SERVICE_ROLE_KEY`）以獨立標記派生，不需新增環境變數。假簽章、舊版無簽章 Cookie 不會查詢或刪除資料庫 session；上線後既有使用者需重新登入，輪替後端 secret 也會使既有 Cookie 失效。所有 Node instances／Workers shards 應使用相同後端 key；簽章有效仍需驗證資料庫到期、密碼版本與角色，不能代替權限驗證。

需要驗證 session 的 API 在資料庫存取前限流：每個 token 每分鐘 600 次、學生 session 的 IP 每分鐘 6000 次、工作人員 session 的 IP 每分鐘 3000 次、學生與工作人員合計全站每分鐘 12000 次，超出回 429 與 Retry-After。IP 額度保留校園多人共用出口的空間；反向代理環境仍需確認實際來源 IP，不能盲目信任任意 X-Forwarded-For。Node 計數為 process-local，Workers 計數透過既有 LOGIN_LIMITER 共享；Node 多程序部署需另外共用限流儲存。Session 查詢／建立／刪除在同一 process／isolate 共享最多 16 件並行、512 件等待，等待超過 10 秒或佇列滿載回 503 與 Retry-After；並行界限不是跨所有雲端 isolates 的全域上限。

測試使用本機模擬 Supabase HTTP 服務，涵蓋工作人員 cookie／登出撤銷／重啟恢復、匿名讀取限制、學生專題存取、cookie、密碼雜湊／重設／舊密碼停用、API 權限、完整欄位儲存、刪除／清空、抽籤／重設、版本衝突、登入限流與連線失敗，另測試 Excel 匯入匯出。實際 Supabase migration 與雲端連線需填入專案資訊後驗證。

資料庫測試使用 PostgreSQL（PGlite）實際執行 migrations，驗證欄位與抽籤結果保留、主鍵／學號索引與 2000 筆資料的查詢計畫、交易失敗回復、版本衝突、刪除／清空、學號互換、角色權限，以及遷移失敗保留原資料。API 測試另驗證舊 schema 相容與 300 次同時查榜只查單筆資料。套件 advisory 查詢涵蓋鎖定及啟用版本，未回報已知漏洞；不代表所有部署層面的風險都已消除。

API 內部錯誤僅回傳固定訊息與事件 ID；5xx 不會回傳資料庫錯誤、檔案路徑或堆疊。格式錯誤 JSON 回 400，過大請求回 413。特殊領域名稱（含 `__proto__`、`constructor`）可正常參與獨立分組抽籤。

學生同一 IP 同時登入後查詢的本機負載測試可用 `pnpm benchmark:student-login --students=600 --db-delay-ms=100 --output=/tmp/lottery-login-benchmark.json`；Workers 加 `--workers`。此工具只使用合成名冊及本機模擬 Supabase，不連接正式資料庫。結果包含成功率與延遲；本機模擬結果不代表正式資料庫或部署環境的容量保證。

學生登入的等待容量調整後，300 個不同學號、同一 IP 的本機 Node／Workers API 測試在每次模擬資料庫請求延遲 30／100 ms 下，首次登入及查詢皆為 300／300。Workers 測試預先準備本機代理的內部連線；不代表正式 Supabase 或 300 人第一次載入網站的容量保證。

## 現場抽籤結果輪播

在「專題報告抽籤現場」點選「全螢幕展示」，保留預設勾選的「全螢幕展示時，抽籤完成自動輪播結果」，確認抽籤後，待後端儲存成功及小布抽籤動畫結束即自動播放。非全螢幕抽籤或儲存失敗不會自動播放。已完成的結果可從「分組與報告順序」點選「輪播結果」再次展示。

輪播依領域代碼 A–Z、場次、抽籤編號排列，可選每頁 5 件（單欄）或 10 件（左右兩欄，各 5 件；先左欄再右欄），預設 5 件（最後一頁顯示剩餘件數）；最後一頁回到第一頁。主持人可暫停、切換前後頁、跳至指定場次，或調整每頁 3／5／10／15／20／30 秒（預設 10 秒）。方向鍵切頁、空白鍵播放／暫停，Esc 或「返回抽籤」結束展示。切至其他瀏覽器分頁會暫停計時，返回後繼續；捲動名單會暫停，方便閱讀特別長的名稱。輪播僅使用已載入的結果，不會再次抽籤或持續請求資料庫。

現場的「抽籤範圍」支援勾選多個領域，提供全選與清除；件數、看板、抽籤、重設及輪播皆依勾選範圍更新。複選抽籤在一次操作中提交，任何領域配置錯誤都不儲存部分結果，未勾選領域保持原結果。至少勾選一個領域才能抽籤。

2026-10-02 登入容量擴充：每個行程／isolate 可接納 784 筆未完成登入（16 處理＋768 等待，最多等 120 秒），同 IP 學生登入額度為每 15 分鐘 1200 次。600 個不同合成學生、同 IP、共用密碼驗證快取起始為空、每次模擬資料庫延遲 100 ms 的本機測試，Node 與 Workers 均首次登入 600／600、查詢 600／600，登入 P95 分別為 11.5／13.3 秒，最慢為 12.1／13.9 秒；每位取得不同 Cookie，無跨學生資料。模擬資料庫峰值並行為 32 筆（登入學號讀取與受限 Session 工作合計），Session 工作本身仍限制為 16 筆。Workers 測試預先準備本機代理連線；不含正式資料庫 CPU／I/O、第一次載入網站或校園網路，亦非正式容量保證。600 是目前已測試的波次，不代表 784 筆必定於期限內全部成功。

### 前端請求期限與取消

前端一般 API 讀取最多等候 15 秒，學生查詢／初始 session 恢復為 30 秒；工作人員登入最多 45 秒、學生登入 180 秒，寫入最多 60 秒。學生較長期限涵蓋登入排隊與密碼驗證；查詢期限也涵蓋未安裝 lookup RPC 時的相容讀取。不代表應每次等滿或保證所有流量都成功。期限涵蓋回應標頭與 JSON 讀取，逾時會中止瀏覽器 fetch，顯示中文提示並解除操作的等待狀態。頁面元件卸載會取消其請求，新的名冊讀取取代舊讀取，學生開始登入／更新／登出時會取消舊的登入恢復；關閉抽籤試跑視窗亦取消試跑請求。主動取消不顯示斷線錯誤，取消或逾時的遲到回應不套用狀態。

只有唯讀 `GET /api/student/me` 在連線失敗（瀏覽器不是離線）或 HTTP 503 時最多重試一次，加入隨機延遲；503 遵守秒數格式的 Retry-After，超過 5 秒、日期格式或原請求剩餘期限不足時不自動重試。等待與重試共用原本的總期限，取消會清除等待，不會額外送出請求。401、一般 429、登入及所有寫入不因網路錯誤自動重試；登入 API 明確回傳密碼驗證前的計算挑戰時，才在同一期限內完成並送出一次證明。

逾時／取消只中止瀏覽器等候，**不保證伺服器尚未提交寫入**。抽籤、匯入、密碼產生、重設與儲存不會自動重送；收到寫入逾時提示後，先重新載入確認版本與結果，再決定是否重試。新登入也不會被舊請求遲到的 401 清除。一般可預期的網路錯誤與逾時不會觸發整頁錯誤畫面。

### 領域別名與抽籤編號

管理員可在新增／編輯領域的「對應字母」選擇 A–Z，每個領域須使用不同字母。原始編號與抽籤後編號皆依此設定產生，例如 H01、H02。領域別名或前四個字相同的自訂領域可指定不同字母以避免撞號。未編輯的舊設定沿用原有 A–G 對應及自訂前綴，無須資料庫結構遷移。已有抽籤結果時不能更換有效前綴，須先重設該領域；變更未抽籤領域的字母會同步更新原始編號，專題 ID 與學生登入資料不變。領域設定、名冊匯入、試跑與正式抽籤均使用同一代碼設定，儲存前仍檢查合併後全部結果的編號唯一性。

既有衝突資料不會自動合併分組、重編號或刪除。管理員須先統一領域名稱與設定；已有抽籤結果的領域仍須先重設才能刪除。


領域顯示順序固定依有效代碼 A–Z 排列，後台與現場（含領域選擇及輪播）使用同一順序；新增／編輯不再提供顯示順序欄位。舊自訂文字前綴排在字母領域後。讀取舊設定即以代碼排序，下一次儲存時同步持久化，不更動既有場次或抽籤編號。


### 過期 Session 定期清理

Cloudflare Workers 以 Cron Trigger 每 10 分鐘清理學生與工作人員的過期 Session；Node 正式環境啟動時先清理一次，之後每 10 分鐘清理，開發環境不啟動。每張 Session 表每次最多處理 5 批、每批 100 筆（共 500 筆），剩餘過期資料留待下次。以到期索引挑選過期紀錄，刪除時再次核對期限且限定選出的 token 雜湊，保留有效或已延長期限的 Session。不存取名冊、抽籤結果或帳號資料，不增加公開清理 API；沿用伺服器端資料庫權限，無須新增密鑰或 migration。

Node 定時工作不重疊，失敗後下次排程再試，不中斷網站服務。Workers 排程失敗會回報給 Cloudflare，兩者日誌僅記錄清理數量或一般錯誤，不輸出 token、Cookie 或 access token。Cron 新增／修改可能需最多 15 分鐘傳播，首次排程成功可由 Cloudflare Observability 的「Expired session cleanup completed」日誌確認；部署成功本身不等同已跑過首次清理。

## 學生首次登入 RPC

套用 `supabase/migrations/202610030001_student_login_finalize.sql` 後，共用密碼首次登入由三次資料庫請求減為兩次：依學號查單筆專題、後端驗證密碼，最後 RPC 重新核對學號／密碼 hash／共用模式，並在同一交易建立新 Session、撤銷有效簽名 Cookie 的舊 Session。回傳最新專題，成功後才設定 Cookie。個別密碼亦保留交易內版本核對；SQL 僅鎖該專題，所有學生不共用全域鎖。Session 為獨立安全亂數，資料庫僅存雜湊且自行設定一小時期限。函式只授權 service_role，anon／authenticated 禁止執行。

既有資料庫只需新增這份 migration，不需重跑或重設名冊、密碼及結果。可先套 SQL 再部署 API；API 先上線時僅在 PostgREST 回傳 PGRST202（函式不存在）使用原單筆查詢相容流程。尚未套 SQL 時不能宣稱已啟用兩次請求及交易保護；權限錯誤、服務錯誤或密碼版本不符均不降級。

2026-10-03 登入 RPC 模擬測試：300 個不同學號、同一 IP、相同共用密碼、每次資料庫請求延遲 100 ms，在 Node／Workers 皆首次登入 300／300、查詢 300／300、300 個獨立 Cookie，錯誤專題結果 0。每人登入 2 次、查詢 1 次，共 900 次請求；登入 P95 約 Node 4.22 秒、Workers 5.00 秒。本機代理連線已預熱、密碼驗證快取初始為冷；不代表正式 Supabase／校園網路的吞吐或延遲。

## 工作人員操作紀錄

管理員可從右上角帳號選單開啟「工作人員操作紀錄」獨立頁面 `/audit`。記錄工作人員成功登入、有效登入的登出、共用密碼產生／停用、正式抽籤與重設。僅管理員可讀取 `/api/staff-audit`；抽籤人員與匿名請求不可讀取。提供 Email／領域／內容搜尋、操作與角色篩選、臺灣日期範圍（預設最近 30 天，最多一年），每頁 50 筆，依遞減 ID 分頁。資料不快取，與工作人員 Session 共用既有限流。

在 Supabase SQL Editor 執行 `supabase/migrations/202610040001_staff_audit.sql`（需先套 project_rows）才會開始保存紀錄。推送與部署不會自動執行 SQL，尚未套用時頁面會明確顯示未啟用；僅函式不存在 PGRST202 時暫時保留舊操作流程並記錄後端警告，這期間沒有稽核紀錄且無法事後回補。權限、網路及其他資料庫錯誤不降級。

套用後，操作與紀錄使用同一 SQL 交易：儲存、版本衝突、登入 Session 寫入或紀錄寫入失敗時全部回復；成功才設定 Cookie／回傳結果。操作人取自後端驗證的 Auth 身分，不能由瀏覽器指定。紀錄只含 Email、角色、時間、操作、領域、件數及版本，不保存密碼、密碼雜湊、Session Token、Auth access token、金鑰或名冊。資料表啟用 RLS；anon／authenticated 無權限，service_role 僅可讀表，禁止直接新增、修改或刪除，僅受限交易函式能追加。沒有紀錄刪除 API；紀錄從功能啟用後開始累積。

操作紀錄保留三個月（臺灣時間的日曆月，不是固定 90 天）。再於 Supabase SQL Editor 執行 `supabase/migrations/202610040002_staff_audit_retention.sql`，需先套用 staff_audit。Node 正式伺服器啟動時及每 10 分鐘、Cloudflare 既有每 10 分鐘排程會清理超過期限的紀錄；恰好等於期限與更新的紀錄保留。每次最多刪除 2500 筆，超量留待下一次排程，因此期限到達後並非立即刪除。資料庫以自身時間決定期限；僅 service_role 可執行固定清理函式，仍不能直接刪除資料表。缺少此 migration 時保留紀錄並警告；清理失敗下一次重試，不阻止另一項 Session 清理。推送不會自動執行 SQL，伺服器或排程停用期間不會清理。
