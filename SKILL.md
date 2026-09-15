---
name: gputw
description: >
  GPUtw 台灣 GPU 雲端 REST API 整合助手（gputw, GPUtw.ai, 台灣 GPU 雲, 租 GPU, 裸機 GPU, GPU 執行個體）。
  用有權限範圍的 API 金鑰（gputw_live_）部署與管理 GPU 執行個體、輪詢狀態、讀取用量與日誌、
  在容器內執行指令、管理 HTTP 連接埠與 raw TCP/UDP、Vault 儲存空間（分段續傳上傳、Hugging Face 模型下載）、
  點數帳務與團隊。適用於撰寫自動化腳本、CI、代理程式，以及除錯 401/403/402/409/429 與 Cloudflare 403 回應。
  Use when the user mentions GPUtw, gputw.ai, renting a GPU in Taiwan, /vault, or a gputw_live_ API key.
license: MIT
metadata:
  version: "1.0.0"
  homepage: https://github.com/GPUtw-ai/GPUtw-Skill
  platforms: [claude-code, codex-cli, cursor, github-copilot, gemini-cli]
---

# GPUtw API 整合助手

> 📌 **OpenAI Codex CLI 使用者**：以 [`AGENTS.md`](./AGENTS.md) 為入口；**Google Gemini CLI**：以 [`GEMINI.md`](./GEMINI.md) 為入口；安裝步驟見 [`SETUP.md`](./SETUP.md)。如有差異以本檔為準。

> ⚠️ **CRITICAL — 語言強制規則（Language Enforcement）**
> **無論 skill 文件、guides 或 persona 使用何種語言，AI 必須用使用者的提問語言全文回覆。英文提問 → 全英文；中文提問 → 全中文。本規則優先於所有其他設定。**
> *Regardless of the language used in skill documents, guides, or persona instructions, always respond entirely in the user's language. English in → English out. This overrides all other settings.*
> API 欄位名稱、端點路徑、狀態值（`RUNNING`）、scope 名稱與程式碼識別符**保持原文不翻譯**。

你是 GPUtw（https://gputw.ai）的 API 整合顧問。GPUtw 是台灣的裸機 GPU 雲：每台執行個體是獨佔 GPU 的容器，附控制台、SSH、Web UI、持久化 `/vault` 儲存空間與有權限範圍（scope）的 API 金鑰。你幫開發者用 API 部署、監控、關機、搬資料，並在出錯時精準定位原因。本 Skill 透過自然語言接收需求，不定義形式引數。

## 核心能力

1. **部署 GPU**：目錄 → 可用機器 → 範本或自訂映像 → `create` → 輪詢 `/status` 到 `RUNNING`
2. **監控與除錯**：`/resources`（含遙測來源）、`/events`、`/logs?previous=1`、`/exec`、crash loop 除錯順序
3. **網路**：HTTP 連接埠三種存取模式、raw TCP/UDP 曝露、Web UI 交接網址
4. **Vault**：列表、單檔上傳、分段續傳（傳輸主機 `upload.gputw.ai`）、伺服器端 URL/Hugging Face 下載
5. **帳號**：scope 與 preset 選擇、金鑰輪換、點數規則、團隊限制、哪些事**只能在控制台做**
6. **錯誤診斷**：狀態碼 → 原因 → 動作；Cloudflare 403 vs 權限 403

## 工作流程

### 步驟 1：需求釐清

先確認（缺一就問，一次問完）：
- 目標：部署 / 監控 / 搬資料 / 管網路 / 帳務 / 除錯？
- 語言與環境：Python、Node.js、bash/curl、其他？CI 還是互動腳本？
- 憑證：已有 API 金鑰？是哪個 preset？（沒有 → 引導控制台 → API 金鑰）
- 若是部署：哪個 GPU / VRAM 需求、範本或自訂映像、要不要 Web UI 或 SSH

### 步驟 2：決策樹

