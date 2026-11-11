# 03 · 執行個體生命週期：部署、狀態、停止、重啟、刪除

> SNAPSHOT 2026-11 ｜ 來源：https://gputw.ai/en/docs/rest-api-quickstart 、/instances 、/templates 、/instance-status-oom 、/ssh-access 、公開 Instance runtime API 文件 ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

## 狀態機

```
POST /instances/create
        │
        ▼
   DEPLOYING ──(deployPhase: SCHEDULING → PREPARING → STARTING → RUNNING)──────▶ RUNNING ◀──┐
        │                                                                          │        │
        │ 失敗（failureReason）                                    POST /stop       │        │ POST /{id}/restart
        ▼                                                                          ▼        │
     FAILED ◀──────────────────────────────────────────────────────────────── STOPPED ──────┘
        │                                                                          │
        └──────────────────── POST /instances/delete ──────────────────────────────┴──▶ TERMINATED

     INSUFFICIENT_FUNDS：餘額不足以支付下一個計費小時 → 儲值後重啟
```

| 狀態 | 計費 | 可做的事 |
|---|---|---|
| `DEPLOYING` | 自訂映像從拉取開始計；範本部署成功後才開始 | 輪詢 `/status`；可 `stop` / `delete` |
| `RUNNING` | **計費中** | exec、ports、exposures、pod restart、stop、delete、reconfigure |
| `STOPPED` | 不計費；`/workspace` 已刪除 | restart（同機或換機）、reconfigure、delete |
| `FAILED` | 不計費（部署逾時不收費） | 讀 `/logs?previous=1`、`/events`、startup log；restart / delete |
| `TERMINATED` | 不計費 | 不再出現在 `GET /instances` |
| `INSUFFICIENT_FUNDS` | 已暫停 | 儲值（控制台）後重啟 |

**維護中**：執行個體物件的 `maintenanceSince` 不為 `null` 代表它所在的機器正在維修。這段期間**不計費、資料保留**，修好後自動恢復；停止 / 刪除 / 重啟 / 重新設定 / `exec` 等操作會回 `409 This instance is under maintenance…`，等它恢復即可，不要換機重建。

> ⚠️ **執行個體保持 `RUNNING` 就一直扣點數。** 任何自動化流程結束時都要 `stop` 或 `delete`（見 [11 · 安全關機檢查表](./11-workflows.md)）。

## `POST /instances/create`（`instances:create`）

```bash
curl -fsS -X POST "$API/instances/create" -A "my-automation/1.0" \
  -H "Authorization: Bearer $GPUTW_API_KEY" -H "Content-Type: application/json" \
  -d '{"nodeId":"<node-id>","bandwidthMbps":100,"templateId":"<template-id>","ports":[8080]}'
```

### 請求欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `nodeId` | ✅ | 來自 `GET /nodes/available`（[02](./02-catalog-and-capacity.md)） |
| `templateId` ｜ `template` ｜ `customImage` | 三選一 | 範本 UUID ｜ 範本的 `dockerImage` 字串（例 `gputw/pytorch:latest`）｜ 自帶映像物件（見下） |
| `bandwidthMbps` | 選填 | 必須是 `GET /config/deploy` 的 `bandwidthOptions` 之一（目前 `100` 內含、`400` 付費）；省略 = 內含值 |
| `shmSizeGb` | 選填 | `/dev/shm` 大小，不可超過執行個體 RAM |
| `ports` | 選填 | 要開的 HTTP 連接埠陣列（`1024–65535`，排除 `2222`, `6443`, `9000–9999`；每台最多 20 個） |
| `name` | 選填 | 顯示名稱，≤ 40 字（例 `training-1`）。省略 → 伺服器給下一個空的 `GPU 1`、`GPU 2`…（刪掉 `GPU 2` 後這個號碼會被重用）。純標籤，**不能當冪等鍵**，也不影響 SSH 使用者名稱（仍是 `pod-<id>`） |
| `autoStopHours` ｜ `autoStopAt` | 選填，二選一 | 自動停止計時器：幾小時後（數字，可帶小數）或 ISO 8601 時間（含時區）。必須在 **10 分鐘後到 30 天內**。見下方 §自動停止 |

