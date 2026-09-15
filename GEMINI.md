# GPUtw API 整合助手 — Google Gemini CLI

> **V1.0.0** ｜ 適用 Google Gemini CLI ｜ 完整知識庫入口：[`SKILL.md`](./SKILL.md) ｜ 如有差異以 `SKILL.md` 為準

## 啟動指示

收到 GPUtw / gputw.ai / 台灣 GPU 雲 / `/vault` / `gputw_live_` 相關需求時：
1. 讀取 `SKILL.md`（決策樹、AI 注意事項、快速參考、文件索引）
2. 依決策樹讀取對應 `guides/NN-*.md`；非 bash 語言再讀 `guides/lang-standards/<語言>.md`
3. 引用端點前先查 `references/endpoints.md`；需要欄位細節時瀏覽 `references/docs-site.md` 內的官方頁面
4. 需要可執行範例時以 `scripts/gputw_client.py` 或 `scripts/examples/*.sh` 為基底

> ⚠️ **語言強制規則**：無論文件語言為何，一律用使用者的提問語言全文回覆（英文問 → 英文答；中文問 → 中文答）。API 欄位、端點、狀態值與程式碼識別符不翻譯。

## 決策樹

**部署**
- 選型號：`GET /gpus/active`（公開）→ `id` 當 `catalogId`；`liveRentablePrice == null` / `demandStatus == 售罄` 表示沒空機
- 選機器：`GET /nodes/available?catalogId=…`（`catalog:read`）→ `availableGpus > 0` 的 `id` 當 `nodeId`
- 選範本：`GET /templates`（公開）→ `architectures[]` 必須含機器 `arch`（DGX Spark = `arm64`）
- 自訂映像：`customImage.dockerImage` 用明確 tag / digest、`sshEnabled` 或 Web UI 二選一，先 `POST /instances/validate-image`
- 部署：`POST /instances/create` → `201`；輪詢 `GET /instances/{id}/status` 每 5 秒到 `RUNNING`；`FAILED` → `/logs?previous=1`
- 結束：`POST /instances/stop`（可重啟）或 `POST /instances/delete`

**監控與除錯**
- 用量：`GET /instances/{id}/resources`，`usage.source == none` 表示沒遙測（`null` ≠ 0）
- 卡住：`/status` 的 `deployPhase` + `failureReason` → `/events` → `/logs?previous=1` → `/startup-log`
- 執行指令：`POST /instances/{id}/exec`，`command` 為 argv 陣列，需 `instances:exec`
- 全帳號：`GET /instances/active`；費用：`GET /instances/{id}/runs`

**Vault**
- 小檔：`POST /vault/upload?path=`（multipart）；大檔：分段上傳到 `https://upload.gputw.ai/api`（`chunkSize` 取自 session）
- 網址 / Hugging Face：`POST /vault/downloads`（`hf:<owner>/<repo>:<path>`；gated 用 `hfToken`）——只在 `api.gputw.ai`
- CI：`Upload token` preset（只有 `vault:write`）
- 取回：`GET /vault/download?filename=`（支援 Range）、`GET /vault/download-zip?folder=`

**帳號**
- scope 不夠 → `403 API key missing required scope`；路由僅限瀏覽器 → `403 This endpoint is not available to API keys`
- 僅限控制台：SSH 金鑰、儲值、改密碼/Email、建/刪團隊、執行個體警示、admin
- `402` → 餘額不足一小時 → 控制台儲值

**錯誤碼**
- `403` 且 body 不是 JSON 信封 → 沒帶 `User-Agent`（Cloudflare 1010）
- `401` 金鑰 ｜ `404` 在 `upload.gputw.ai` = 非傳輸路由 ｜ `409` 重查後重試 ｜ `429` 退避 ｜ `504` exec 逾時

## 關鍵規則（必須遵守）

1. 只引用 `references/endpoints.md` 列出的端點；沒有的就說「未收錄」並指向 https://gputw.ai/zh-TW/docs
2. API 金鑰只放 `Authorization: Bearer` header，從環境變數 `GPUTW_API_KEY` 讀，不寫死、不記錄
3. 每個請求都帶 `User-Agent`（不假冒瀏覽器）
4. `instances:exec` 只給專用金鑰，不給共用 / 第三方自動化
5. 不嘗試程式登入或繞過僅限瀏覽器的路由；引導控制台
6. 等待用 `GET /instances/{id}/status` 每 5 秒並設逾時；不輪詢 `GET /instances`
7. 指標 `null` 不是 0；先看 `usage.source`
8. 不寫死 `chunkSize`、範本 UUID、catalog UUID
9. `upload.gputw.ai` 只打傳輸路由；`/vault/list`、`/stats`、`/downloads` 留在 `api.gputw.ai`
10. 不用 raw TCP/UDP 曝露無驗證的 Web UI
11. 流程結尾必定 `stop` / `delete`（`finally`），並提醒 `RUNNING` 持續扣點數
12. 自訂映像不用 `:latest`；先 `validate-image`
13. `403` 不重試；`429` 依 `RateLimit-Reset` 退避；`402` 提示儲值
14. `/workspace` 不持久；要保留的放 `/vault`
15. 只描述公開 API 契約與官方文件內容，不描述內部架構
16. 生成的程式碼加註來源 URL 與日期，並列出所需 scopes / preset

## 快速參考

- API base：`https://api.gputw.ai/api`；傳輸主機：`https://upload.gputw.ai/api`（探測 `/health`）；SSH：`ssh pod-<instance-id>@ssh.gputw.ai -p 2222`；Web UI：`https://<port>-<instance-id>.gputw.ai`；raw：`tcp.gputw.ai` / `udp.gputw.ai`
- 信封：`{ "success": true, "data": …, "error": null }` / `{ "success": false, "data": null, "error": "…" }`
- Presets：`readonly`（catalog:read, instances:read, profile:read, vault:read, billing:read, notifications:read）｜ `deploy`（catalog:read, instances:read, instances:create）｜ `operator`（instances:read, instances:manage, ports:manage）｜ `Upload token`（vault:write）｜ `full`（全部，含 instances:exec）
- 狀態：`DEPLOYING` → `RUNNING` → `STOPPED` / `FAILED` / `TERMINATED`；`INSUFFICIENT_FUNDS`；`deployPhase`: `SCHEDULING` / `PULLING_IMAGE` / `STARTING` / `RUNNING`
- 限制：部署需餘額 ≥ 一小時；每機一執行個體；連接埠 `1024–65535` 排除 `2222`, `6443`, `9000–9999`；exec `timeoutMs` ≤ 120000；logs `tail` ≤ 2000；上傳單檔 ≤ 2 TB；同時下載 ≤ 3
- 驗證載入：「GPUtw API key 的前綴是什麼？」→ `gputw_live_`

## 即時 API 規格

`guides/` 的表格是 SNAPSHOT 2026-09。回答欄位、限制、費用或最新行為前，先瀏覽 `references/docs-site.md` 對應的 https://gputw.ai/en/docs/… 或 /zh-TW/docs/… 頁面；無法瀏覽時以 guides 回答並告知開發者附上 URL。官方頁面也沒有的端點 → 明說「未收錄」，不要猜。
搜尋策略：搜尋 `site:gputw.ai/docs` + 主題（例如 `site:gputw.ai/docs vault upload`）。
