# 10 · 錯誤碼與除錯

> SNAPSHOT 2026-09 ｜ 來源：公開 API 文件、https://gputw.ai/en/docs/faq ｜ 訊息字串可能微調，請以實際回應為準

## 遇到錯誤怎麼查？

```
HTTP 回應
├── body 不是 JSON 信封（HTML / 提到 Cloudflare / error code 1010）
│      └── 請求沒到 GPUtw → 加 User-Agent（§Cloudflare）
├── 401 → 憑證問題（沒帶 / 貼錯 / 撤銷 / 過期）→ §401
├── 403
│      ├── "missing required scope: X"  → 金鑰缺 scope X → 更新 scopes 或換發
│      ├── "not available to API keys"   → 路由僅限瀏覽器 → 控制台操作
│      ├── "Deploys are suspended…"      → 團隊擁有者暫停 → 找擁有者
│      └── 其他 → 資源屬於別的帳號 / 帳號停用
├── 402 → 點數不足一小時 → 控制台儲值
├── 404 → 執行個體 / 檔案 / 範本不存在；或**在傳輸主機上呼叫了非傳輸路由**
├── 409 → 狀態衝突（機器已被租、上傳 session 已結束、目標已存在）→ 重新查詢後重試
├── 413 / 507 → Vault 配額 / 儲存空間
├── 429 → 速率限制 → 讀 RateLimit-* header，退避重試
├── 504 → exec 逾時 → 提高 timeoutMs（≤ 120000）或拆小指令
└── 5xx → 伺服器錯誤 → 指數退避重試；持續發生請附 request 時間聯絡支援
```

## 狀態碼總表

| 狀態 | 典型 `error` | 原因 | 處理 |
|---|---|---|---|
| `400` | `field: message; other: message` | 請求欄位驗證失敗（zod 風格，列出欄位） | 依訊息修正欄位 |
| `400` | `Reserved or invalid port(s): … Allowed 1024–65535, excluding 2222, 6443 and 9000–9999.` | 連接埠不合法 | 修正 `ports` |
| `400` | `Too many ports — max 20 per instance` | | 減少連接埠 |
| `400` | `part N must be exactly X bytes` | 分段大小 ≠ `chunkSize` | 用 session 的 `chunkSize` |
| `400` | `missing parts: …` | `complete` 前有段沒到 | `GET` 看 `receivedParts` 補齊 |
| `400` | `Instance already terminated` | 對 `TERMINATED` 做 stop/delete | 無需處理 |
| `400` | `Custom image must enable SSH or declare a Web UI port` | | 補 `sshEnabled` 或 Web UI |
| `400` | `"X" requires a newer GPU (compute capability ≥ N)…` | 範本與 GPU 不相容 | 換範本 / 換 GPU |
| `400` | `Cannot rotate a revoked key` | | 建新金鑰 |
| `401` | `Missing or invalid authorization header` | 沒帶 `Authorization: Bearer …` | 補 header |
| `401` | `Invalid or expired API key` / `Invalid or expired token` | 金鑰錯、撤銷、過期 | 換發 |
| `401` | `API keys must be sent in the Authorization header, not the query string` | 金鑰放在 `?token=` | 移到 header |
| `402` | `Insufficient credits to cover one hour of your total running instances` | | 儲值 |
| `403` | `API key missing required scope: …` | | 更新 scopes |
| `403` | `This endpoint is not available to API keys. Use a browser session.` | 路由不對金鑰開放 | 控制台 |
| `403` | `Account is disabled` | | 聯絡支援 |
| `403` | `Deploys are suspended by your organization owner` | | 團隊擁有者 |
| `403`（他人資源） | — | 執行個體屬於其他帳號 | 檢查 id |
| `404` | `Template not found` / `Folder not found` / `File not found` / `API key not found` | | 檢查 id / 路徑 |
| `404`（傳輸主機） | — | `upload.gputw.ai` 只服務傳輸路由 | 改打 `api.gputw.ai` |
| `409` | `This node already has an active instance (one instance per node).` | 機器被搶 | 重查 `/nodes/available` |
| `409` | `Upload is <status>` / `Target already exists` | | 重新查詢狀態 |
| `410` | `SystemConfig removed … use /api/gpus/active` | 已退役端點 | 改用新端點 |
| `413` | Vault 配額不足 | | 清理或申請加大配額 |
| `429` | `Too many requests — please slow down and try again in a minute.` | 每使用者速率限制 | 退避 |
| `429`（vault downloads） | 超過 3 個同時下載 | | 等待 |
| `503` | `Selected node is not available` | 機器下線 / 維護 | 換機器 |
| `504` | exec 逾時 | | 調 `timeoutMs` 或拆指令 |
| `507` | Vault 儲存空間暫時不足 | | 稍後重試 / 支援 |

