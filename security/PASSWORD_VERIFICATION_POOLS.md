# 個別密碼驗證服務

**狀態：可選版本已完成；隔離 Cloudflare 測試中四服務完成 1000/1000 筆驗證，完整千人登入仍待驗收。正式網站未切換。** 一般 `npm run deploy` 繼續使用本地驗證。測試結果僅適用於密碼驗證，不代表完整登入速度或容量。

## 修改目的

可選模式將 Workers 的登入驗證運算從網站 API 移到四個獨立部署的 Worker，提供可分散執行的驗證工作池。既有 `scrypt-v1` 格式與 N=32768、r=8、p=3、32-byte 輸出全部保留；學生與工作人員不需重設密碼。個別密碼沒有新增成功快取。

流程為：API 檢查登入限流、讀取帳號 → 私有 binding 驗證密碼 → 原資料庫重新核對憑證並建立 Session。名冊、Session、限流、抽籤版本與原有交易繼續共用原資料庫／限流物件，沒有分片業務資料。

## 資源配置與失敗行為

- 四個 Worker：`nutc-lotto-password-0` 至 `nutc-lotto-password-3`，各自擁有 PasswordVerifier namespace。
- 學生與工作人員登入分別由固定 API 物件管理進場佇列；入口不執行驗證雜湊，只派送運算與建立 Session。學生最多 16 筆執行中、1024 筆等待，避免 API 分片直接把千筆驗證同時壓到四個服務；一般查詢仍維持 API 分流。
- 每個 API isolate 使用隨機起點，輪流選擇四個驗證服務，避免同一批請求集中到單一服務。每個服務固定使用一個 `password-v1` 物件，共四個物件。
- 每個物件有獨立的一筆執行中、32 筆等待、15 秒等待期限的工作池，不跨物件共用等待清單。每次私有 binding 呼叫最長 25 秒。
- 單純增加同一 Worker 的物件名稱，可能仍共用 isolate；本次使用四個獨立部署的 Worker，但仍不保證四倍加速，實際硬體與排程由平台決定。[Cloudflare 記憶體共用說明](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)
- API 密碼建立／重設仍在本地計算；Node 部署的登入驗證保持原有本地工作池。本次分散處理只用於 Workers 登入。
- 驗證服務沒有公開 URL、資料庫、帳號查詢、Session secrets 或持久化驗證資料。私有輸入限制 4 KiB，只接受固定格式雜湊與最多 128 字元密碼，未知帳號仍執行真實 scrypt；回覆只含 `valid` 布林值。
- 遺漏 binding、服務不可用、過載、逾時或無效回覆均停止登入並回傳 503；不退回 API 計算，不自動重送昂貴驗證，也不輸出憑證或平台錯誤細節。

## 封裝與部署

```sh
npm run check:distributed
```

此指令僅檢查封裝，不部署。`wrangler.jsonc` 是預設本地模式，`wrangler.distributed.jsonc` 才設定 `PASSWORD_VERIFICATION_MODE=distributed` 與四個外部 binding；不明的模式值會拒絕登入。

待獨立測試部署通過負載驗收後，`npm run deploy:distributed` 才用於切換現有網站：先依序部署四個密碼服務，再部署主站，任一步失敗即停止。該指令會使用現有 `nutc-lotto` 名稱與網站網域，並非建立測試站；本次未執行此指令。四個服務不需 secrets，須與主站部署到同一帳號；原有主站 v1／v2 migrations、`lottery-v1` 名稱不變。

本機開發請執行 `npm run dev:distributed -- --local-protocol https`，會同時啟動五個服務。一般 `npm run dev:cloudflare` 仍使用本地驗證。若需回到本地模式，可用一般 `npm run deploy` 部署；不需變更學生密碼或刪除資料庫。

## 費用與正式驗收

本機測試與 dry-run 不會部署或產生 Cloudflare 執行費用。本次另執行了隔離的 Cloudflare 測試，會產生測試用量；未讀取帳號的計費方案與帳單明細，不能提供實際帳單金額。

