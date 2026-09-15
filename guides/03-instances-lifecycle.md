# 03 · 執行個體生命週期：部署、狀態、停止、重啟、刪除

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/rest-api-quickstart 、/instances 、/templates 、/instance-status-oom 、/ssh-access 、公開 Instance runtime API 文件 ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

## 狀態機

```
POST /instances/create
        │
        ▼
   DEPLOYING ──(deployPhase: SCHEDULING → PULLING_IMAGE → STARTING → RUNNING)──▶ RUNNING ◀──┐
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
| `STOPPED` | 不計費 | restart（同機或換機）、reconfigure、delete |
| `FAILED` | 不計費（部署逾時不收費） | 讀 `/logs?previous=1`、`/events`、startup log；restart / delete |
| `TERMINATED` | 不計費 | 不再出現在 `GET /instances` |
| `INSUFFICIENT_FUNDS` | 已暫停 | 儲值（控制台）後重啟 |

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

回應 `201`，`data` 是執行個體物件：`id`, `status`（`DEPLOYING`）, `hourlyRate`, `computeHourlyRate`, `gpuCount`, `cpuCores`, `ramGb`, `diskSizeGb`, `shmSizeGb`, `bandwidthMbps`, `template`, `isByoImage`, `allowedPorts[]`, `portAccess`, `exposures[]`, `webUiEnabled`, `webUiPort`, `node{ id, hostname(公開標籤), gpuModel, … }`, `createdAt`, `deployPhase`。

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

> ⚠️ 自訂映像：拉取時間計入計費；若 SSH 啟用但容器沒在 `22` 監聽、或宣告的 Web UI 沒在該埠回應，約 15 分鐘後部署逾時 `FAILED`（**不收費**）。失敗時讀 `GET /instances/{id}/logs?previous=1` 與 `/events`。

先用 `POST /instances/validate-image`（`instances:create`）檢查映像可否拉取：`{ "dockerImage": "…", "registryAuth": {…} }` → `{ ok: true, digest, platforms[] }` 或 `{ ok: false, reason: "invalid_reference"|"unauthorized"|"not_found"|"unreachable", message }`。

### `create` 的常見錯誤

| 狀態 | `error`（節錄） | 處理 |
|---|---|---|
| `402` | `Insufficient credits to cover one hour of your total running instances` | 控制台儲值；注意是**所有**執行中執行個體的一小時總和 |
| `409` | `This node already has an active instance (one instance per node).` | 重新查 `/nodes/available` 換機器 |
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
| 停止 | `POST /instances/stop` `{ "instanceId": "…" }` | 任何狀態（`TERMINATED` 除外）；停止計費、保留紀錄與 `/workspace` 可重啟 |
| 刪除 | `POST /instances/delete` `{ "instanceId": "…" }` | 終止並移除；`/workspace` 消失、`/vault` 不受影響 |
| 重啟 | `POST /instances/{id}/restart` `{ "mode": "same" }` 或 `{ "mode": "alternative", "nodeId": "…" }`（可加 `templateId`/`template`, `bandwidthMbps`, `shmSizeGb`） | 須 `STOPPED` / `FAILED`；`alternative` 會建立**新**執行個體（`201`）。先用 `GET /instances/{id}/restart-options` 看原機是否可用與替代方案；此端點也接受 `instances:create` |
| 重新設定 | `PUT /instances/{id}` `{ "templateId"?, "template"?, "bandwidthMbps"?, "shmSizeGb"? }` | 須 `RUNNING`/`STOPPED`/`FAILED`；重建容器 |
| 容器原地重建 | `POST /instances/{id}/pod/restart` | 保留映像、連接埠、`/workspace`；自訂映像不適用（憑證已清除，改用 `PUT` 指定範本或重新部署） |

停止/刪除已終止的執行個體 → `400 Instance already terminated`。

> 💡 停止 vs 刪除：「之後可能再用」→ stop；「不再需要這筆紀錄與 workspace」→ delete。兩者都會停止運算計費。

## 儲存：`/workspace` vs `/vault`

| 路徑 | 生命週期 | 用途 |
|---|---|---|
| `/workspace` | 跟著執行個體與所在機器；刪除即消失 | 環境建置、解壓、每個 epoch 都讀的資料（本機磁碟快） |
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
