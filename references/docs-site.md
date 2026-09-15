# GPUtw 官方文件即時索引

> ⚠️ **AI 指令**：本檔案是 GPUtw 官方文件的即時入口。當開發者詢問具體參數、欄位、限制或最新行為時，**先用 web_fetch 讀取下方對應頁面**，再結合 `guides/` 回答。`guides/` 內的表格是快照（SNAPSHOT 2026-09），官方頁面優先。
> 頁面同時提供英文（`/en/`）與繁體中文（`/zh-TW/`），兩者內容對應；請依開發者的語言選擇。連結失效時請到 https://gputw.ai/zh-TW/docs 搜尋對應主題。

## 開始

| 頁面 | 英文 | 繁體中文 | 對應指南 |
|---|---|---|---|
| Getting Started / 快速開始 | https://gputw.ai/en/docs/getting-started | https://gputw.ai/zh-TW/docs/getting-started | [00](../guides/00-getting-started.md) |
| Tutorials / 教學 | https://gputw.ai/en/docs/tutorials | https://gputw.ai/zh-TW/docs/tutorials | [11](../guides/11-workflows.md) |

## 執行個體

| 頁面 | 英文 | 繁體中文 | 對應指南 |
|---|---|---|---|
| Docker / Container Environment | https://gputw.ai/en/docs/docker-environment | https://gputw.ai/zh-TW/docs/docker-environment | [03](../guides/03-instances-lifecycle.md) |
| Templates / 環境範本 | https://gputw.ai/en/docs/templates | https://gputw.ai/zh-TW/docs/templates | [03](../guides/03-instances-lifecycle.md) |
| SSH Access | https://gputw.ai/en/docs/ssh-access | https://gputw.ai/zh-TW/docs/ssh-access | [03](../guides/03-instances-lifecycle.md) |
| Jupyter and Web UI | https://gputw.ai/en/docs/jupyter-web-ui | https://gputw.ai/zh-TW/docs/jupyter-web-ui | [05](../guides/05-ports-and-exposures.md) |
| Status & OOM | https://gputw.ai/en/docs/instance-status-oom | https://gputw.ai/zh-TW/docs/instance-status-oom | [03](../guides/03-instances-lifecycle.md) |
| Monitoring and Tracking | https://gputw.ai/en/docs/monitoring | https://gputw.ai/zh-TW/docs/monitoring | [04](../guides/04-instance-runtime.md) |
| Ports and Raw TCP/UDP | https://gputw.ai/en/docs/ports | https://gputw.ai/zh-TW/docs/ports | [05](../guides/05-ports-and-exposures.md) |
| Vault Storage | https://gputw.ai/en/docs/vault | https://gputw.ai/zh-TW/docs/vault | [06](../guides/06-vault-basics.md) |

## API

| 頁面 | 英文 | 繁體中文 | 對應指南 |
|---|---|---|---|
| API Keys ⚠ 首次串接必讀 | https://gputw.ai/en/docs/api-keys | https://gputw.ai/zh-TW/docs/api-keys | [01](../guides/01-auth-and-scopes.md) |
| REST API Quickstart | https://gputw.ai/en/docs/rest-api-quickstart | https://gputw.ai/zh-TW/docs/rest-api-quickstart | [03](../guides/03-instances-lifecycle.md), [05](../guides/05-ports-and-exposures.md) |
| Instance Runtime | https://gputw.ai/en/docs/instance-runtime | https://gputw.ai/zh-TW/docs/instance-runtime | [04](../guides/04-instance-runtime.md) |
| GPU Catalog | https://gputw.ai/en/docs/gpu-catalog | https://gputw.ai/zh-TW/docs/gpu-catalog | [02](../guides/02-catalog-and-capacity.md) |
| Instances | https://gputw.ai/en/docs/instances | https://gputw.ai/zh-TW/docs/instances | [03](../guides/03-instances-lifecycle.md) |

## 帳號

| 頁面 | 英文 | 繁體中文 | 對應指南 |
|---|---|---|---|
| Billing and Credits | https://gputw.ai/en/docs/billing | https://gputw.ai/zh-TW/docs/billing | [09](../guides/09-account-billing-teams.md) |
| Team Accounts | https://gputw.ai/en/docs/teams | https://gputw.ai/zh-TW/docs/teams | [09](../guides/09-account-billing-teams.md) |

## 協助

| 頁面 | 英文 | 繁體中文 | 對應指南 |
|---|---|---|---|
| Support and Requests | https://gputw.ai/en/docs/support | https://gputw.ai/zh-TW/docs/support | [09](../guides/09-account-billing-teams.md) |
| FAQ | https://gputw.ai/en/docs/faq | https://gputw.ai/zh-TW/docs/faq | [10](../guides/10-errors-and-troubleshooting.md) |

## 公開 API（不需金鑰即可驗證）

| 用途 | URL |
|---|---|
| 連線 / User-Agent 檢查 | https://api.gputw.ai/api/config/time |
| GPU 目錄 | https://api.gputw.ai/api/gpus/active |
| 範本清單 | https://api.gputw.ai/api/templates |
| 部署選項（頻寬方案） | https://api.gputw.ai/api/config/deploy |
| 傳輸主機健康檢查 | https://upload.gputw.ai/health |
| 控制台 | https://gputw.ai/dashboard |