回應 `201`，`data` 是執行個體的基本欄位：`id`, `nodeId`, `status`（`DEPLOYING`）, `hourlyRate`, `gpuCount`, `cpuCores`, `ramGb`, `diskSizeGb`, `shmSizeGb`, `bandwidthMbps`, `template`（範本或自訂映像的映像參考）, `isByoImage`, `allowedPorts[]`, `portAccess`, `createdAt`。`node{…}`, `exposures[]`, `computeHourlyRate`, `webUiEnabled` / `webUiPort` 與 `deployPhase` 要用 `GET /instances/{id}` 取得。

### 範本（`GET /templates`，公開）

| `name` | `dockerImage` | Web UI | 架構 |
|---|---|---|---|
| PyTorch 2.x + JupyterLab | `gputw/pytorch:latest` | ✅ 8080 | amd64 |
| Jupyter Lab | `gputw/jupyter:latest` | ✅ 8080 | amd64 |
| ComfyUI | `gputw/comfyui:latest` | ✅ 8080 | amd64 |
| Ollama + Open WebUI | `gputw/ollama:latest` | ✅ 8080 | amd64 |
| vLLM Inference Server | `gputw/vllm:latest` | — (8080) | amd64 |
| llama.cpp Server | `gputw/llama-cpp:latest` | — (8080) | amd64 |
| Unsloth Fine-Tuning Notebook | `gputw/unsloth-notebook:latest` | ✅ 8080 | amd64 |
| Ubuntu 22.04 Base / + CUDA 12 | `gputw/ubuntu-base:latest`, `gputw/cuda12-dev:latest` | — | amd64 |
| DGX Spark 系列（Base / PyTorch / vLLM / llama.cpp / ComfyUI / Unsloth / Ollama） | `gputw/dgx-spark-*:latest` | 依範本 | **arm64** |

清單會變動——生成程式碼時請實際呼叫 `GET /templates` 依 `name` 或 `category` 挑選，不要寫死 UUID。`architectures[]` 必須包含目標機器的 `arch`；`minComputeCapability` 高於機器的 GPU 會被拒絕（`400`）。

### 自帶映像 `customImage`

```json
{
  "nodeId": "<node-id>",
  "bandwidthMbps": 100,
  "customImage": {
    "dockerImage": "ghcr.io/acme/trainer:1.4.2",
    "registryAuth": { "registry": "registry.example.com", "username": "<user>", "password": "<token>" },
    "sshEnabled": true,
    "webUiEnabled": true, "webUiLabel": "My App", "webUiPort": 8080,
    "env": [{ "name": "HF_TOKEN", "value": "hf_xxx" }],
    "args": ["--port", "8080"]
  },
  "ports": [8080]
}
```

| 欄位 | 規則 |
|---|---|
| `dockerImage` | 必填。**明確的非 `latest` tag 或 `sha256` digest**；Docker Hub、GHCR 或任何 registry |
| `registryAuth` | 私有 registry 才填；平台轉成短期拉取憑證，執行個體停止 / 失敗 / 終止時刪除 |
| `sshEnabled` | `true` → 以 `root` 登入、帳號 SSH 金鑰自動注入；映像沒有 SSH server 會在啟動時安裝（映像須以 root 執行且有 apk/apt/dnf/yum/zypper） |
| `webUiEnabled` + `webUiLabel` + `webUiPort` | 宣告瀏覽器 UI；`webUiPort` 必須 `1024–65535`（在 80 監聽的 nginx 要改成高埠） |
| `env[]` | 最多 32 個，名稱符合 `[A-Za-z_][A-Za-z0-9_]*`；保留名 `PUBLIC_KEY`, `GATEWAY_KEY`, `NVIDIA_VISIBLE_DEVICES`, `NVIDIA_DRIVER_CAPABILITIES` 會被拒絕 |
| `args[]` | 最多 64 個字串；**取代 `CMD`，保留 `ENTRYPOINT`** |
| 限制 | 必須 `sshEnabled` 或宣告 Web UI 至少一項；不可與 `templateId` / `template` 同時使用 |

> ⚠️ 自訂映像：拉取時間計入計費。若宣告的 Web UI 埠（沒有 Web UI 時為 SSH 的 `22`）一直連不上，部署逾時 `FAILED`。失敗時讀 `GET /instances/{id}/startup-log`、`/logs?previous=1` 與 `/events`。

