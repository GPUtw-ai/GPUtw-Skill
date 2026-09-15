# GPUtw REST API 端點總表（公開契約）

> ⚠️ **AI 指令**：本表是 GPUtw 使用者 API 的**唯一可引用端點清單**。不在此表中的路徑，不得憑記憶或猜測告訴開發者「應該存在」——請改為引導開發者查看 https://gputw.ai/zh-TW/docs 或聯絡支援。
> 快照日期：2026-09 ｜ 來源：GPUtw 官方文件（`gputw.ai/docs`）與公開 API 文件 ｜ 規格細節以 [`references/docs-site.md`](./docs-site.md) 內的即時頁面為準。

## 基本資訊

| 項目 | 值 |
|---|---|
| Base URL | `https://api.gputw.ai/api`（`https://gputw.ai/api` 為同一 API，兩者皆可） |
| 傳輸主機（大檔上傳/下載專用） | `https://upload.gputw.ai/api` — **只**服務下表標示 🚚 的路由，其餘一律 `404` |
| 認證 | `Authorization: Bearer gputw_live_…`（API 金鑰）或登入 JWT。**金鑰不可放在 query string** |
| 必要 header | `User-Agent: <任意可識別字串>`（未設定 → Cloudflare `403` / `error code: 1010`，請求根本到不了 GPUtw） |
| 回應信封 | 成功 `{ "success": true, "data": …, "error": null }`；失敗 `{ "success": false, "data": null, "error": "<訊息>" }` |
| 所有權 | 每個 `/instances/{id}` 端點：不存在 → `404`；屬於其他帳號 → `403` |

## 圖例

- **Scope**：API 金鑰需具備的權限範圍；`—` = 公開端點，不需認證；**🔒 僅限瀏覽器登入** = 任何 scope 都無法透過 API 金鑰呼叫
- **來源**：`docs` = 公開 API 文件（instance-api / vault-upload-api / vault-download-api / transfer host）；`site` = gputw.ai/docs 頁面；`live` = 本 skill 撰寫時對公開端點實際呼叫驗證；`dashboard` = 控制台功能對應的 API（官方文件僅以功能描述提及，欄位以控制台行為為準）
- 🚚 = 亦可在傳輸主機 `upload.gputw.ai` 上呼叫

## 目錄與設定（公開，不需認證）

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| GET | `/gpus/active` | — | [02](../guides/02-catalog-and-capacity.md) | GPU 目錄：`id`, `name`, `architecture`, `vramGb`, `hourlyPrice`, `liveRentablePrice`, `offers[]`, `demandStatus`, `availability`, `totalGpus`, `availableGpus`, `rentalMode`, 規格欄位… | site, live |
| GET | `/templates` | — | [03](../guides/03-instances-lifecycle.md) | 範本清單：`id`, `name`, `description`, `dockerImage`, `category`, `tags[]`, `architectures[]`, `minComputeCapability`, `webUiEnabled`, `webUiPort`, `isPublic` | live |
| GET | `/config/deploy` | — | [03](../guides/03-instances-lifecycle.md) | 部署選項：`includedBandwidthMbps`, `paidBandwidthMbps`, `bandwidthOptions[{mbps, included}]`, `internetPricePerMbpsHr` | docs, live |
| GET | `/config/features` | — | [09](../guides/09-account-billing-teams.md) | 功能旗標：`lowBalanceThresholdNtd`, `discordInviteUrl`, … | docs, live |
| GET | `/config/time` | — | [10](../guides/10-errors-and-troubleshooting.md) | 伺服器時間 `{ epochMs, iso, timezone }`；連線/User-Agent 檢查用 | live |

## 容量

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| GET | `/nodes/available?catalogId=<uuid>` | `catalog:read` | [02](../guides/02-catalog-and-capacity.md) | 該 GPU 型號目前可租的機器：不透明的機器 `id`、可租硬體規格、整機 `hourlyRate`、可用數量、排隊深度 | site |
| GET / POST / DELETE | `/reservations` , `/reservations/{id}` | `reservations:manage` | [02](../guides/02-catalog-and-capacity.md) | 容量排隊（機器售罄時預約）。請求格式請以控制台/官方文件為準 | site (scope 說明) |

