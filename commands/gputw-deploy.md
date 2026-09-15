---
description: 用 GPUtw API 部署 GPU 執行個體（選型號、選機器、範本或自訂映像、輪詢到 RUNNING、關機）
---

> **你需要這個指令嗎？**
> - 目標：用 API 開一台 GPU、寫部署腳本、CI 裡自動部署 → ✅ 是
> - 目標：看用量 / 日誌 / 跑指令 → ❌ 改用 `/gputw-monitor`
> - 目標：搬檔案進 `/vault` → ❌ 改用 `/gputw-vault`
> - 目標：排查 403 / 部署失敗 → ❌ 改用 `/gputw-debug`

使用者需要用 GPUtw API 部署執行個體。請依以下步驟：

1. 讀取 `SKILL.md` 的「部署」決策樹與「AI 注意事項」
2. 詢問使用者（一次問完）：語言 / 框架？GPU 型號或 VRAM 需求？官方範本還是自訂映像？要 Web UI 還是 SSH？已有 `deploy` preset 的金鑰嗎？
3. 讀取 `guides/02-catalog-and-capacity.md` 與 `guides/03-instances-lifecycle.md`；自訂映像另讀 §自帶映像
4. 讀取 `guides/lang-standards/<語言>.md`
5. 產生程式碼：`GET /gpus/active` → `GET /nodes/available?catalogId=` → `GET /templates`（比對 `architectures`）→ `POST /instances/create` → 輪詢 `GET /instances/{id}/status`（5 秒、逾時、三種結束）→ `finally` `POST /instances/stop`
6. 明列所需 scopes（`catalog:read`, `instances:read`, `instances:create`；關機需 `instances:manage`）與 `User-Agent`
7. 用 `scripts/gputw_client.py deploy --gpu … --template … --wait` 或 `scripts/examples/deploy_and_wait.sh` 作為可跑的對照

---

## 完成後下一步
- 監看用量或跑指令 → `/gputw-monitor`
- 開 Jupyter 網址 → `guides/05-ports-and-exposures.md` §開啟 Web UI
- 模型先放進 Vault → `/gputw-vault`
