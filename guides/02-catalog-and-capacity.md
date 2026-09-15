# 02 · GPU 目錄與可用容量

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/gpu-catalog 、https://gputw.ai/en/docs/rest-api-quickstart 、對 `GET /gpus/active` 的實際回應 ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

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

回傳目前上線且可租的機器陣列。每台包含：不透明的機器 `id`（就是 `nodeId`）、公開標籤 `hostname`（例如 `GPU worker a1b2c3`，不是真實主機名）、`gpuModel`, `totalGpus`, `cpuCores`, `rentableRamGb`, `rentableStorageGb`, `cpuModel`, `nvidiaDriverVersion`, `cudaVersion`, `arch`（`amd64` / `arm64`）, 整機 `hourlyRate`, `vramGb`, `usedGpus`, `availableGpus`, `queueDepth`, 以及對應的 `catalog` 物件。

> ℹ️ 回應刻意**不含**基礎設施與管理欄位（真實主機名、內網位址、SSH 憑證、內部價格組成）。把它當作允許清單式的公開契約：**未在官方文件列出的欄位不保證 API 穩定**。

規則：
- **一台機器同時只能有一個執行個體**。`availableGpus === 0` 或 `queueDepth > 0` 表示要排隊。
- 範本有 `architectures` 限制（`amd64` / `arm64`）與 `minComputeCapability`；DGX Spark 機器是 `arm64`，只能配 `DGX Spark` 類別的範本。部署時不相容會回 `400`，訊息會說明需要更新的 GPU。
- 可用性隨時變動；拿到 `nodeId` 後盡快呼叫 `create`，`409 This node already has an active instance` 表示被別人搶先了 → 重新查詢。

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