## 執行個體 — 生命週期

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| GET | `/instances` | `instances:read` | [03](../guides/03-instances-lifecycle.md) | 列出帳號下的執行個體（不含 `TERMINATED`）。**勿在迴圈中輪詢此端點**，改用 `/{id}/status` | site, docs |
| GET | `/instances/{id}` | `instances:read` | [04](../guides/04-instance-runtime.md) | 單一執行個體，欄位與列表相同 | docs |
| POST | `/instances/create` | `instances:create` | [03](../guides/03-instances-lifecycle.md) | 部署。`nodeId` + (`templateId` ｜ `template` ｜ `customImage`) 三選一，選填 `bandwidthMbps`, `shmSizeGb`, `ports[]` → `201` | site, docs |
| POST | `/instances/validate-image` | `instances:create` | [03](../guides/03-instances-lifecycle.md) | 部署前檢查自訂映像可否拉取（`dockerImage`, 選填 `registryAuth`） | docs (scope 說明) |
| POST | `/instances/stop` | `instances:manage` | [03](../guides/03-instances-lifecycle.md) | `{ "instanceId": "<uuid>" }`；停止即停止計費，保留紀錄可重啟 | site, docs |
| POST | `/instances/delete` | `instances:manage` | [03](../guides/03-instances-lifecycle.md) | `{ "instanceId": "<uuid>" }`；終止並移除執行個體 | docs |
| GET | `/instances/{id}/restart-options` | `instances:read` | [03](../guides/03-instances-lifecycle.md) | 已停止/失敗的執行個體：原機是否可重啟、有哪些替代機器 | dashboard |
| POST | `/instances/{id}/restart` | `instances:manage`（或 `instances:create`） | [03](../guides/03-instances-lifecycle.md) | `{ "mode": "same" }` 同機重啟（`200`）或 `{ "mode": "alternative", "nodeId": "…" }` 換機（建立新執行個體 → `201`） | dashboard |
| PUT | `/instances/{id}` | `instances:manage` | [03](../guides/03-instances-lifecycle.md) | 重新設定（換範本 / 頻寬 / shm）；會重建容器 | docs |
| POST | `/instances/{id}/pod/restart` | `instances:manage` | [04](../guides/04-instance-runtime.md) | 原地重建容器，保留映像、連接埠與 `/workspace`；自訂映像不適用 | docs |

## 執行個體 — 即時狀態（runtime）

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| GET | `/instances/active` | `instances:read` | [04](../guides/04-instance-runtime.md) | 所有 `DEPLOYING`/`RUNNING` 執行個體 + 即時 `pod` 狀態 + `usage` | docs |
| GET | `/instances/{id}/status` | `instances:read` | [04](../guides/04-instance-runtime.md) | **輪詢用**的輕量端點：`status`, `deployPhase`, `podPhase`, `ready`, `restartCount`, `waitingReason`, `failureReason`, `uptimeSec` | docs |
| GET | `/instances/{id}/resources` | `instances:read` | [04](../guides/04-instance-runtime.md) | `allocated` + `usage`（含 `source`: `prometheus`/`fallback`/`none`）+ `billing` | docs |
| GET | `/instances/{id}/events?limit=20` | `instances:read` | [04](../guides/04-instance-runtime.md) | 結構化事件 `{ events[{type, reason, message, count, lastSeen}], podExists }`；`limit` 1–100 | docs |
| GET | `/instances/{id}/logs?tail=200&previous=1` | `instances:read` | [04](../guides/04-instance-runtime.md) | 容器日誌尾端；`tail` ≤ 2000 行、回應 ≤ 48 KiB；`previous=1` 讀上一個容器（crash loop 必用） | docs |
| GET | `/instances/{id}/runs?limit=50` | `instances:read` | [04](../guides/04-instance-runtime.md) | 此執行個體的計費區段（新→舊）；`limit` 1–200 | docs |
| GET | `/instances/{id}/startup-log` | `instances:read` | [04](../guides/04-instance-runtime.md) | 部署失敗時的文字啟動日誌（控制台「Startup log」同源） | docs (提及) |
| POST | `/instances/{id}/exec` | `instances:exec` | [04](../guides/04-instance-runtime.md) | `{ "command": [argv…], "timeoutMs": 30000 }` → `{ stdout, stderr, exitCode, truncated }`；root 權限、留稽核紀錄 | docs |