### 自訂映像的就緒判定

| 項目 | 契約 |
|---|---|
| 判定方式 | **TCP 連線**：宣告 Web UI 時檢查 `webUiPort`（同時開 SSH 也只檢查 Web UI 埠）；只開 SSH 時檢查 `22` |
| HTTP 細節 | 自訂映像**不做** HTTP 檢查：沒有 method、path、狀態碼，也不帶任何認證。埠能接受連線就算就緒 |
| 就緒之後 | 狀態轉 `RUNNING`，**開始計費** |
| 逾時起點 | 約 15 分鐘的就緒時窗從**容器開始執行**算起，不含排程與拉取映像。自訂映像的拉取另有較長的時窗（約 45 分鐘），拉取時間計費 |
| 早期失敗 | 拉取失敗、排程失敗、容器崩潰會提早 `FAILED`，不計費 |

實務建議：
- 讓程序**一啟動就監聽 `webUiPort`**，即使模型還沒載入。不需要回 200；能接受 TCP 連線就夠了。若同一埠也提供內容，載入前回一頁不含模型、設定或憑證的狀態頁即可。
- Web UI 埠預設 `private`（經 GPUtw 擁有者驗證的代理），不會公開。
- **不要在容器裡下載數小時的權重**：`RUNNING` 期間持續計費。先用 `POST /vault/downloads`（不需執行個體）把權重放進 `/vault`，容器啟動後直接從 `/vault` 載入。

## 建立復原：`create` 沒有冪等鍵

`POST /instances/create` **不支援** idempotency key 或 client request ID，也沒有 label / metadata / name 欄位（不認得的欄位會被直接忽略）。`customImage.env` 與 `args` 會注入容器，但 **`GET /instances` 與 `GET /instances/{id}` 不會回傳**，所以不能拿環境變數當伺服器端可查的標記。重送一次失敗回應的 `create` 可能建立**第二個**執行個體。

回應遺失（逾時、斷線）時的對帳流程：
1. 送出前在本地記錄 `nodeId`、映像參考與送出時間。
2. 回應遺失時**不要立刻重送**，改呼叫 `GET /instances`。這份清單是**完整**的：帳號下所有非 `TERMINATED` 的執行個體，依 `createdAt` 新→舊排序，**不分頁、無篩選參數**，包含 `DEPLOYING` 與 `FAILED`。
3. 找出 `nodeId` 相符、`template` 等於你的映像參考、`isByoImage == true`，且 `createdAt` 不早於送出時間（容許時鐘誤差）的項目。找到就採用它的 `id`；找不到才重送。
4. 若有多個候選（例如同一機器、同一映像併發部署），保留最新的一個，其餘 `POST /instances/delete`。

要在容器內辨識自己是哪一次部署：用 `env` 注入你自己的部署 UUID，並由你的程序回報（例如透過 Web UI 端點）。這只在容器執行後可讀；`DEPLOYING` / `FAILED` 期間請以上面的伺服器端欄位對帳。

## 工作區磁碟（`/workspace`）

- `diskSizeGb`（執行個體）與 `rentableStorageGb`（機器）單位都是 **GiB**（2³⁰ bytes），欄位名寫 `Gb` 是歷史命名。
- 大小**由所選機器與租用份額決定**，`create` 與 `PUT /instances/{id}` 都不能指定。
- 限制涵蓋 `/workspace` **加上**容器寫在其他位置的資料（`/tmp`、`/root`、pip / conda 安裝等）；映像本身的唯讀層**不計入**。另有少量緩衝，但請以 `diskSizeGb` 為規劃上限，範本與自訂映像相同。
- 寫超過時寫入失敗（`ENOSPC` / `EDQUOT`），執行個體繼續執行。但請把它當硬上限：部分機器上超額仍可能讓執行個體停止，寫不進去的程序也可能自己崩潰。要保留的東西放 `/vault`。
- `df` 看到的是整台機器的檔案系統，不是你的上限。`GET /instances/{id}/resources` 只回報 `allocated.diskSizeGb`，**沒有磁碟用量欄位**；執行個體物件的 `diskUsedGb` / `diskLimitGb` 是定期快照（見 [04](./04-instance-runtime.md) §工作區磁碟用量）。要即時的數字，在容器內自己量（例如 `du -sb /workspace`），並與 `diskSizeGb × 2³⁰` 比較；`du` 不計入容器其他可寫路徑，請保留餘裕。

