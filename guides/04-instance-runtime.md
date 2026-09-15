# 04 · 即時狀態：輪詢、用量、事件、日誌、執行指令

> SNAPSHOT 2026-09 ｜ 來源：公開 Instance runtime API 文件、https://gputw.ai/en/docs/instance-runtime 、/monitoring ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

生命週期 API 描述執行個體**被配置成什麼**；本章的端點描述它**現在在做什麼**。全部需要 `instances:read`（除非另註），且只會觸及同帳號的執行個體（不存在 `404`、他人的 `403`）。

## `GET /instances/{id}/status` — 輪詢專用

刻意做得小而便宜：一次容器狀態讀取，不含機器紀錄、連接埠表或遙測。等機器開起來就用它，每 5 秒一次。

```jsonc
{
  "instanceId": "…",
  "status": "DEPLOYING",           // 平台認定的狀態
  "deployPhase": "PULLING_IMAGE",  // SCHEDULING | PULLING_IMAGE | STARTING | RUNNING
  "podPhase": "Pending",           // 容器層回報的狀態
  "ready": false,
  "restartCount": 0,
  "waitingReason": "ContainerCreating",
  "terminatedReason": null,
  "failureReason": null,           // FAILED_SCHEDULING_MEMORY | IMAGE_PULL_FAILED | CONTAINER_CRASHING | POD_FAILED
  "createdAt": "…", "startedAt": null, "uptimeSec": null
}
```

`status` 與 `podPhase` 不一致的時候，正是出問題的時候——這也是輪詢客戶端想偵測的情況。大映像拉取要數分鐘，`deployPhase` 告訴你還在拉還是已在啟動。

```bash
until [ "$(curl -fsS -A my-automation/1.0 "$API/instances/$ID/status" -H "Authorization: Bearer $KEY" \
          | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')" = RUNNING ]; do
  sleep 5
done
```

輪詢時要處理三種結束：`RUNNING`（成功）、`FAILED`（讀 logs/events）、`INSUFFICIENT_FUNDS`（儲值）。建議設整體逾時（例如 20 分鐘）。

## `GET /instances/{id}/resources` — 配置 + 用量 + 燒錢速度

利用率沒有它的上限就沒意義，所以一次回傳三者：

```jsonc
{
  "instanceId": "…", "status": "RUNNING",
  "allocated": { "gpuCount": 1, "gpuModel": "RTX 4090", "vramGb": 24, "cpuCores": 16, "ramGb": 64,
                 "shmSizeGb": 8, "diskSizeGb": 500, "bandwidthMbps": 100 },
  "usage": {
    "cpuPct": 62.4,          // 單核百分比，跨核加總
    "ramBytes": 18253611008, "ramPct": 26.5,   // 對執行個體自己的 ramGb
    "gpuPct": 97, "vramUsedMib": 21430, "vramPct": 87.2,
    "netInMbps": 4.21, "netOutMbps": 0.88, "bandwidthPct": 0.9,
    "sampledAt": "…",
    "source": "prometheus"   // prometheus | fallback | none
  },
  "billing": { "hourlyRate": 0.42, "computeHourlyRate": 0.39, "extraPortFee": 0 }
}
```

> ⚠️ **每個指標都是數字或 `null`，永遠不會用 `0` 代替。** `source` 說明樣本來源：`prometheus`（即時）、`fallback`（次要輪詢器）、`none`（沒有遙測，所有指標皆 `null`）。因此「閒置的 0%」和「沒在回報」是分得開的——**不要把 `null` 當 0，也不要把 `0` 當成沒遙測**。沒有 GPU 遙測的機器 `gpuPct` / `vramUsedMib` 為 `null`，其他指標照常。

百分比皆以執行個體**自身配置**為分母，不是整台主機。這也是為什麼在容器內跑 `df` 不準（它看到的是整台機器的檔案系統）——磁碟用量以此端點為準。

## `GET /instances/active` — 現在跑著什麼

所有 `DEPLOYING` / `RUNNING` 執行個體，各自附上即時 `pod`（`phase`, `ready`, `restartCount`, `startedAt`, `image`, `waitingReason`, `terminatedReason`, `uptimeSec`）與 `usage`。一次呼叫看全帳號。

## `GET /instances/{id}/events?limit=20` 與 `GET /instances/{id}/logs?tail=200&previous=1`

