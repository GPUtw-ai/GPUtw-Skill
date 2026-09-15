---
description: 監控 GPUtw 執行個體（用量、事件、日誌、exec 指令、計費紀錄、閒置自動關機）
---

> **你需要這個指令嗎？**
> - 目標：看 GPU / VRAM 用量、日誌、在容器裡跑指令、閒置就關機 → ✅ 是
> - 目標：部署新機器 → ❌ 改用 `/gputw-deploy`
> - 目標：部署失敗 / 403 → ❌ 改用 `/gputw-debug`

使用者需要監控或操作執行中的 GPUtw 執行個體。請依以下步驟：

1. 讀取 `SKILL.md` 的「監控與除錯」決策樹
2. 讀取 `guides/04-instance-runtime.md`；自動關機流程另讀 `guides/11-workflows.md` §D
3. 確認需求對應端點：`/resources`（一定檢查 `usage.source`，`null` ≠ 0）、`/events`、`/logs?previous=1`、`/runs`、`/instances/active`、`/exec`（argv 陣列、`instances:exec`、專用金鑰）
4. 讀取 `guides/lang-standards/<語言>.md` 後產生程式碼，明列 scopes
5. 可跑對照：`scripts/gputw_client.py resources|logs|exec|events`、`scripts/examples/gpu_util_check.sh`

---

## 完成後下一步
- 執行個體異常 → `/gputw-debug`
- 輸出要保存 → 寫到 `/vault`（`/gputw-vault`）