先用 `POST /instances/validate-image`（`instances:create`）檢查映像可否拉取：`{ "dockerImage": "…", "registryAuth": {…} }` → `{ ok: true, digest, platforms[] }` 或 `{ ok: false, reason: "invalid_reference"|"unauthorized"|"not_found"|"unreachable", message }`。

### `create` 的常見錯誤

| 狀態 | `error`（節錄） | 處理 |
|---|---|---|
| `402` | `Insufficient credits to cover one hour of your total running instances` | 控制台儲值；注意是**所有**執行中執行個體的一小時總和 |
| `409` | `This machine has no free GPUs right now…` / `Not enough free GPUs on this machine…` | 重新查 `/nodes/available` 換機器 |
| `403` | `Instance limit reached…` | 帳號執行個體數上限；刪除不用的（`STOPPED` / `FAILED` 也算） |
| `400` | `Auto-stop time must be at least 10 minutes from now` / `…within 30 days` / `Send autoStopAt or autoStopHours, not both` | 修正計時器 |
| `503` | `Selected node is not available` | 機器下線 / 維護 → 換機器 |
| `400` | `Reserved or invalid port(s)…` / `Too many ports — max 20 per instance` | 修正 `ports` |
| `400` | `"<template>" requires a newer GPU (compute capability ≥ N)` | 換範本或換 GPU |
| `400` | `Custom image must enable SSH or declare a Web UI port` | 補 `sshEnabled` 或 `webUiEnabled`+`webUiPort` |
| `403` | `Deploys are suspended by your organization owner` | 團隊擁有者暫停了該成員的部署 |
| `404` | `Template not found` | 用 `GET /templates` 的 `id` |

## 等待 `RUNNING`

用 **`GET /instances/{id}/status`**（輕量，專為輪詢設計），每 5 秒一次；不要輪詢 `GET /instances`。詳見 [04](./04-instance-runtime.md)。`status` 與 `podPhase` 不一致時就是出問題的時候；`failureReason` 會給 `FAILED_SCHEDULING_MEMORY` / `IMAGE_PULL_FAILED` / `CONTAINER_CRASHING` / `POD_FAILED`。

## 停止、刪除、重啟、重新設定（`instances:manage`）

| 動作 | 呼叫 | 條件 / 效果 |
|---|---|---|
| 停止 | `POST /instances/stop` `{ "instanceId": "…" }` | 任何狀態（`TERMINATED` 除外）；停止計費、保留紀錄與設定可重啟。**容器移除、`/workspace` 刪除**，只有 `/vault` 留下 |
| 刪除 | `POST /instances/delete` `{ "instanceId": "…" }` | 終止並移除紀錄；`/workspace` 消失、`/vault` 不受影響 |
| 重啟 | `POST /instances/{id}/restart` `{ "mode": "same" }` 或 `{ "mode": "alternative", "nodeId": "…" }`（可加 `templateId`/`template`, `bandwidthMbps`, `shmSizeGb`） | 須 `STOPPED` / `FAILED`；`alternative` 會建立**新**執行個體（`201`）。先用 `GET /instances/{id}/restart-options` 看原機是否可用與替代方案；此端點也接受 `instances:create` |
| 重新設定 | `PUT /instances/{id}` `{ "templateId"?, "template"?, "customImage"?, "bandwidthMbps"?, "shmSizeGb"? }` | 須 `RUNNING`/`STOPPED`/`FAILED`；重建容器。見下方 §原地換成自訂映像 |
| 改名 | `PATCH /instances/{id}/name` `{ "name": "llama-finetune" }` | 任何狀態；≤ 40 字（超過 → `400 Name must be at most 40 characters`）；`""` 重設為下一個 `GPU N` |
| 容器重建 | `POST /instances/{id}/pod/restart` | 以相同映像與連接埠重建容器；**`/workspace` 會清空**。自訂映像不適用（憑證已清除，改用 `PUT` 指定範本或重新部署） |

