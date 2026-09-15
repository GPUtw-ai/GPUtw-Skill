# 01 · 認證、權限範圍（scopes）與金鑰管理

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/api-keys 、公開 Instance runtime API 文件 §Authorization ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

## 兩種憑證

| 憑證 | 取得方式 | 適用 |
|---|---|---|
| **API 金鑰** `gputw_live_…` | 控制台 → API 金鑰 | 腳本、CI、代理程式。**這是自動化的唯一正確途徑** |
| 登入 JWT | 瀏覽器登入（含機器人驗證） | 控制台本身；不適合自動化，也不要嘗試用程式模擬登入 |

兩者都用同一個 header：

```
Authorization: Bearer gputw_live_xxxxxxxxxxxxxxxx
```

規則：
- 金鑰**只能放在 header**。放在 query string（`?token=`）會被拒絕。
- 每個請求加 `User-Agent`（見 [00](./00-getting-started.md)）。
- 秘密只在建立 / 換發時回傳一次；之後 API 與控制台只顯示前綴 `gputw_live_xxxxxxxx…`。

## 授權模型：兩道檢查

每個 API 金鑰請求都經過兩道獨立檢查：

1. **可達性（reachability）**：預設拒絕。只有明確開放給 API 金鑰的路由才可呼叫；其他路由不論金鑰有什麼 scope 都回 `403 This endpoint is not available to API keys. Use a browser session.`
2. **Scope**：該路由要求的 scope 必須在金鑰的 scopes 內，否則 `403 API key missing required scope: <scope>`。

登入 JWT 不受第 1 道限制（瀏覽器登入可做所有事）。

## Scope 一覽

| Scope | 授權內容 |
|---|---|
| `catalog:read` | GPU 目錄與可用機器 |
| `instances:read` | 列出 / 讀取執行個體、resources、status、events、runs、logs |
| `instances:create` | 部署新執行個體、驗證映像 |
| `instances:manage` | 停止、刪除、重啟、重新設定、容器重建 |
| `instances:exec` | **在容器內以 root 執行指令**（見下方警告） |
| `ports:manage` | HTTP 連接埠、raw TCP/UDP 曝露、存取權杖 |
| `keys:manage` | API 金鑰管理 |
| `profile:read` | 讀取帳號資料 |
| `profile:manage` | 帳號偏好：顯示名稱、語言、通知設定 |
| `vault:read` | 瀏覽與下載 Vault 內容 |
| `vault:write` | 上傳、改名、建資料夾、刪除 Vault 內容 |
| `billing:read` | 付款紀錄與帳務設定 |
| `org:read` / `org:manage` | 讀取團隊 / 管理成員與設定 |
| `notifications:read` | 讀取與標記通知 |
| `reservations:manage` | 容量排隊預約 |
| `tickets:manage` | 開立支援工單 |

## 權限組合（presets）

| Preset | Scopes |
|---|---|
| `readonly` | `catalog:read`, `instances:read`, `profile:read`, `vault:read`, `billing:read`, `notifications:read` |
| `deploy` | `catalog:read`, `instances:read`, `instances:create` |
| `operator` | `instances:read`, `instances:manage`, `ports:manage` |
| `Upload token` | `vault:write` 而已 — 唯寫，設計給 CI；外洩也無法部署、無法花錢、無法讀取或下載 Vault |
| `full` | 所有 scope，**包含 `instances:exec`** |

> ⚠️ **`instances:exec` 是執行個體上的 root shell。** 它不給予 SSH 之外的新權限，但一把貼進 CI 的金鑰是可外洩的憑證。因此它有獨立 scope、除 `full` 外沒有任何 preset 包含它，且每次呼叫都寫入稽核紀錄（指令與結束碼；輸出不記錄）。**不要把 `instances:exec` 給共用或第三方自動化**；真的需要時另發一把專用金鑰。

> 💡 **最小權限**：部署機器人用 `deploy`；只讀用量的監控用 `instances:read` 一個 scope；停止 / 重啟 / 刪除用 `operator`；CI 上傳用 `Upload token`。

## API 金鑰永遠做不到的事（僅限瀏覽器登入）

| 動作 | 原因 |
|---|---|
| 新增 / 列出 / 刪除 SSH 金鑰 | 加一把 SSH 金鑰等於拿到帳號下**每一台**執行個體的 root，超出任何 scope |
| 改密碼、改 Email、刪帳號 | 帳號安全與復原 |
| 建立 / 刪除團隊 | 不可逆，無自動化需求 |
| 儲值（checkout） | 花錢且需互動式跳轉 |
| 執行個體指標警示（alerts） | 目前僅控制台 |
| 管理端 `/admin/*` | 使用者金鑰一律拒絕 |

遇到這些需求 → 請開發者到控制台操作，不要嘗試繞過。

## 舊金鑰與新 scope

Scope 檢查涵蓋整個 API（含 Vault、團隊、帳務、通知、預約）。較早發的金鑰沒有較新的 scopes（`vault:*`, `org:*`, `billing:read`, `notifications:read`, `reservations:manage`, `tickets:manage`, `profile:manage`），以前碰巧能用的呼叫現在會回 `403` 並指名缺哪個 scope。解法：控制台更新該金鑰的 scopes、`PATCH /api-keys/{id}`，或換發一把。

## 用 API 管理金鑰（需 `keys:manage`）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api-keys` | 列出：`id`, `name`, `keyPrefix`, `scopes[]`, `lastUsedAt`, `expiresAt`, `revokedAt`, `status` |
| POST | `/api-keys` | `{ "name": "ci-upload", "scopes": ["vault:write"], "expiresAt": "2026-12-31T00:00:00Z" }` → `201` `{ key, secret }`，`secret` 只此一次 |
| PATCH | `/api-keys/{id}` | 更新 `name` / `scopes` / `expiresAt` |
| POST | `/api-keys/{id}/rotate` | 換發新秘密，舊的立即失效 |
| DELETE | `/api-keys/{id}` | 撤銷（不影響瀏覽器登入） |

```bash
curl -fsS -X POST "$API/api-keys" -A "my-automation/1.0" \
  -H "Authorization: Bearer $GPUTW_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"ci-upload","scopes":["vault:write"]}'
```

> 💡 金鑰外洩 → 立刻 `rotate` 或 `DELETE`。撤銷金鑰不影響瀏覽器登入。

## 狀態碼速查

| 狀態 | `error` 內容（節錄） | 意思 |
|---|---|---|
| `401` | `Missing or invalid authorization header` | 沒帶 header 或格式錯 |
| `401` | `Invalid or expired API key` | 金鑰錯、已撤銷、已過期 |
| `403` | `API key missing required scope: …` | 有到達，但 scope 不夠 → 更新金鑰 scopes |
| `403` | `This endpoint is not available to API keys. Use a browser session.` | 路由不對 API 金鑰開放 → 控制台操作 |
| `403` | `Account is disabled` | 帳號停用 → 聯絡支援 |
| `403`（非 JSON） | Cloudflare `error code: 1010` | 沒帶 `User-Agent` |

## 相關文件

- [00 · 快速開始](./00-getting-started.md) ｜ [10 · 錯誤與除錯](./10-errors-and-troubleshooting.md)
- [`references/endpoints.md`](../references/endpoints.md) — 每個端點所需 scope
- 官方：https://gputw.ai/zh-TW/docs/api-keys
