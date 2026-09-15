# 09 · 帳號、點數與帳務、團隊、通知、支援

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/billing 、/teams 、/faq 、/support 、/api-keys ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

## 點數與計費規則

- **預付點數**（新台幣 NT$）。部署前餘額必須足以支付**所有已承諾執行中執行個體一小時**的費用，否則 `402`。
- 運算費用在 `RUNNING` 期間計量；`stop` 或 `delete` 即停止。目錄與執行個體的 `hourlyPrice` / `hourlyRate` / `computeHourlyRate` 以 **USD/hr** 表示，點數餘額以 NT$ 顯示。
- 另計：Vault 儲存（依大小）、超過內含額度的連接埠（見 [05](./05-ports-and-exposures.md)）、付費頻寬方案（`GET /config/deploy`）。
- 餘額不足以支付下一個計費小時 → 執行個體進入 `INSUFFICIENT_FUNDS`；儲值後重啟。
- 餘額 ≤ NT$0 時 Vault 資料保留 30 天後刪除（除非儲值）。
- **儲值只能在控制台完成**（`POST /payments/checkout` 對 API 金鑰永遠 `403`）。
- 低餘額提醒門檻可在控制台設定；`GET /config/features` 的 `lowBalanceThresholdNtd` 是平台預設值。

### 用 API 讀帳務（`billing:read`）

| 呼叫 | 回傳 |
|---|---|
| `GET /auth/me`（`profile:read`） | `id`, `email`, `displayName`, `creditBalance`, `role`, `org`（`null` 或 `{ id, name, role }`）, `billing`（`mode: "PERSONAL"` \| `"TEAM"`, `personalCreditBalance`, `effectiveCreditBalance`, …）, `lowBalanceThresholdNtd` |
| `GET /users/me/payments` | 儲值紀錄：`amount`, `status`（`PENDING` \| `PAID` \| `FAILED`）, `createdAt`, `paidAt`, 發票欄位 |
| `GET /instances/{id}/runs`（`instances:read`） | 單一執行個體的計費區段（[04](./04-instance-runtime.md)） |

「這個月花了多少」→ 沒有單一端點；用 `GET /instances` + 各執行個體的 `/runs` 加總 `durationSec × hourlyRate`，或引導開發者看控制台。

## 團隊帳號

- 控制台 → 建立團隊：把個人帳號轉成團隊帳號（**只能在控制台**；`POST /orgs/me` 對 API 金鑰不可用）。
- 角色只有 **Owner** 與 **Member**（目前沒有更細的角色）。
- **成員的執行個體費用由擁有者的預付餘額支付**；成員不需要擁有者的登入、付款方式或 API 金鑰。成員個人餘額 NT$0 也能部署，只要團隊錢包夠且未超過限制。
- 擁有者可對每位成員設定：每月花費上限、同時執行個體數上限、暫停部署（成員部署時會收到 `403 Deploys are suspended by your organization owner`）。
- 邀請目前只對已註冊的 GPUtw 帳號有效。
- 刪除團隊不會刪除 GPU 資源或帳號；擁有者回到個人帳號、成員被移除。刪除前請檢查執行中的執行個體。

### 用 API 操作團隊

| 呼叫 | Scope | 說明 |
|---|---|---|
| `GET /orgs/me` | `org:read` | 團隊資料、成員與限制 |
| `GET /orgs/me/instances` | `org:read` 或 `instances:read` | 團隊成員的執行個體（擁有者視角） |
| `POST /orgs/me/members` `{ "email": "…" }` | `org:manage` | 邀請已註冊使用者 |
| `PATCH /orgs/me/members/{userId}` `{ "monthlySpendLimitNtd"?, "maxInstances"?, "suspended"? }` | `org:manage` | 設定成員限制 |
| `DELETE /orgs/me/members/{userId}` | `org:manage` | 移除成員 |
| `PATCH /orgs/me/settings` `{ "showMemberBillingBalance"? }` | `org:manage` | 成員是否看得到團隊餘額 |
| `POST /orgs/me`, `DELETE /orgs/me`, `POST /orgs/me/leave` | 🔒 僅限瀏覽器 | 建立 / 刪除 / 離開團隊 |

## 帳號偏好（`profile:manage`）

`PATCH /auth/me/profile` `{ "displayName"?, "companyName"? }`；語言與 Email 通知偏好亦可在控制台設定。改密碼、改 Email、刪帳號、SSH 金鑰：**僅限控制台**。

## 通知（`notifications:read`）

`GET /notifications?limit=20&cursor=…&type=INSTANCE|PAYMENT|RESERVATION|WAITLIST|TICKET|SYSTEM` → `{ items[], unread, nextCursor }`；`PATCH /notifications/{id}/read`、`PATCH /notifications/read-all`。適合機器人把「機器可用了」「餘額低」等事件轉到 Slack。

## 支援與需求

- 帳號、帳務、部署或網路問題：控制台的回饋表單或即時聊天；請附執行個體 ID、範本、大約時間與失敗的指令 / 網址。API：`POST /tickets` `{ "subject": "…", "content": "…" }`（`tickets:manage`）。
- 需要特定 GPU 型號、數量、CPU/RAM/儲存配置或合約期間 → 網站聊天或控制台的客製機器需求流程；目錄中 `rentalMode: CONTACT_LONG_SESSION` 的型號請 Email `contactEmail`。
- 缺框架、CUDA 版本、套件或啟動器 → 範本需求流程，提供基底映像、CUDA 版本、Python/框架版本、啟動指令與預期 Web UI 埠。
- 社群：`GET /config/features` 的 `discordInviteUrl`。

## 相關文件

- [01 · 認證與 scope](./01-auth-and-scopes.md) ｜ [03 · 生命週期（stop / delete）](./03-instances-lifecycle.md)
- 官方：https://gputw.ai/zh-TW/docs/billing 、https://gputw.ai/zh-TW/docs/teams 、https://gputw.ai/zh-TW/docs/faq