停止/刪除已終止的執行個體 → `400 Instance already terminated`。

### 原地換成自訂映像：`PUT /instances/{id}` + `customImage`

```bash
curl -X PUT "$API/instances/<id>" -A my-automation/1.0 \
  -H "Authorization: Bearer $GPUTW_API_KEY" -H "Content-Type: application/json" \
  -d '{"customImage":{"dockerImage":"docker.io/acme/trainer:v3","sshEnabled":true}}'
```

- `customImage` 與 `create` 的物件完全相同（[§自帶映像](#自帶映像-customimage)）；不能和 `templateId` / `template` 同時給。
- 執行中的機器在**同一台**重新部署，**不會**先停止，所以 GPU 一直保留給你（`RUNNING` → `DEPLOYING` → `RUNNING`）。以前要先 stop，而 stop 會把 GPU 釋放給下一個人。
- 容器會重建：`/workspace`、`/home`、`/root` 不保留（同停止），`/vault` 保留。
- 需要 `instances:manage` **加** `instances:create`（缺 → `403 API key missing required scope: instances:create …`）。
- 拉取計費同自訂映像部署：成功不另收；45 分鐘內沒起來會收部署中的時間。映像起不來 → `FAILED` 且 GPU 釋放，所以先 `POST /instances/validate-image`。
- 反過來用 `templateId` 換回官方範本時，存著的 registry 憑證會一併刪除。

### 批次刪除已停止的機器：`POST /instances/delete-stopped`（`instances:manage`）

清掉佔著執行個體數上限的 `STOPPED` / `FAILED` 紀錄。

```bash
# 全部（一次最多 100 台，由舊到新）
curl -X POST "$API/instances/delete-stopped" -A my-automation/1.0 \
  -H "Authorization: Bearer $GPUTW_API_KEY" -H "Content-Type: application/json" -d '{}'
# 指定幾台
  -d '{"instanceIds":["<id-1>","<id-2>"]}'
```

回傳 `{ "deleted": [...], "skipped": [{ "id", "reason" }] }`；`reason` 為 `NOT_STOPPED` 表示那台不是 `STOPPED` / `FAILED`（或不屬於你），**不會**被刪。`RUNNING` 的機器永遠不會被這個端點刪除。

## 自動停止（`instances:manage`）

給執行個體一個「時間到就停止」的計時器——腳本當掉、對話中斷、忘了關都不會一直燒錢。

| 做法 | 呼叫 |
|---|---|
| 建立時設定 | `POST /instances/create` 加 `"autoStopHours": 4` 或 `"autoStopAt": "2026-11-20T18:00:00+08:00"` |
| 之後設定 / 改時間 | `PATCH /instances/{id}/auto-stop` `{ "autoStopAt": "<ISO>" }` |
| 延長 | `PATCH /instances/{id}/auto-stop` `{ "extendHours": 1 }` |
| 取消 | `PATCH /instances/{id}/auto-stop` `{ "autoStopAt": null }` |

- 時間必須在 **10 分鐘後到 30 天內**；`autoStopAt` 與 `autoStopHours` 不能同時給（`400`）。
- 只能對 `RUNNING` / `DEPLOYING` 設定，其他狀態 → `409 Auto-stop can only be set on a running or deploying instance`。
- 目前的設定在執行個體物件的 `autoStopAt`（`null` = 沒有計時器）。停止前 30 分鐘與 5 分鐘會通知使用者。
- 時間到時是**停止**（不是刪除），效果與 `POST /instances/stop` 相同：`/workspace` 清空、只留 `/vault`、紀錄保留。
- 工作一跑完就要關：在容器內用 `gputw-shutdown`（見 [04](./04-instance-runtime.md) §從容器內關機），計時器當保險。

> 🤖 **給 AI**：替使用者部署、而對方沒說要長時間開著時，建議帶 `autoStopHours` 當安全網，並在回覆中說明時間到會停止、`/workspace` 會清空。

## 連結式 DGX 群組租用：`POST /instances/linked`（`instances:create`）

整組 DGX Spark 一起租（找群組見 [02](./02-catalog-and-capacity.md) §連結式 DGX 群組）。

```json
POST /instances/linked
{ "groupId": "<link-offers 的 id>", "templateId": "<arm64 的 DGX Spark 範本>", "bandwidthMbps": 100 }
```

- `size` 選填：省略 = 整組；3 台的群組若也以 2 台方案販售，可給 `"size": 2`。
- 範本 / `customImage` / `bandwidthMbps` / `shmSizeGb` / `ports` 與 `create` 相同（每台套用同一份）；不需要 `nodeId`。
- **全有或全無**：任何一台起不來，整單取消，不會留下半組。
- 回傳 `201 { rentalId, groupId, instances[] }`；每台都是一般的執行個體，用 `/instances/{id}/status` 各自輪詢、各自 stop / delete。
- `GET /instances/linked/{rentalId}`（`instances:read`）→ `{ rentalId, size, linkState, members[{ instanceId, status, rank, address }] }`。
- 每台容器內有 `GPUTW_LINK_NNODES`, `GPUTW_LINK_RANK`, `GPUTW_LINK_ADDR`, `GPUTW_LINK_PEERS`, `MASTER_ADDR`, `MASTER_PORT` 等環境變數，可直接給 `torchrun --nnodes=$GPUTW_LINK_NNODES --node_rank=$GPUTW_LINK_RANK --master_addr=$MASTER_ADDR --master_port=$MASTER_PORT` 使用。
- 錯誤：`409 This linked group is not free right now` / `Someone is renting this linked group right now…` → 稍後再查 `link-offers`；`404 Linked group not available`。

> ⚠️ **停止、刪除、重啟、重新設定、`pod/restart` 都會清空 `/workspace`**——只有 `/vault` 會留下。停止前把要保留的東西複製到 `/vault`。
>
> 💡 停止 vs 刪除：「之後要用同樣設定重開」→ stop（保留紀錄與設定）；「不再需要這筆紀錄」→ delete。兩者都會停止運算計費，也都會刪除 `/workspace`。

## 儲存：`/workspace` vs `/vault`

| 路徑 | 生命週期 | 用途 |
|---|---|---|
| `/workspace` | 只活在目前這個容器；**停止、刪除、重啟、重新設定都會消失** | 環境建置、解壓、每個 epoch 都讀的資料（本機磁碟快） |
| `/vault` | 持久化、跨執行個體共享、獨立於 GPU 機器 | 資料集、checkpoint、模型權重、輸出。「丟了要重載或重訓的東西放 `/vault`」 |

### OOM 與主機故障（來源：Status & OOM 頁）
- RAM 超限時**只殺該程序**，不殺整個容器；SSH 與 Jupyter 仍在。主程序被殺 → 容器自動重啟，`/workspace` 與 `/vault` 保留，救回的檔案放 `/workspace/.recovered/`。
- 主機斷電 / 停機：< 24 小時 → 自動重啟並還原到 `/workspace/.recovered/`；≥ 24 小時 → 資料移到 Vault 的 `recovered/<machine>-<date>/`，免費保存 7 天，之後依標準儲存計費。請提醒開發者盡早清理。

## SSH 連線

```
ssh pod-<instance-id>@ssh.gputw.ai -p 2222
```

- 只接受公開金鑰登入（無密碼）。金鑰在**控制台 → SSH 金鑰**加入（API 金鑰無法管理），加入 / 移除後對執行中的執行個體立即生效，不需重新部署。
- 範本映像以其預設使用者登入；自訂映像以 `root` 登入。
- `Permission denied` → 確認控制台的公開金鑰與本機私鑰配對、執行個體是 `RUNNING`。
- SCP / rsync 也走 `2222`，可直接寫入 `/vault` 或 `/workspace`。

## 相關文件

- [02 · GPU 目錄與容量](./02-catalog-and-capacity.md) ｜ [04 · 即時狀態](./04-instance-runtime.md) ｜ [05 · 連接埠](./05-ports-and-exposures.md) ｜ [11 · 工作流程](./11-workflows.md)
- 官方：https://gputw.ai/zh-TW/docs/rest-api-quickstart 、https://gputw.ai/zh-TW/docs/instance-status-oom 、https://gputw.ai/zh-TW/docs/templates