## 連接埠與網路

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| PATCH | `/instances/{id}/ports` | `ports:manage` | [05](../guides/05-ports-and-exposures.md) | `{ "ports": [8080, 18080], "portAccess": { "8080": { "mode": "unlisted", "password": "…" } } }`；mode = `private`/`public`/`unlisted` | site |
| POST | `/instances/{id}/exposures` | `ports:manage` | [05](../guides/05-ports-and-exposures.md) | `{ "protocol": "tcp"｜"udp", "containerPort": 25565 }` → `201` 含 `endpoint`（`tcp.gputw.ai:<port>`） | site |
| DELETE | `/instances/{id}/exposures/{exposureId}` | `ports:manage` | [05](../guides/05-ports-and-exposures.md) | 移除 raw 曝露並釋放公開埠 | site |
| POST | `/instances/{id}/access-token` | `ports:manage` | [05](../guides/05-ports-and-exposures.md) | `{ "port": 8080, "path": "" }` → 90 秒有效的 Web UI 交接網址 `{ url, token, port, expiresIn }` | dashboard |

## Vault 儲存空間

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| GET | `/vault/stats` | `vault:read` | [06](../guides/06-vault-basics.md) | 用量與配額 | docs (提及) |
| GET | `/vault/list?path=models` | `vault:read` | [06](../guides/06-vault-basics.md) | 列出資料夾：`files[{ name, size, modifiedAt, type }]` | site, docs |
| POST | `/vault/mkdir` | `vault:write` | [06](../guides/06-vault-basics.md) | 建立資料夾 `{ "path": "…" }` | site (scope 說明) |
| POST | `/vault/rename` | `vault:write` | [06](../guides/06-vault-basics.md) | 搬移/改名 `{ "from": "…", "to": "…" }` | site (scope 說明) |
| DELETE | `/vault/delete` | `vault:write` | [06](../guides/06-vault-basics.md) | 刪除檔案/資料夾 `{ "filename": "…" }` | site (scope 說明) |
| POST 🚚 | `/vault/upload?path=<folder>` | `vault:write` | [06](../guides/06-vault-basics.md) | 單請求 multipart 上傳（欄位 `file`）。經主站 ≤ ~90 MB；經傳輸主機無上限 | site, docs |
| GET 🚚 | `/vault/download?filename=<path>` | `vault:read` | [06](../guides/06-vault-basics.md) | 下載單檔，支援 `Range` | site, docs |
| GET 🚚 | `/vault/download-zip?folder=<path>` | `vault:read` | [06](../guides/06-vault-basics.md) | 資料夾打包為 zip 串流 | site, docs |
| POST 🚚 | `/vault/uploads` | `vault:write` | [07](../guides/07-vault-chunked-upload.md) | 建立分段上傳 `{ path, size, sha256?, chunkSize? }` → `{ uploadId, chunkSize, partCount, … }` | docs |
| PUT 🚚 | `/vault/uploads/{uploadId}/parts/{n}` | `vault:write` | [07](../guides/07-vault-chunked-upload.md) | 上傳第 n 段原始位元組（`application/octet-stream`），可平行、可重送 | docs |
| POST 🚚 | `/vault/uploads/{uploadId}/complete` | `vault:write` | [07](../guides/07-vault-chunked-upload.md) | 開始組裝 → `202` | docs |
| GET 🚚 | `/vault/uploads/{uploadId}` | `vault:read` **或** `vault:write` | [07](../guides/07-vault-chunked-upload.md) | 狀態與 `receivedParts[]`（續傳用） | docs |
| DELETE 🚚 | `/vault/uploads/{uploadId}` | `vault:write` | [07](../guides/07-vault-chunked-upload.md) | 中止分段上傳 | docs |
| POST | `/vault/downloads` | `vault:write` | [08](../guides/08-vault-model-download.md) | 伺服器端下載 `{ source, targetPath, hfToken? }` → `202`。**不在傳輸主機上** | docs |
| GET | `/vault/downloads` , `/vault/downloads/{id}` | `vault:read` | [08](../guides/08-vault-model-download.md) | 列表 / 進度（`status`, `bytesDownloaded`, `totalBytes`） | docs |
| DELETE | `/vault/downloads/{id}` | `vault:write` | [08](../guides/08-vault-model-download.md) | 取消下載 | docs |

