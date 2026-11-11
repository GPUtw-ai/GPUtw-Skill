# 02 · GPU 目錄與可用容量

> SNAPSHOT 2026-11 ｜ 來源：https://gputw.ai/en/docs/gpu-catalog 、https://gputw.ai/en/docs/rest-api-quickstart 、對 `GET /gpus/active` 的實際回應 ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

部署永遠是兩步：**先選 GPU 型號（catalog），再選一台該型號目前可租的機器（node）**。`POST /instances/create` 需要的是機器的 `nodeId`，不是 GPU 型號的 id。

```
GET /gpus/active  ──選 catalogId──▶  GET /nodes/available?catalogId=…  ──選 nodeId──▶  POST /instances/create
   （公開）                              （catalog:read）                             （instances:create）
```

## `GET /gpus/active` — GPU 目錄（公開，不需金鑰）

```bash
curl -fsS -A "my-automation/1.0" https://api.gputw.ai/api/gpus/active
```

每個項目的重要欄位：

| 欄位 | 說明 |
|---|---|
| `id` | catalog id（UUID）→ 帶去 `/nodes/available?catalogId=` |
| `name` | 例：`RTX 4090 24GB`, `RTX PRO 6000 WS 96GB`, `H100`, `DGX Spark GB10 4TB` |
| `architecture` | `Ada`, `Blackwell`, `Hopper`, … |
| `vramGb` | 顯示記憶體（多卡 SKU 為總和） |
| `hourlyPrice` | 每 GPU 每小時目錄費率（USD/hr） |
| `liveRentablePrice` | **目前可租**的整機每小時費率；`null` = 沒有空機 |
| `offers[]` | 目前可租的方案：`{ gpuCount, hourlyRate, isSlice }` |
| `demandStatus` | 中文標籤：`可使用` / `中度用量` / `高用量` / `售罄` |
| `availability` | 例：`AVAILABLE`；搭配 `totalGpus` / `availableGpus` |
| `rentalMode` | `SELF_SERVE`（可直接部署）或 `CONTACT_LONG_SESSION`（Email 洽談長租，見 `contactEmail`, `contactRentalNote`） |
| `linkGroupSize` | 連結式 DGX 群組型號（名稱以 `Link` 結尾，例 `DGX Spark x2 256GB Link`）的機器數；一般型號為 `null`。見下方 §連結式 DGX 群組 |
| `publicPriceMin` / `publicPriceMax` / `vastAiPrice` / `savingsPct` | 對外比價資訊 |
| 規格 | `cudaCores`, `tensorCores`, `memoryType`, `memoryBusBits`, `tdpW`, `fp16Tflops`, `aiTops`, `cardCount`, `interconnect`, `idealFor[]`, … |

選型建議（給 AI 回答用）：
- 以 `vramGb` 與 `idealFor` 決定型號；`liveRentablePrice !== null` 或 `availableGpus > 0` 才有機會立刻部署。
- `demandStatus === "售罄"` → 告知開發者可用 `reservations:manage` 排隊，或選別的型號。
- `rentalMode === "CONTACT_LONG_SESSION"` → 不能用 API 部署，請開發者 Email `contactEmail`。

## `GET /nodes/available?catalogId=<uuid>` — 可租機器（`catalog:read`）

```bash
curl -fsS -A "my-automation/1.0" -H "Authorization: Bearer $GPUTW_API_KEY" \
  "https://api.gputw.ai/api/nodes/available?catalogId=<catalog-id>"
```

回傳目前上線且可租的機器陣列。每台包含：不透明的機器 `id`（就是 `nodeId`）、公開標籤 `hostname`（例如 `GPU worker a1b2c3`，不是真實主機名）、`gpuModel`, `totalGpus`, `cpuCores`, `rentableRamGb`, `rentableStorageGb`, `cpuModel`, `nvidiaDriverVersion`, `cudaVersion`, `arch`（`amd64` / `arm64`）, 整機 `hourlyRate`, `vramGb`, `usedGpus`, `availableGpus`, `queueDepth`, `fastVault`, 以及對應的 `catalog` 物件。

> ℹ️ 回應刻意**不含**基礎設施與管理欄位（真實主機名、內網位址、SSH 憑證、內部價格組成）。把它當作允許清單式的公開契約：**未在官方文件列出的欄位不保證 API 穩定**。

