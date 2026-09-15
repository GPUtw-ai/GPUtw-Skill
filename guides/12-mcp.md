# 12 · MCP 伺服器：什麼時候用工具、什麼時候用 curl

> SNAPSHOT 2026-09 ｜ 本 repo 的 `mcp/` 套件（`@gputw/mcp-server` v1.1.0-beta.1，beta）｜ 端點契約見 [`references/endpoints.md`](../references/endpoints.md)

GPUtw MCP 伺服器把控制平面包成**結構化工具呼叫**：不用組 curl、不用處理 shell 引號、錯誤是結構化的。它跟本 Skill 是互補的——

| | MCP 工具 | 本 Skill（guides/） |
|---|---|---|
| 給你 | 型別化參數、直接執行、結構化錯誤 | 決策：選哪張卡、什麼順序、何時該停、403 是什麼意思 |
| 不給你 | 判斷力（工具很好呼叫，也很好呼叫錯順序） | 執行能力 |

**規則：工具已連線 → 用工具；沒連線 → 照 guides 產生 curl / Python。無論走哪邊，決策仍然照 [SKILL.md](../SKILL.md) 的決策樹與注意事項。**

## 連線（Claude Code）

兩種方式。**外掛**同時裝 Skill 與 MCP，金鑰存在安全儲存區；**手動**只裝 MCP。

```bash
# 外掛（建議）— 一次拿到 Skill + 18 個工具
/plugin marketplace add GPUtw-ai/GPUtw-Skill
/plugin install gputw@gputw
# 安裝時會問 GPUtw API key（標記為 sensitive，不寫進純文字設定）

# 手動 — 只要 MCP
claude mcp add gputw -s user -e GPUTW_API_KEY=gputw_live_xxx -- npx -y @gputw/mcp-server@latest
```

其他客戶端（Claude Desktop、Cursor、VS Code、Windsurf…）用同樣的 stdio 設定：

```json
{
  "mcpServers": {
    "gputw": {
      "command": "npx",
      "args": ["-y", "@gputw/mcp-server@latest"],
      "env": { "GPUTW_API_KEY": "gputw_live_xxx" }
    }
  }
}
```

### 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `GPUTW_API_KEY` | — | 除公開目錄外都需要。用最小權限的 preset |
| `GPUTW_API_BASE` | `https://api.gputw.ai/api` | 一般不用改 |
| `GPUTW_TRANSFER_BASE` | `https://upload.gputw.ai` | 大檔傳輸主機；探測不到會自動退回主站 |
| `GPUTW_MCP_ALLOW_EXEC` | 未設 | 設 `1` 才會註冊 `exec-in-instance` |

### 先確認真的連上（依賴工具前必做）

