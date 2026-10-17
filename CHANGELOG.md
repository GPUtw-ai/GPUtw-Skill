# Changelog

## V1.0.0 — 2026-09-15

首次發布。

- `SKILL.md`：決策樹（部署 / 監控與除錯 / Vault / 帳號 / 錯誤碼）、15 條 AI 注意事項、12 項常犯錯誤自檢、快速參考
- `guides/00`–`11`：快速開始、認證與 scope、目錄與容量、執行個體生命週期、即時狀態、連接埠、Vault 基礎、分段續傳上傳、伺服器端模型下載、帳務與團隊、錯誤與除錯、端到端流程
- `guides/lang-standards/`：python、nodejs、shell
- `references/endpoints.md`（端點總表）、`references/docs-site.md`（官方文件 19 頁 URL）
- `scripts/gputw_client.py`（stdlib 客戶端）與 4 支範例腳本
- `AGENTS.md`（Codex CLI）、`GEMINI.md`（Gemini CLI）、`SETUP.md`、`commands/`（4 個斜線指令）
- CI：frontmatter、連結、版本同步、AGENTS↔GEMINI 一致性、公開內容守門、官方 URL 存活檢查

## V1.1.0-beta.1 — 2026-09-16

新增官方 **MCP 伺服器**（`mcp/`，npm `@gputw/mcp-server`，TypeScript、MCP SDK 1.30）。

- 18 個工具：目錄（4）、執行個體生命週期（4）、即時狀態（4）、Vault（5），外加預設關閉的 `exec-in-instance`
- `readOnlyHint` / `destructiveHint` / `idempotentHint` 標註，客戶端才能正確分辨讀取與刪除
- 錯誤翻譯：缺哪個 scope、402 要儲值、409 要重選機器、非信封回應代表請求沒到 API
- 回應欄位投影：目錄一筆原始紀錄約 50 欄，投影後 < 20 欄，避免吃掉模型上下文
- `upload-to-vault` 實作完整分段續傳協定（傳輸主機探測、伺服器決定的 chunkSize、`receivedParts` 續傳、sha256 驗證）
- 金鑰只從環境變數讀，不落地、不記錄；輸出中的 `gputw_live_…` 一律遮蔽
- 可作為 Claude Code 外掛安裝（`/plugin marketplace add GPUtw-ai/GPUtw-Skill`），API 金鑰經 `userConfig` 存在安全儲存區
- 55 個離線單元測試（不需網路與金鑰）
- 新增 [`guides/12-mcp.md`](./guides/12-mcp.md)；SKILL.md / AGENTS.md / GEMINI.md 加入 MCP 路由決策

## V1.1.0 — 2026-10-17

穩定版。MCP 伺服器（`@gputw/mcp-server` 1.1.0）結束 beta；並依 [#1](https://github.com/GPUtw-ai/GPUtw-Skill/issues/1) 釐清自訂映像整合的 API 契約。

- **建立復原**：`POST /instances/create` 沒有冪等鍵，也沒有 label / metadata；`GET /instances` 不回傳 `customImage.env` / `args`。新增以 `nodeId` + `template` + `isByoImage` + `createdAt` 對帳的流程（`guides/03` §建立復原）
- **列表**：`GET /instances` 完整、不分頁、無篩選，新→舊，含 `DEPLOYING` / `FAILED`，不含 `TERMINATED`
- **自訂映像就緒**：TCP 連線檢查 `webUiPort`（無 Web UI 時為 `22`），沒有 HTTP path / 狀態碼 / 認證；約 15 分鐘就緒時窗從容器開始執行算起，拉取另有較長時窗
- **`deployPhase`**：補上 `PREPARING`、`CONFIG_ERROR`、`START_FAILED`、`CRASH_LOOP`；`PULLING_IMAGE` 只代表拉取出錯重試中；只在 `DEPLOYING` 時出現。`failureReason` 補上 `FAILED_SCHEDULING`
- **工作區磁碟**：`diskSizeGb` / `rentableStorageGb` 是 GiB；由機器決定、無法在 `create` 指定；限制涵蓋 `/workspace` 與容器其他可寫路徑，不含映像唯讀層；`/resources` 沒有磁碟用量欄位，非 `RUNNING` 時 `usage` 全為 `null`
- **Vault**：`GET /vault/stats` 欄位表（GiB、計費一律新台幣：單價看 `priceNtdPerGbHour`，`vaultStorageRateHr` 是舊式 USD 表示、`usedGb` 為每小時快取）；配額檢查用即時用量，上傳與伺服器端下載的進行中保留量互不計入
- **容量衝突**：機器依 GPU 數共用；`409` 訊息更新為 `This machine has no free GPUs right now…` / `Not enough free GPUs on this machine…`；新增 `403 Instance limit reached…`
- **所有權**：他人或不存在的 `/instances/{id}` 一律 `404`
- `create` 的 `201` 回應只含基本欄位；`node`、`exposures`、Web UI 欄位改用 `GET /instances/{id}`