## 帳號、帳務、團隊、通知

| 方法 | 路徑 | Scope | 指南 | 說明 | 來源 |
|---|---|---|---|---|---|
| GET | `/auth/me` | `profile:read` | [09](../guides/09-account-billing-teams.md) | 帳號資料、點數餘額、團隊/計費模式 | docs (提及) |
| PATCH | `/auth/me/profile` | `profile:manage` | [09](../guides/09-account-billing-teams.md) | 顯示名稱等偏好設定 | site (scope 說明) |
| GET | `/api-keys` | `keys:manage` | [01](../guides/01-auth-and-scopes.md) | 列出金鑰（只含前綴，不含秘密） | site (scope 說明) |
| POST | `/api-keys` | `keys:manage` | [01](../guides/01-auth-and-scopes.md) | 建立金鑰 `{ name, scopes[], expiresAt? }` → `201`，`secret` **只回傳一次** | site (scope 說明) |
| PATCH | `/api-keys/{id}` | `keys:manage` | [01](../guides/01-auth-and-scopes.md) | 更新名稱 / scopes / 到期日 | docs |
| POST | `/api-keys/{id}/rotate` | `keys:manage` | [01](../guides/01-auth-and-scopes.md) | 換發新秘密 | site (提及「rotate」) |
| DELETE | `/api-keys/{id}` | `keys:manage` | [01](../guides/01-auth-and-scopes.md) | 撤銷 | site (提及「revoke」) |
| GET | `/users/me/payments` | `billing:read` | [09](../guides/09-account-billing-teams.md) | 付款/儲值紀錄 | site (scope 說明) |
| GET | `/notifications?limit=20` ; PATCH `/notifications/{id}/read` ; PATCH `/notifications/read-all` | `notifications:read` | [09](../guides/09-account-billing-teams.md) | 站內通知 | site (scope 說明) |
| GET | `/orgs/me` , `/orgs/me/instances` | `org:read` | [09](../guides/09-account-billing-teams.md) | 團隊資料、團隊成員的執行個體 | docs (提及) |
| POST / PATCH / DELETE | `/orgs/me/members` , `/orgs/me/members/{userId}` ; PATCH `/orgs/me/settings` | `org:manage` | [09](../guides/09-account-billing-teams.md) | 邀請成員、設定每月上限/執行個體數/暫停部署 | site (scope 說明) |
| POST | `/tickets` | `tickets:manage` | [09](../guides/09-account-billing-teams.md) | 開立支援工單 `{ subject, content }` | site (scope 說明) |

## 🔒 僅限瀏覽器登入（API 金鑰永遠 403）

| 路徑 | 原因 |
|---|---|
| `/auth/ssh-keys`（所有方法） | 新增金鑰等於取得帳號下**所有**執行個體的 root SSH，超出任何 scope 能授權的範圍 → 請在控制台 → SSH 金鑰操作 |
| `/auth/change-password`, `/auth/change-email/*`, `/auth/delete-account` | 帳號安全與刪除 |
| `POST /orgs/me`, `DELETE /orgs/me` | 建立 / 刪除團隊，不可逆 |
| `POST /payments/checkout` | 儲值需互動式付款跳轉 |
| `/instances/{id}/alerts`, `/instances/alerts/{ruleId}`, `/instances/alert-metrics` | 執行個體指標警示目前僅限控制台設定 |
| `POST /vault/download-token` | 瀏覽器 `<a href>` 下載專用；腳本直接用 `GET /vault/download` + header 即可 |
| `/admin/*` | 管理端，使用者金鑰一律拒絕 |

## 已退役

| 路徑 | 狀態 |
|---|---|
| `GET /config/pricing` | `410` — 改用 `GET /gpus/active` 的每型號費率 |