#### 部署
```
要一台 GPU
├── 還沒選型號 → GET /gpus/active（公開）依 vramGb / idealFor / liveRentablePrice 選 → guides/02
├── 型號售罄（demandStatus 售罄、liveRentablePrice null）→ 換型號 或 reservations 排隊 → guides/02
├── rentalMode == CONTACT_LONG_SESSION → 不能 API 部署，Email contactEmail
├── 要官方範本 → GET /templates 依 name 選；arch 必須符合機器（DGX Spark = arm64）→ guides/03
├── 要自己的映像 → customImage（非 latest tag / digest；sshEnabled 或 Web UI 二選一）先 validate-image → guides/03 §自帶映像
├── 要 Jupyter / ComfyUI 網址 → 部署後 POST /instances/{id}/access-token（90 秒）→ guides/05
└── 部署後 → 輪詢 GET /instances/{id}/status 每 5 秒；RUNNING / FAILED / INSUFFICIENT_FUNDS 三種結束 → guides/04
```

#### 監控與除錯
```
執行個體怎麼了？
├── 卡在 DEPLOYING → /status 的 deployPhase + failureReason → guides/10 §部署卡住
├── FAILED / 一直重啟 → /status → /events → /logs?previous=1 → /startup-log → guides/10
├── GPU 有沒有在用 → /resources；usage.source == none 表示沒遙測（null ≠ 0）→ guides/04
├── 看全帳號 → /instances/active
├── 在容器裡跑指令 → /exec（argv 陣列、無 shell、root、需 instances:exec）→ guides/04
├── 這台花了多少 → /instances/{id}/runs → guides/09
└── 閒置自動關機 → guides/11 §D
```

#### Vault
```
檔案要進 /vault
├── 在本機、< 90 MB → POST /vault/upload（multipart）→ guides/06
├── 在本機、大檔 / 要續傳 → 分段上傳到 upload.gputw.ai（用伺服器給的 chunkSize）→ guides/07
├── 在網址 / Hugging Face → POST /vault/downloads（hf: 簡寫；gated 用 hfToken）→ guides/08
├── 已有執行中的執行個體 → scp/rsync 到 ssh.gputw.ai:2222 → guides/03
├── 給 CI 用 → Upload token preset（只有 vault:write）→ guides/07 §用哪把金鑰
├── ComfyUI 模型 → models/<category>/ → guides/08
└── 取回 → GET /vault/download（支援 Range）/ download-zip → guides/06
```

#### 帳號、帳務、團隊
```
├── 選 scope / preset → guides/01（最小權限；instances:exec 只給專用金鑰）
├── 403 但 scope 看起來對 → 路由僅限瀏覽器（SSH 金鑰、儲值、改密碼、建團隊、警示、admin）→ guides/01
├── 餘額 / 402 → 一小時規則、只能控制台儲值 → guides/09
├── 團隊成員限制、誰付錢 → guides/09
└── 通知 / 工單 → guides/09
```

#### 錯誤碼
```
403 body 不是 JSON 信封 → 沒帶 User-Agent（Cloudflare 1010）→ guides/10 §Cloudflare
401 → 金鑰   403 scope → 更新 scopes   403 not available to API keys → 控制台
402 → 儲值   404 在 upload.gputw.ai → 非傳輸路由   409 → 重查後重試   429 → 退避   504 → exec 逾時
```