規則：
- 機器可依 GPU 數共用（整機或單張 GPU）；`availableGpus === 0` 或 `queueDepth > 0` 表示要排隊。
- `rentableStorageGb` 是 **GiB**（2³⁰ bytes），即部署後執行個體的 `diskSizeGb` 依據；磁碟大小**由所選機器（與租用的 GPU 份額）決定，`create` 不能指定**。需要大工作區就挑 `rentableStorageGb` 夠大的機器。
- 範本有 `architectures` 限制（`amd64` / `arm64`）與 `minComputeCapability`；DGX Spark 機器是 `arm64`，只能配 `DGX Spark` 類別的範本。部署時不相容會回 `400`，訊息會說明需要更新的 GPU。
- **`fastVault`**（boolean）：`true` 的機器讀寫 `/vault` 較快（控制台機器卡片標示「+ 高速永久儲存庫」、篩選器「高速」）；`false` 的機器 `/vault` 一樣可用，只是較慢。工作負載要從 `/vault` 讀大量資料（例如每次開機把幾十 GB 模型從 `/vault` 複製到 `/workspace`、或直接從 `/vault` 載入權重）時，**優先挑 `fastVault: true`**，沒有空機再退而求其次。
- 可用性隨時變動；拿到 `nodeId` 後盡快呼叫 `create`，`409 This machine has no free GPUs right now…` 或 `409 Not enough free GPUs on this machine…` 表示被別人搶先了 → 重新查詢。

## 選機器的建議順序（給 AI 生成程式碼用）

1. 架構相容（`arch` 對上範本的 `architectures`）、`rentableStorageGb` 夠用。
2. 需要大量讀 `/vault` → `fastVault: true` 優先。
3. `availableGpus > 0` 且 `queueDepth === 0`（不用排隊）。
4. 其餘依 `hourlyRate` 由低到高。

```python
nodes = [n for n in nodes if n["availableGpus"] > 0 and n["rentableStorageGb"] >= need_gb]
nodes.sort(key=lambda n: (not n.get("fastVault"), n.get("queueDepth", 0), n["hourlyRate"]))
```

## 連結式 DGX 群組（`DGX Spark x2 / x3 … Link`）

幾台 DGX Spark 以高速網路連成一組、**整組一起租**，適合多機分散式訓練 / 推論。

1. `GET /gpus/active` 找 `linkGroupSize` 不為 `null` 的型號，取它的 `id`。
2. `GET /nodes/link-offers?catalogId=<id>`（`catalog:read`）→ 每個群組一筆：`id`（= `groupId`）, `size`, `available`, `hourlyRate`（整組每小時）, `members[]`（每台的 `gpuModel`, `cpuCores`, `ramGb`, `storageGb`, `cudaVersion`, `free`, `hourlyRate`）。空陣列 = 目前沒有可租的群組。
3. `available: true` 才部署：`POST /instances/linked`，見 [03](./03-instances-lifecycle.md) §連結式 DGX 群組租用。

一般的 `/nodes/available` 不會列出整組；不要對群組裡的單台機器個別呼叫 `create` 來湊。

## 容量排隊（`reservations:manage`）

型號售罄時可排隊等下一台空機（先到先得）。控制台在 GPU 頁面提供「等候」按鈕；API 提供 `GET /reservations`（含 `queuePosition`）、`POST /reservations`、`DELETE /reservations/{id}`。請求格式與通知行為請 web_fetch https://gputw.ai/zh-TW/docs 或引導開發者使用控制台；本 skill 不保證欄位細節。

## 常見錯誤

| 狀態 | 訊息（節錄） | 處理 |
|---|---|---|
| `401` / `403` | scope | `/nodes/available` 需 `catalog:read`（`deploy`、`readonly` preset 都有） |
| `400` | `catalogId` 無效 | 用 `/gpus/active` 回傳的 `id` |
| 空陣列 | — | 該型號目前沒有空機；看 `demandStatus`，考慮排隊或換型號 |

## 相關文件

- [03 · 執行個體生命週期](./03-instances-lifecycle.md)（下一步：`create`）
- [`references/endpoints.md`](../references/endpoints.md)
- 官方：https://gputw.ai/zh-TW/docs/gpu-catalog
