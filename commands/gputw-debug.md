---
description: 排查 GPUtw API 錯誤（Cloudflare 403、401、403 scope、402、404、409、429、504）、部署卡住、FAILED / crash loop
---

> **你需要這個指令嗎？**
> - 目標：某個呼叫回錯誤、部署一直 DEPLOYING、執行個體 FAILED、上傳段被拒 → ✅ 是
> - 目標：從零寫部署腳本 → ❌ 改用 `/gputw-deploy`

使用者遇到 GPUtw API 問題。請依以下步驟：

1. 先要到：HTTP 狀態碼、完整回應 body、呼叫的方法 + 路徑 + 主機名、用的 preset / scopes、（部署問題）`GET /instances/{id}/status` 的輸出
2. 讀取 `guides/10-errors-and-troubleshooting.md` 的「遇到錯誤怎麼查？」樹與狀態碼總表
3. 依序排除：
   - body 不是 JSON 信封 → `User-Agent`
   - `401` → 金鑰；`403 missing required scope` → scopes；`403 not available to API keys` → 控制台
   - `404` 且主機是 `upload.gputw.ai` → 非傳輸路由
   - 部署卡住 / FAILED → `/status` → `/events` → `/logs?previous=1` → `/startup-log`（見 `guides/04-instance-runtime.md`）
   - 上傳 `400 part N must be exactly X bytes` → `chunkSize`
4. 給出**一個**最可能的原因與可直接執行的驗證指令（curl，含 `-A`），再列次要可能
5. 若是本 skill 未收錄的端點或行為，明說並指向 https://gputw.ai/zh-TW/docs 或支援管道

---

## 完成後下一步
- 修好後要重跑流程 → `/gputw-deploy` / `/gputw-vault`