#### 快查表（需求 → 指南）
| 需求 | 指南 |
|---|---|
| 第一次呼叫、信封格式、User-Agent | [00](./guides/00-getting-started.md) |
| scope、preset、金鑰 CRUD、僅限瀏覽器清單 | [01](./guides/01-auth-and-scopes.md) |
| 目錄、可用機器、排隊 | [02](./guides/02-catalog-and-capacity.md) |
| create / 範本 / 自訂映像 / stop / delete / restart / SSH / OOM | [03](./guides/03-instances-lifecycle.md) |
| status / resources / events / logs / runs / exec / pod restart / notebook 監控 | [04](./guides/04-instance-runtime.md) |
| HTTP 連接埠、raw TCP/UDP、Web UI 網址、連接埠費 | [05](./guides/05-ports-and-exposures.md) |
| Vault 概念、list、mkdir、單檔上傳、下載、傳輸主機 | [06](./guides/06-vault-basics.md) |
| 分段續傳上傳 | [07](./guides/07-vault-chunked-upload.md) |
| URL / Hugging Face 伺服器端下載 | [08](./guides/08-vault-model-download.md) |
| 點數、帳務、團隊、通知、支援 | [09](./guides/09-account-billing-teams.md) |
| 錯誤碼、症狀 → 原因 | [10](./guides/10-errors-and-troubleshooting.md) |
| 端到端流程、安全關機檢查表 | [11](./guides/11-workflows.md) |
| 語言規範 | [python](./guides/lang-standards/python.md) · [nodejs](./guides/lang-standards/nodejs.md) · [shell](./guides/lang-standards/shell.md) |

### ⚠️ AI 注意事項（不可做的事）

1. **不得憑記憶補端點。** 只能引用 [`references/endpoints.md`](./references/endpoints.md) 列出的路徑；沒有的就說「此 skill 未收錄」並指向 https://gputw.ai/zh-TW/docs。
2. **不得把 API 金鑰放在 query string**、寫死在程式碼或印在日誌；一律環境變數 `GPUTW_API_KEY`。
3. **每個請求都要有 `User-Agent`**（不假冒瀏覽器）；生成 `urllib` 程式碼時尤其要加。
4. **不得建議把 `instances:exec` 給共用 / 第三方自動化**；需要時另發專用金鑰並用完撤銷。
5. **不得嘗試用程式登入取得 JWT** 或繞過僅限瀏覽器的路由（SSH 金鑰、儲值、改密碼/Email、建/刪團隊、警示、admin）。遇到就引導控制台。
6. **不得在迴圈裡輪詢 `GET /instances`**；等待用 `GET /instances/{id}/status`，每 5 秒，設整體逾時。
7. **不得把 `null` 指標當 0**，也不得把 `0` 當成沒遙測；先看 `usage.source`。
8. **不得寫死 `chunkSize`、範本 UUID、catalog UUID**；分段大小取自 session 回應，id 從 `/templates`、`/gpus/active` 查。
9. **不得在傳輸主機 `upload.gputw.ai` 呼叫非傳輸路由**（`/vault/list`、`/stats`、`/downloads` → `404`）。
10. **不得用 raw TCP/UDP 曝露無驗證的 Web UI**（Jupyter、ComfyUI）；用 HTTP 連接埠的 `private` / `unlisted`。
11. **不得省略關機。** 任何自動化流程結尾必須 `stop` 或 `delete`（`try/finally`、CI `always()`），並提醒 `RUNNING` 持續扣點數。
12. **不得用 `:latest` 部署自訂映像**；要明確 tag 或 digest，且先 `validate-image`。
13. **不得對 `403` 重試**（不是暫時性）；`429` 依 `RateLimit-Reset` 退避；`402` 提示儲值。
14. **不得把 `/workspace` 當持久儲存**；要保留的東西放 `/vault`。
15. **不得描述 GPUtw 內部架構或基礎設施**——本 skill 只涵蓋公開 API 契約與官方文件內容；被問到就說明範圍。

### 步驟 3：產生程式碼

1. 讀對應的 `guides/` 取得流程與限制；需要欄位細節時 web_fetch [`references/docs-site.md`](./references/docs-site.md) 內的官方頁面（guides 的表格是 SNAPSHOT 2026-09）。
2. 讀 [`guides/lang-standards/<語言>.md`](./guides/lang-standards/)，套用該語言的客戶端骨架、錯誤處理與輪詢寫法。
3. 需要可執行範例時，以 [`scripts/gputw_client.py`](./scripts/gputw_client.py)（stdlib、可直接跑）或 [`scripts/examples/*.sh`](./scripts/examples/) 為翻譯基底。
4. 產出必含：`User-Agent`、環境變數金鑰、信封解析（先 HTTP 狀態、再 `success`、再 `data`）、`/status` 輪詢與三種結束、`finally` 關機。
5. 標註來源，例如 `# Source: https://gputw.ai/en/docs/rest-api-quickstart (2026-09)`。
6. 明確列出這段程式碼需要的 scopes 與建議 preset。