- **events**：結構化事件 `{ type, reason, message, count, lastSeen }`，`limit` 1–100（預設 20）。事件只屬於目前這個容器；重新部署不會繼承上一個的失敗。沒有容器時回 `{ "events": [], "podExists": false }`。
- **logs**：容器日誌尾端。`tail` 上限 2000 行，回應上限 48 KiB（舊行被丟棄並標記 `… (truncated)`）。**`previous=1` 讀上一個容器的日誌**——crash loop 時真正的錯誤只會在那裡。

```bash
curl -fsS -A my-automation/1.0 -H "Authorization: Bearer $KEY" "$API/instances/$ID/logs?tail=100&previous=1"
```

> ℹ️ 事件、日誌與指令輸出在離開伺服器前都會移除基礎設施識別：主機名變成 `worker-node`、內網 IP 變成 `[internal-ip]`。看到這些佔位字串是正常的。

除錯順序（`FAILED` 或 `CrashLoopBackOff`）：`/status` 看 `failureReason` → `/events` 看 `reason` → `/logs?previous=1` 看實際錯誤 → 必要時 `/startup-log`。

## `GET /instances/{id}/runs?limit=50` — 計費區段

此執行個體經歷過的計費區段（新→舊，`limit` 1–200），每筆有 `startedAt`, `endedAt`, `endStatus`, 當時的硬體規格與 `hourlyRate`，以及衍生的 `durationSec`, `active`。帳單就是從這些紀錄算出來的。

## `POST /instances/{id}/exec` — 在容器內執行一個指令（`instances:exec`）

```jsonc
// 請求
{ "command": ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv"], "timeoutMs": 30000 }
// 回應
{ "stdout": "…", "stderr": "", "exitCode": 0, "truncated": false }
```

- `command` 是 **argv 陣列**，原封不動交給容器執行——中間**沒有 shell**，不會做分詞或萬用字元展開，也沒有注入面。要用管線或 glob 就明確要 shell：`["sh", "-c", "ls /workspace | wc -l"]`。
- 每個串流輸出上限 256 KiB（超過 `truncated: true`）；`timeoutMs` 預設 30 秒、最大 120 秒，逾時回 `504`。
- 必須 `status: RUNNING`。與其他執行個體動作共用速率限制（每使用者 60 次 / 5 分鐘）。
- 1–64 個參數，每個 ≤ 4096 字元。

> ⚠️ **這是執行個體上的 root shell。** 需要獨立的 `instances:exec` scope，除 `full` 外沒有 preset 包含它；每次呼叫寫入稽核紀錄（指令與結束碼，不含輸出）。不要把它給共用或第三方自動化。

## `POST /instances/{id}/pod/restart` — 原地重建容器（`instances:manage`）

保留映像、連接埠與 `/workspace`，重新建立容器；計費結算、連接埠同步、SSH 都照常處理。自訂映像不能這樣重啟（其 registry 憑證在停止/失敗時已清除）——改用 `PUT /instances/{id}` 指定範本，或重新部署。

## 在 Notebook 裡看 GPU（來源：Monitoring 頁）

- `!nvidia-smi`（cell）；`nvitop`（在 terminal 分頁跑，不要在 cell，因為它不會結束）；PyTorch `torch.cuda.mem_get_info()` / `torch.cuda.max_memory_allocated()`。
- 「訓練跑著但 GPU 利用率很低」通常是在等資料，不是算力不足。
- W&B：`WANDB_DIR=/vault` 讓 run 歷史活過執行個體；`WANDB_MODE=offline` 之後再 sync。
- Hugging Face：`HF_HOME=/vault/hf`（跨執行個體快取）、`HF_XET_HIGH_PERFORMANCE=1`；**在 import transformers/diffusers 之前**設定（部署時用 `env`）。
- 不要把 `WANDB_API_KEY` / `HF_TOKEN` 貼進 notebook（會留在 `.ipynb`）；部署時用 `customImage.env` 或 SSH 環境變數傳入。

## 相關文件

- [03 · 生命週期](./03-instances-lifecycle.md) ｜ [10 · 錯誤與除錯](./10-errors-and-troubleshooting.md) ｜ [11 · 工作流程](./11-workflows.md)
- 官方：https://gputw.ai/zh-TW/docs/instance-runtime 、https://gputw.ai/zh-TW/docs/monitoring
