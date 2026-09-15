# GPUtw Skill

> **V1.1.0-beta.1** ｜ GPUtw（https://gputw.ai）官方 AI 知識套件 ｜ 讓 Claude Code、OpenAI Codex CLI、Cursor、GitHub Copilot、Google Gemini CLI 直接看懂 GPUtw 的 REST API 與官方文件，用自然語言部署 GPU、監控、搬資料、除錯。**現在含官方 MCP 伺服器（18 個工具）**。

**English:** An [Agent Skill](https://agentskills.io) for the GPUtw GPU cloud (Taiwan). Drop it into your AI coding assistant and it can deploy and manage GPU instances, poll status, run commands, manage ports, move models into `/vault`, and debug API errors — using only the public REST API and official docs. Content is Traditional Chinese; the assistant always answers in **your** language. See [Install](#安裝) below.

---

## 目錄

- [這是什麼](#這是什麼)
- [涵蓋範圍](#涵蓋範圍)
- [安裝](#安裝)
- [MCP 伺服器](#mcp-伺服器)
- [驗證](#驗證)
- [使用範例](#使用範例)
- [目錄結構](#目錄結構)
- [三層查閱流程](#三層查閱流程)
- [安全與隱私](#安全與隱私)
- [維護](#維護)
- [授權](#授權)

## 這是什麼

一個純 Markdown（加一支 stdlib Python 客戶端）的知識套件。安裝到 AI 程式助理後，助理會在你提到 GPUtw、gputw.ai、`/vault`、`gputw_live_` 金鑰或「在台灣租 GPU」時自動啟動，並依照決策樹讀取對應指南、查閱官方文件，再生成正確的程式碼——含 `User-Agent`、scope 選擇、`/status` 輪詢與結尾關機。

不需要任何執行期依賴；不會把你的金鑰送到任何地方。

## 涵蓋範圍

| 主題 | 內容 |
|---|---|
| 認證 | `gputw_live_` API 金鑰、17 個 scopes、5 個 presets（含 CI 用的唯寫 `Upload token`）、哪些事只能在控制台做 |
| GPU 目錄與容量 | `GET /gpus/active` → `GET /nodes/available` → `nodeId`；售罄與排隊 |
| 執行個體 | `create`（範本 / 自訂映像 / registryAuth / env / args）、狀態機、stop / delete / restart / reconfigure、SSH、OOM 與資料復原 |
| 即時狀態 | `/status`（輪詢）、`/resources`（遙測來源 `source`）、`/events`、`/logs?previous=1`、`/runs`、`/exec`、`/pod/restart` |
| 網路 | HTTP 連接埠 `private` / `public` / `unlisted`、raw TCP/UDP 曝露、Web UI 交接網址、連接埠費 |
| Vault | 列表、單檔上傳、**分段續傳上傳（傳輸主機 `upload.gputw.ai`）**、**URL / Hugging Face 伺服器端下載**、ComfyUI 模型目錄 |
| 帳務與團隊 | 一小時餘額規則、`402`、團隊成員限制、通知、工單 |
| 除錯 | 狀態碼 → 原因 → 動作、Cloudflare 403 / 1010 與 `User-Agent`、部署卡住、crash loop、上傳段錯誤 |
| 程式語言 | Python、Node.js / TypeScript、bash / curl 規範與可執行範例 |
| **MCP** | 官方 MCP 伺服器：18 個結構化工具（目錄、執行個體生命週期、狀態/用量/日誌、Vault 上傳與模型下載），read/write/destructive 標註，錯誤自動翻成可行動訊息 |

## 安裝

### Claude Code

```bash
# 個人全域安裝（推薦，所有專案共享）
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git ~/.claude/skills/gputw

# 或專案層級
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git .claude/skills/gputw
```

（選用）斜線指令：`cp ~/.claude/skills/gputw/commands/gputw-*.md ~/.claude/commands/`

| 指令 | 用途 |
|---|---|
| `/gputw-deploy` | 選 GPU、選機器、選範本或自訂映像、部署並等到 `RUNNING` |
| `/gputw-monitor` | 讀用量、事件、日誌、執行指令、閒置自動關機 |
| `/gputw-vault` | 上傳（分段 / 傳輸主機）、URL / Hugging Face 下載、列表、ComfyUI 模型擺放 |
| `/gputw-debug` | 401 / 403 / 402 / 409 / 429 / Cloudflare 403、部署卡住、crash loop |

用外掛安裝（見下）時這些指令已包含在內，不需另外複製。

### Claude.ai / Claude API（Skills 上傳）

把本資料夾壓縮成 zip 上傳（Settings → Features → Skills）。`SKILL.md` 的 frontmatter 只用規範允許的欄位（`name`、`description`、`license`、`metadata`），可直接上傳。

### OpenAI Codex CLI、Google Gemini CLI、Cursor、GitHub Copilot

見 [`SETUP.md`](./SETUP.md)。Codex 亦可放進 `.agents/skills/gputw/` 以 `$gputw` 呼叫。

### 版本固定

```bash
cd ~/.claude/skills/gputw && git tag -l && git checkout v1.0.0
```

## MCP 伺服器

除了知識，本 repo 也提供官方 **MCP 伺服器**（`mcp/`，18 個工具），讓助理直接以型別化的工具呼叫操作 GPUtw，不必組 curl。

```bash
# 外掛（建議）— 一次拿到 Skill + MCP 工具，金鑰存在安全儲存區
/plugin marketplace add GPUtw-ai/GPUtw-Skill
/plugin install gputw@gputw

# 只要 MCP（Claude Code）
claude mcp add gputw -s user -e GPUTW_API_KEY=gputw_live_xxx -- npx -y @gputw/mcp-server@latest
```

工具分為四組：**目錄**（`list-gpus`、`list-available-nodes`、`list-templates`、`get-deploy-options`）、
**執行個體**（`create-instance`、`stop-instance`、`delete-instance`、`restart-instance`）、
**即時狀態**（`get-instance-status`、`get-instance-resources`、`get-instance-logs`、`get-instance-events`）、
**Vault**（`list-vault`、`get-vault-stats`、`upload-to-vault`、`download-model-to-vault`、`list-vault-downloads`）。
`exec-in-instance` 是容器內的 root shell，**預設不註冊**，要設 `GPUTW_MCP_ALLOW_EXEC=1` 才會出現。

安裝細節、環境變數、連線驗證、工具 vs curl 的取捨：[`guides/12-mcp.md`](./guides/12-mcp.md)。

> ℹ️ MCP 伺服器目前是 **beta**（`1.1.0-beta.1`）。Skill 內容本身已穩定。

> ⚠️ **兩種安裝方式請只選一種。** 外掛與 `~/.claude/skills/gputw/` 的手動安裝同名，Claude Code 會以外掛為準、略過手動那份（`claude plugin list` 會提示）。要並存請改掉其中一份的 `name`。

## 驗證

安裝後問助理：

> GPUtw API key 的前綴是什麼？

回答 **`gputw_live_`** 即表示 Skill 已載入。再試一個真實需求：

> 用 Python 幫我在 GPUtw 開一台 RTX 4090 跑 PyTorch 範本，等它 RUNNING 後印出 SSH 指令，最後一定要關機。

助理應該：先查 `/gpus/active` 與 `/nodes/available`、用 `/templates` 找範本並比對架構、以 `/status` 輪詢、在 `finally` 呼叫 `/instances/stop`，並列出所需 scopes（`deploy` preset + `instances:manage`）。

## 使用範例

| 需求（自然語言） | 助理會做 |
|---|---|
| 「幫我寫一個 CI job 把 `data.tar` 傳到 Vault 的 `datasets/`」 | 建議 `Upload token` preset、走 `upload.gputw.ai` 分段上傳、用 session 的 `chunkSize`、以 `receivedParts` 續傳 |
| 「把 FLUX 的 VAE 從 Hugging Face 下到 ComfyUI 能看到的位置」 | `POST /vault/downloads` `hf:…` → `models/vae/`，提醒 gated 用 `hfToken`，並說明只能在 `api.gputw.ai` |
| 「我的機器一直 DEPLOYING」 | 讀 `/status` 的 `deployPhase` / `failureReason`，再 `/events`、`/logs?previous=1` |
| 「為什麼回 403？我的 key 有 instances:read」 | 先分辨 Cloudflare 403（缺 `User-Agent`）、scope 403、僅限瀏覽器 403 |
| 「GPU 閒置 30 分鐘就自動關」 | `/instances/active` + `usage.source` 判斷，`null` 不當 0，`POST /instances/stop` |
| 「開 Jupyter 給同事看」 | HTTP 連接埠 `unlisted` + 密碼，不用 raw TCP；`access-token` 90 秒網址 |

不需金鑰就能試的端點：`https://api.gputw.ai/api/gpus/active`、`/templates`、`/config/time`、`https://upload.gputw.ai/health`。

## 目錄結構

```
SKILL.md                 入口：決策樹、AI 注意事項、快速參考、文件索引（Claude Code / Cursor）
AGENTS.md / GEMINI.md    Codex CLI / Gemini CLI 入口（精簡版，與 SKILL.md 同步）
SETUP.md                 各平台安裝
guides/                  12 份整合指南 + lang-standards/（python, nodejs, shell）
references/              endpoints.md（唯一可引用的端點清單）、docs-site.md（官方文件 URL）
scripts/                 gputw_client.py（stdlib 客戶端，可讀可跑）、examples/*.sh
commands/                Claude Code 斜線指令（選用）
mcp/                     官方 MCP 伺服器（TypeScript，@gputw/mcp-server）
.claude-plugin/          外掛與 marketplace 資訊（/plugin marketplace add）
.github/workflows/       CI：frontmatter、連結、版本同步、AGENTS↔GEMINI 一致性、公開內容檢查、官方 URL 存活
```

## 三層查閱流程

```
SKILL.md（決策樹、規則）
   └─▶ guides/NN-*.md（怎麼整合；表格為 SNAPSHOT 2026-09）
          └─▶ references/docs-site.md → web_fetch gputw.ai/docs（現在的規格）
```

助理只能引用 `references/endpoints.md` 列出的端點；不確定的事會明說「未收錄」並指向官方文件，而不是猜。

## 安全與隱私

- 本套件只包含**公開 API 契約**與 https://gputw.ai/docs 的內容，不含任何 GPUtw 內部實作、基礎設施或原始碼。
- 規則要求助理：金鑰只從環境變數讀、只放 `Authorization` header、不記錄；`instances:exec` 只給專用金鑰；不嘗試繞過僅限瀏覽器的操作。
- 回報問題：GitHub Issues。**請勿在 issue 中貼上 API 金鑰**。

## 維護

- 官方文件改版 → 更新對應 `guides/` 與 SNAPSHOT 日期；端點增減 → 先改 `references/endpoints.md`。
- CI（`.github/workflows/validate.yml`）在 PR 時檢查 frontmatter、內部連結、版本同步、`AGENTS.md` ↔ `GEMINI.md` 三段一致、以及「不得出現內部識別」的內容守門；每週檢查官方 URL 是否存活。
- 變更紀錄：[`CHANGELOG.md`](./CHANGELOG.md)。

## 授權

[MIT](./LICENSE) © 2026 GPUtw.ai