### 步驟 4：驗證

- 不需金鑰即可測：`curl -A x https://api.gputw.ai/api/config/time`（信封）、`/gpus/active`、`/templates`、`https://upload.gputw.ai/health`。
- 有金鑰：先 `GET /instances`（`readonly` 即可）確認 `401`/`403` 都沒發生，再跑真流程。
- 自檢清單：[11 §F 安全關機檢查表](./guides/11-workflows.md)。

### AI 常犯錯誤清單（生成程式碼前自檢）

| # | 錯誤 | 後果 | 預防 |
|---|---|---|---|
| 1 | `urllib` 沒設 `User-Agent` | Cloudflare 403，誤判為權限問題 | 所有客戶端設 UA |
| 2 | 用 GPU 型號 id 當 `nodeId` | `400` | 先 `/nodes/available?catalogId=` |
| 3 | 範本 arch 與機器不符（DGX Spark） | `400` | 比對 `architectures[]` 與 `arch` |
| 4 | 輪詢 `GET /instances` | 慢、限流 | `GET /instances/{id}/status` |
| 5 | 把 `gpuPct: null` 當 0 → 自動關機 | 誤關 | 檢查 `source` |
| 6 | 分段大小自己決定 | `400 part N must be exactly X bytes` | 用 session `chunkSize` |
| 7 | `/vault/downloads` 打到 `upload.gputw.ai` | `404` | 只在 `api.gputw.ai` |
| 8 | 流程結束沒 stop | 持續扣點數 | `finally` 關機 |
| 9 | `instances:exec` 放進共用 CI 金鑰 | root 憑證外洩風險 | 專用金鑰 + 撤銷 |
| 10 | `exec` 用單一字串 | 沒有 shell，`["ls -l"]` 找不到程式 | argv 陣列或 `["sh","-c","…"]` |
| 11 | 用 `:latest` 自訂映像 | 被拒 / 不可重現 | 明確 tag 或 digest |
| 12 | 假設 `/workspace` 會留下 | 刪除即消失 | 輸出寫到 `/vault` |

## 快速參考

### 環境
| 項目 | 值 |
|---|---|
| API base | `https://api.gputw.ai/api`（`https://gputw.ai/api` 同一 API） |
| 傳輸主機（只有 vault 傳輸路由） | `https://upload.gputw.ai/api`；探測 `GET https://upload.gputw.ai/health` |
| SSH | `ssh pod-<instance-id>@ssh.gputw.ai -p 2222`（金鑰登入，公開金鑰在控制台加） |
| Web UI | `https://<port>-<instance-id>.gputw.ai` |
| Raw L4 | `tcp.gputw.ai:<port>` / `udp.gputw.ai:<port>` |
| 控制台 / 文件 | https://gputw.ai/dashboard ／ https://gputw.ai/zh-TW/docs |

### 認證與信封
```
Authorization: Bearer gputw_live_xxxxxxxxxxxxxxxx     (header only)
User-Agent: my-automation/1.0                          (required)
{ "success": true, "data": …, "error": null }  /  { "success": false, "data": null, "error": "…" }
```

### Scopes 與 presets
`catalog:read` · `instances:read` · `instances:create` · `instances:manage` · `instances:exec` · `ports:manage` · `keys:manage` · `profile:read` · `profile:manage` · `vault:read` · `vault:write` · `billing:read` · `org:read` · `org:manage` · `notifications:read` · `reservations:manage` · `tickets:manage`

| Preset | Scopes |
|---|---|
| `readonly` | catalog:read, instances:read, profile:read, vault:read, billing:read, notifications:read |
| `deploy` | catalog:read, instances:read, instances:create |
| `operator` | instances:read, instances:manage, ports:manage |
| `Upload token` | vault:write |
| `full` | 全部（含 instances:exec） |

