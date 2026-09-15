---
description: GPUtw Vault 儲存空間：分段續傳上傳、傳輸主機、URL / Hugging Face 伺服器端下載、列表與下載、ComfyUI 模型擺放
---

> **你需要這個指令嗎？**
> - 目標：把資料集 / 模型放進 `/vault`、從 Vault 取回、CI 上傳 → ✅ 是
> - 目標：開機器 → ❌ 改用 `/gputw-deploy`

使用者需要操作 GPUtw Vault。請依以下步驟：

1. 讀取 `SKILL.md` 的「Vault」決策樹
2. 判斷來源：本機小檔 → `guides/06-vault-basics.md`；本機大檔 / 續傳 → `guides/07-vault-chunked-upload.md`；網址 / Hugging Face → `guides/08-vault-model-download.md`
3. 提醒金鑰：CI 用 `Upload token` preset（只有 `vault:write`）；查列表需 `vault:read`
4. 傳輸主機規則：大檔走 `https://upload.gputw.ai/api`（先 `/health` 探測），但 `/vault/list`、`/stats`、`/downloads` 只在 `api.gputw.ai`
5. 分段大小一律取自 session 的 `chunkSize`；續傳用 `receivedParts`
6. 讀取 `guides/lang-standards/<語言>.md` 後產生程式碼；可跑對照：`scripts/gputw_client.py upload|download|ls`、`scripts/examples/upload_to_vault.sh`、`download_hf_model.sh`

---

## 完成後下一步
- 部署 ComfyUI / PyTorch 使用這些檔案 → `/gputw-deploy`
