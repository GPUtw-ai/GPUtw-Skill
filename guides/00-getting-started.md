# 00 · 快速開始：從零到第一個 API 呼叫

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/getting-started 、 https://gputw.ai/en/docs/api-keys 、公開 API 文件 ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

GPUtw 是台灣的裸機 GPU 雲：每台執行個體是一個獨佔 GPU 的容器，附控制台、SSH、Web UI、持久化 Vault 儲存空間、連接埠管理與**有權限範圍（scope）的 API 金鑰**。本指南帶你在 10 分鐘內完成第一個 API 呼叫。

## 前置需求

- [ ] GPUtw 帳號（https://gputw.ai 註冊、登入、完成 Email 驗證）
- [ ] 預付點數：部署前餘額必須足以支付**所有已承諾執行個體一小時**的費用（控制台 → 儲值；儲值只能在瀏覽器完成，API 無法儲值）
- [ ] （選用）SSH 公開金鑰：控制台 → SSH 金鑰（**只能在控制台加入**，API 金鑰無法管理 SSH 金鑰）
- [ ] 一把 API 金鑰：控制台 → API 金鑰 → 選權限組合（preset）或自訂 scopes → **秘密只顯示一次**，立刻複製

## 步驟 1：建立 API 金鑰

在控制台 → API 金鑰選一個權限組合：

| 需求 | 建議 preset | 包含 scopes |
|---|---|---|
| 只想讀狀態 / 用量 | `readonly` | `catalog:read`, `instances:read`, `profile:read`, `vault:read`, `billing:read`, `notifications:read` |
| 部署機器人 | `deploy` | `catalog:read`, `instances:read`, `instances:create` |
| 停止 / 重啟 / 管連接埠的維運腳本 | `operator` | `instances:read`, `instances:manage`, `ports:manage` |
| CI 推資料集進 Vault | `Upload token` | 只有 `vault:write`（唯寫，外洩也無法部署或讀取） |
| 全部（含在容器內執行指令） | `full` | 所有 scopes，**含 `instances:exec`** |

金鑰格式：`gputw_live_` 開頭。詳細 scope 說明見 [01 · 認證與權限](./01-auth-and-scopes.md)。

## 步驟 2：第一個呼叫

```bash
export GPUTW_API_KEY=gputw_live_xxxxxxxxxxxxxxxx
API=https://api.gputw.ai/api

# 不需金鑰的公開端點：先確認連線與 User-Agent 都正常
curl -fsS -A "my-automation/1.0" "$API/config/time"
# → {"success":true,"data":{"epochMs":…,"iso":"…","timezone":"Asia/Taipei"},"error":null}

# 需要金鑰：列出我的執行個體
curl -fsS -A "my-automation/1.0" -H "Authorization: Bearer $GPUTW_API_KEY" "$API/instances"
```

### ⚠️ 一定要送 `User-Agent`

API 前面有 Cloudflare。少數客戶端簽章（目前已知：Python `urllib` 的預設 `Python-urllib/3.x`）會在**到達 GPUtw 之前**被擋下，回應 `HTTP 403` 且 body 是 Cloudflare 的 `error code: 1010`，看起來像權限錯誤但其實不是。任何可識別的字串都行（`my-automation/1.0`），**不要**假冒瀏覽器 UA。`curl`、`python-requests`、`axios`、`node-fetch`、Go 預設客戶端皆不受影響。

判斷方式：`403` 而 body 不是 `{ "success": false, … }` 信封（是 HTML 或提到 Cloudflare）→ 先檢查 `User-Agent`，再檢查金鑰與 scope。

## 步驟 3：讀懂回應信封

所有端點都用同一個信封：

```json
{ "success": true,  "data": { … }, "error": null }
{ "success": false, "data": null,  "error": "API key missing required scope: instances:read" }
```

- 永遠先看 HTTP 狀態碼，再看 `success`，最後取 `data`。
- 錯誤訊息在 `error`（字串）。狀態碼對照表見 [10 · 錯誤與除錯](./10-errors-and-troubleshooting.md)。

## 步驟 4：最常見的三條路

| 目標 | 路徑 | 指南 |
|---|---|---|
| 部署一台 GPU 並等它 `RUNNING` | `GET /gpus/active` → `GET /nodes/available?catalogId=` → `POST /instances/create` → 輪詢 `GET /instances/{id}/status` | [02](./02-catalog-and-capacity.md) → [03](./03-instances-lifecycle.md) → [04](./04-instance-runtime.md) |
| 把模型 / 資料集放進 `/vault` | 本機檔案 → [07 分段上傳](./07-vault-chunked-upload.md)；網址或 Hugging Face → [08 伺服器端下載](./08-vault-model-download.md) | [06](./06-vault-basics.md) |
| 用完關機省錢 | `POST /instances/stop`（保留可重啟）或 `POST /instances/delete` | [03](./03-instances-lifecycle.md) |

## 各步驟成功標誌

| 步驟 | 成功 | 失敗的第一個檢查點 |
|---|---|---|
| `GET /config/time` | `200` + JSON 信封 | 非 JSON 的 `403` → User-Agent |
| `GET /instances` | `200`，`data` 是陣列（可能為空） | `401` → 金鑰貼錯 / 已撤銷；`403 …missing required scope` → 金鑰缺 `instances:read` |
| `POST /instances/create` | `201`，`data.status` = `DEPLOYING` | `402` → 點數不足一小時；`409` → 該機器已被租用；`503` → 機器目前不可用 |

## 相關文件

- [01 · 認證與權限範圍](./01-auth-and-scopes.md)
- [11 · 端到端工作流程](./11-workflows.md)
- [`references/endpoints.md`](../references/endpoints.md)
- 官方：https://gputw.ai/zh-TW/docs/getting-started