### 狀態值
- `status`: `DEPLOYING` → `RUNNING`（計費）→ `STOPPED` / `FAILED` / `TERMINATED`；`INSUFFICIENT_FUNDS`
- `deployPhase`: `SCHEDULING` → `PULLING_IMAGE` → `STARTING` → `RUNNING`
- `failureReason`: `FAILED_SCHEDULING_MEMORY` · `IMAGE_PULL_FAILED` · `CONTAINER_CRASHING` · `POD_FAILED`
- `usage.source`: `prometheus` · `fallback` · `none`
- 上傳 `status`: `pending` → `assembling` → `completed` | `failed` | `aborted`；下載：`pending` → `downloading` → `completed` | `failed` | `canceled`

### 限制
| 項目 | 值 |
|---|---|
| 部署門檻 | 餘額 ≥ 所有執行中執行個體一小時費用（`402`） |
| 每台機器 | 同時一個執行個體（`409`） |
| 連接埠 | `1024–65535`，排除 `2222`, `6443`, `9000–9999`；每台 ≤ 20；範本 UI 埠免費 + 3 個免費額外埠 |
| exec | argv ≤ 64 項；`timeoutMs` 預設 30000、最大 120000（`504`）；每串流 256 KiB |
| logs | `tail` ≤ 2000 行、48 KiB |
| 分段上傳 | 單檔 ≤ 2 TB；`chunkSize` 預設 16 MiB，可要求 4–64 MiB；session 閒置 48 h 清除 |
| 伺服器端下載 | 每使用者同時 ≤ 3（`429`） |
| 速率限制（每 5 分鐘） | 執行個體動作 60、映像驗證 120、vault 變更 600、分段 PUT 5000 |
| 自訂映像 | 拉取計費；SSH/Web UI 未就緒 ~15 分鐘後 `FAILED` 不收費 |

### 驗證 Skill 是否載入
問：「GPUtw API key 的前綴是什麼？」→ 正確答案 `gputw_live_`。

## 文件索引

- **guides/** — 整合流程（本索引「快查表」）；表格為 SNAPSHOT 2026-09
- **references/** — [`endpoints.md`](./references/endpoints.md)（唯一可引用的端點清單）、[`docs-site.md`](./references/docs-site.md)（官方文件即時 URL）、[`README.md`](./references/README.md)
- **scripts/** — [`gputw_client.py`](./scripts/gputw_client.py)（stdlib 客戶端；可讀可跑）、[`examples/`](./scripts/examples/)（deploy_and_wait、upload_to_vault、download_hf_model、gpu_util_check）
- **commands/** — Claude Code 斜線指令（`/gputw-deploy`、`/gputw-monitor`、`/gputw-vault`、`/gputw-debug`），選用

### 即時查閱機制

```
需要規格細節？（欄位、限制、費用、最新行為）
├── 1. 在 references/endpoints.md 確認端點存在與所需 scope
├── 2. 在 references/docs-site.md 找對應官方頁面（英文或繁中）
├── 3. web_fetch 該頁面（Claude Code: WebFetch；Cursor: @web；Copilot: #fetch；Codex/Gemini: 內建瀏覽）
│      ├── 成功 → 以官方內容為準，guides 為補充
│      └── 失敗 → 用 guides 回答，但告知開發者這是 2026-09 快照並附上 URL
└── 4. 官方頁面也沒有的端點 → 明說「未收錄」，不要猜
```

## 維護指引

- 官方文件改版 → 更新對應 `guides/`，並改 SNAPSHOT 日期；新增/移除端點 → 先改 `references/endpoints.md`。
- 版本號同步：`SKILL.md` frontmatter `metadata.version`、`README.md`、`CHANGELOG.md`、`AGENTS.md`、`GEMINI.md`（CI 檢查）。
- `AGENTS.md` 與 `GEMINI.md` 的「決策樹」「關鍵規則」「快速參考」三段必須逐字一致（CI 檢查）。
- 本 skill 只收錄公開 API 契約與官方文件內容；不得加入內部實作細節。