Claude Code 裡執行 `/mcp`，`gputw` 要顯示 **Connected**。或直接握手探測：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  | npx -y @gputw/mcp-server@latest
# → serverInfo: {"name":"gputw","version":"1.1.0-beta.1"}
```

**工具根本沒出現** → 伺服器沒連上；重跑安裝，或這次改用 curl（guides/00–11）。

## 工具總表（18 個）

| 工具 | 標註 | 對應端點 | 需要 scope |
|---|---|---|---|
| `list-gpus` | read | `GET /gpus/active` | 無（公開） |
| `list-available-nodes` | read | `GET /nodes/available` | `catalog:read` |
| `list-templates` | read | `GET /templates` | 無（公開） |
| `get-deploy-options` | read | `GET /config/deploy` | 無（公開） |
| `list-instances` | read | `GET /instances` | `instances:read` |
| `get-instance-status` | read | `GET /instances/{id}/status` | `instances:read` |
| `get-instance-resources` | read | `GET /instances/{id}/resources` | `instances:read` |
| `get-instance-logs` | read | `GET /instances/{id}/logs` | `instances:read` |
| `get-instance-events` | read | `GET /instances/{id}/events` | `instances:read` |
| `create-instance` | write | `POST /instances/create` | `instances:create` |
| `stop-instance` | write | `POST /instances/stop` | `instances:manage` |
| `delete-instance` | **destructive** | `POST /instances/delete` | `instances:manage` |
| `restart-instance` | write | `POST /instances/{id}/restart` | `instances:manage` |
| `list-vault` | read | `GET /vault/list` | `vault:read` |
| `get-vault-stats` | read | `GET /vault/stats` | `vault:read` |
| `upload-to-vault` | write | 分段上傳流程 | `vault:write` |
| `download-model-to-vault` | write | `POST /vault/downloads` | `vault:write` |
| `list-vault-downloads` | read | `GET /vault/downloads` | `vault:read` |
| `exec-in-instance` | write | `POST /instances/{id}/exec` | `instances:exec` ＋ `GPUTW_MCP_ALLOW_EXEC=1` |

**v1 尚未收錄**（請照 guides 用 curl）：連接埠與 exposures、API 金鑰管理、帳務與付款、團隊、通知、預約、工單。完整端點見 [`references/endpoints.md`](../references/endpoints.md)。

## 用工具時仍然成立的規則

1. **部署順序不變**：`list-gpus` → `list-available-nodes`（帶第一步的 `id` 當 `catalogId`）→ `list-templates`（比對 `architectures` 與機器 `arch`）→ `create-instance`（帶第二步的機器 `id` 當 `nodeId`）。
2. **等待用 `get-instance-status`**，每 5 秒一次並設整體逾時；**不要**用 `list-instances` 輪詢。三種結束：`RUNNING` / `FAILED` / `INSUFFICIENT_FUNDS`。
3. **`get-instance-resources` 先看 `usage.source`**。`none` = 沒有遙測、所有指標是 `null`——**不是閒置**。
4. **結束一定關機**：`stop-instance`（可能再用）或 `delete-instance`（不再需要）。`RUNNING` 就在扣點數。
5. **`exec-in-instance` 的 `command` 是 argv 陣列**，中間沒有 shell；要管線就 `["sh","-c","…"]`。它是 root 且留稽核紀錄。
6. **`delete-instance` 標記為 destructive**，會摧毀 `/workspace`。先跟使用者確認；要保留的東西應該已經在 `/vault`。
7. **工具回傳的是投影過的欄位**（目錄一筆原始紀錄約 50 個欄位，全丟給模型會吃掉上下文）。要完整紀錄請直接打 REST API。

## 錯誤訊息

工具會把狀態碼翻成可行動的訊息，例如：

```
GPUtw API error 403: API key missing required scope: instances:create
What to do: this key lacks the `instances:create` scope. Update the key's scopes in the dashboard (API Keys) or issue a new key with it.

GPUtw API error 404: (HTML response body, 13582 bytes - not the GPUtw JSON envelope)
What to do: the response was not the GPUtw envelope, so the request never reached the API. Check GPUTW_API_BASE …
```

第二種代表請求**根本沒到 GPUtw**（通常是 base URL 錯或缺 `User-Agent`）。完整對照表見 [10 · 錯誤與除錯](./10-errors-and-troubleshooting.md)。

## 安全性

- 伺服器以該金鑰的完整權限行動。用最小權限 preset：看狀態 `readonly`、部署 `deploy`、維運 `operator`、CI 上傳 `Upload token`。
- 金鑰只從環境變數讀，不落地、不記錄；任何回傳文字裡符合 `gputw_live_…` 的字串都會被遮蔽。
- `exec-in-instance` 預設不註冊。它是容器內的 root shell，需要只有 `full` preset 才有的 `instances:exec`，且每次呼叫寫入稽核紀錄。
- 本機 stdio 模式下，金鑰只留在你的機器上；沒有 GPUtw 以外的第三方參與。

## 自己建置

```bash
cd mcp && npm install && npm run build && npm test
node dist/stdio.mjs --help
```

`mcp/dist/stdio.mjs` 是**已提交**的單檔 bundle（把相依都打包進去），所以 git clone 下來用 `node` 就能跑、不需要 npm install——外掛安裝走的就是這條路。

## 相關文件

- [SKILL.md](../SKILL.md) 決策樹 ｜ [10 · 錯誤與除錯](./10-errors-and-troubleshooting.md) ｜ [11 · 工作流程](./11-workflows.md)
- [`references/endpoints.md`](../references/endpoints.md)