## Cloudflare `403` / `error code: 1010`

請求經過 Cloudflare，其瀏覽器完整性檢查會擋掉少數客戶端簽章——目前已知 Python `urllib` 預設的 `Python-urllib/3.x`。回應是 `403` 且 body 像：

```json
{ "cloudflare_error": true, "error_code": 1010, "ray_id": "…",
  "detail": "The site owner has blocked access based on your browser's signature." }
```

解法：任何可識別的 `User-Agent`（`my-automation/1.0`）。**不要**假冒瀏覽器 UA——過期的 Chrome 版本字串本身也是簽章。`curl`、`python-requests`、`axios`、`node-fetch`、Go 預設客戶端不受影響。

```python
import urllib.request, json
req = urllib.request.Request("https://api.gputw.ai/api/instances/stop",
                             data=json.dumps({"instanceId": instance_id}).encode(), method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("Authorization", f"Bearer {API_KEY}")
req.add_header("User-Agent", "my-automation/1.0")   # 必要
```

## 速率限制

每使用者（金鑰）計數，回 `RateLimit-*` 標準 header。已知額度（每 5 分鐘）：執行個體動作 60、映像驗證 120、Vault 變更 600、分段 PUT 5000、儲值 5。遇 `429` 讀 `RateLimit-Reset` 後退避；不要對 `403` 重試（那不是暫時性的）。

## 症狀 → 原因

### 部署卡在 `DEPLOYING`
| `deployPhase` / 症狀 | 意思 | 動作 |
|---|---|---|
| `PULLING_IMAGE` 很久 | 大映像（自訂映像常見） | 等；自訂映像拉取時間計費 |
| `SCHEDULING` 不動、`failureReason: FAILED_SCHEDULING_MEMORY` | 機器資源不足 | `stop` 後換機器重啟 |
| `failureReason: IMAGE_PULL_FAILED` | 映像不存在 / 私有 registry 憑證錯 / 用了 `latest` | 先 `POST /instances/validate-image` |
| `failureReason: CONTAINER_CRASHING`、`restartCount` 上升 | 程序啟動就掛 | `GET /logs?previous=1` |
| 15 分鐘後 `FAILED` | SSH 沒在 22 監聽 / Web UI 沒回應 | 修映像；此情況不收費 |

### `FAILED` / crash loop 除錯順序
1. `GET /instances/{id}/status` → `failureReason`, `waitingReason`, `terminatedReason`
2. `GET /instances/{id}/events` → `reason` / `message`
3. `GET /instances/{id}/logs?tail=200&previous=1` → 真正的錯誤
4. `GET /instances/{id}/startup-log`（控制台「Startup log」同源）

### 用量看起來都是 0
`GET /resources` 的 `usage.source` 是 `none` → 沒有遙測，指標其實是 `null`；不是閒置。`fallback` 是次要來源，可用。

### 上傳問題
| 症狀 | 原因 |
|---|---|
| 經 `api.gputw.ai` 傳 > 100 MB 單請求失敗 | 主站有 100 MB 請求上限 → 用 `upload.gputw.ai` 或分段上傳 |
| 每段傳到一半斷線 | 經主站每段須在 ~100 秒內傳完 → 用傳輸主機或較小 `chunkSize` |
| `GET /vault/list` 在 `upload.gputw.ai` 回 `404` | 傳輸主機只服務傳輸路由 |
| `sha256 mismatch` | 重 `PUT` 有問題的段再 `complete` |

### SSH `Permission denied`
控制台 SSH 金鑰頁的公開金鑰是否對應本機私鑰；執行個體是否 `RUNNING`；使用者名 `pod-<instance-id>`、埠 `2222`、主機 `ssh.gputw.ai`。

### 為什麼不能部署？（FAQ）
選的機器已被租用、範本需要更新的 GPU 架構、或點數不足一小時。

## 相關文件

- [01 · 認證與 scope](./01-auth-and-scopes.md) ｜ [04 · 即時狀態](./04-instance-runtime.md) ｜ [07 · 分段上傳](./07-vault-chunked-upload.md)
- 官方 FAQ：https://gputw.ai/zh-TW/docs/faq