依 2026-10-17 查閱的 [Cloudflare Durable Objects 定價](https://developers.cloudflare.com/durable-objects/platform/pricing/)，Paid 方案包含額度用完後，請求單價為每百萬次 US$0.15，執行時間每百萬 GB-s US$12.50；實際計費另受方案、包含額度與計費單位影響。每個 DO 的 duration 依配置的 128 MB 計費，即使多個物件實際共用 isolate。四個服務不是固定四台伺服器的月租；須以實際活躍時間評估費用。

每個實際執行的登入驗證新增一次驗證 DO 請求；錯誤密碼與未知帳號也計算。正式測試時應加總四個服務的請求數與計費 duration，並連同 API、限流和資料庫的既有用量評估總費用。驗證服務不呼叫 storage API。

正式驗收應使用獨立測試部署與合成帳號，分別測 1000 人登入、登入後查詢、混合管理員抽籤、同一校網 IP，以及錯誤密碼流量。記錄成功率、p95／p99、429／503／逾時、各服務 CPU／記憶體超限及計費 duration，再決定是否擴增服務。開發機本機結果不能當成正式環境的加速倍數或容量保證。

## 驗證指令

```sh
npm run lint
npm test
npm run test:cloudflare
npm run test:password-load -- --users=1000 --pools=1
npm run test:password-load -- --users=1000 --pools=4
```

後兩個指令只測本機 Wrangler/workerd 的驗證流程。1000 筆工作一起提交，用戶端最多使用 32 條連線，API 入口最多執行 16 筆，其餘在用戶端或 API 等候；不包含資料庫、限流及完整 Session 流程。合成憑證每次都執行真實 scrypt。可加 `--output=檔案路徑` 儲存結果；失敗時 exit code 為 1。

## 本機結果與未解決事項

2026-10-17，單物件／四服務版本共 1000 筆驗證，960 筆成功、40 筆 HTTP 500（Wrangler ProxyWorker 訊息為 Network connection lost），總耗時 109213 ms，包含用戶端等待的 p95 為 105687 ms。原始結果在 `evidence/password-pools-local-4.json`。這輪**未通過**，不能認定登入速度或可靠性已有改善，也不能把原因完全歸於開發代理。

早期每服務多物件版本也未通過：單服務 982/1000、四服務 839/1000，記錄保留於 `evidence/password-pools-local-1-multi-object.json` 與 `evidence/password-pools-local-4-multi-object.json`。這些原型與最終單物件版本不同，不宜比較加速倍數。

型別、功能、Workers 整合與封裝測試可確認相容性及固定操作流程，但無法代替完整登入負載驗收。本機代理錯誤根因仍未完全辨識；預設模式維持本地驗證。

## 隔離 Cloudflare 實測

2026-10-17 建立四個暫時的私有驗證 Worker 與一個金鑰保護的測試入口，使用合成密碼與雜湊，未綁定正式名冊或 Session 資料庫。入口拒絕未授權請求。每批送出 1000 筆工作，用戶端最多 32 筆進行中，API 入口最多 16 筆，沒有自動重試。

| 服務數 | HTTP 200 且驗證成功 | 其他狀態 | 整批耗時 | 單次 HTTP p95 | 含用戶端等待的完成 p95 |
| --- | --- | --- | --- | --- | --- |
| 1 | 990/1000 | 10 筆 HTTP 403 | 280268 ms | 9947 ms | 268478 ms |
| 4 | 1000/1000 | 無 | 88888 ms | 6059 ms | 84787 ms |

四服務版本在這次測試中更快且完成全部工作；單服務基準有 10 筆 403，根因尚未辨識，故不視為嚴格等條件的加速倍數保證。這是單次測量，不是長期 SLO，也不是完整千人登入：沒有資料庫、Session、共用限流、管理員抽籤或千條同時連線。原始結果與五個臨時服務全部刪除的紀錄在 `evidence/password-pools-cloud.json`。整支比較指令因單服務基準未全部成功，exit code 為 1，並未將此失敗隱藏。

若將驗證工作依相同方式分散，預期可降低原先驗證瓶頸；正式啟用前仍需以完整登入、同校網出口與混合查詢驗收。實際 CPU、記憶體與計費 duration 未從帳單或平台遙測彙總，本報告不宣稱特定費用或資源使用量。

最終驗證：型別檢查通過，138 項測試通過；分散模式的 Workers 本機登入／權限／抽籤／持久化整合測試通過（Node 專用搬移案例跳過）；一般與分散模式的正式建置及 dry-run 均通過。

需要再執行雲端驗證比較時：

```sh
npm run test:password-cloud -- --run --users=1000 --output=security/evidence/password-pools-cloud.json
```

此命令會建立新的 Cloudflare 服務並產生用量，需要已有 Wrangler 登入；使用隨機命名與金鑰，不連正式資料庫，結束後刪除本次建立的服務。不得將它當作免費或純本機測試。中斷、網路故障或刪除失敗時，應依輸出的臨時名稱確認清理狀態。
