# 06 · Vault 儲存空間：概念、瀏覽、單檔上傳、下載

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/vault 、公開 Vault API 文件 ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

Vault 是每個帳號的持久化網路儲存，掛載在每台執行中執行個體的 **`/vault`**。它獨立於 GPU 機器：執行個體重啟、換機、刪除都不影響；帳號下所有執行個體共享同一個 Vault。

| | `/vault` | `/workspace` |
|---|---|---|
| 生命週期 | 持久、跨執行個體 | 跟著執行個體；刪除即消失 |
| 放什麼 | 資料集、checkpoint、模型權重、輸出——「丟了要重載或重訓的東西」 | 環境建置、解壓、每個 epoch 都讀的資料（本機磁碟較快，先從 `/vault` 複製過來） |
| 費用 | 依大小計費（`GET /vault/stats` 的 `vaultStorageRateHr`） | 含在執行個體內 |
| 餘額 ≤ NT$0 | 保留 30 天後刪除（除非儲值） | — |

路徑一律**相對於 Vault 根目錄**（`models/foo.safetensors`，不是 `/vault/models/foo.safetensors`）。

## 四種把檔案放進 Vault 的方法

| 方法 | 何時用 | 需要 | 指南 |
|---|---|---|---|
| 單請求上傳 `POST /vault/upload` | 小檔（經主站 ≤ ~90 MB；經傳輸主機無上限） | `vault:write` | 本章 |
| 分段續傳 `POST /vault/uploads` … | > 90 MB、不穩定網路、要續傳；單檔最大 2 TB | `vault:write` | [07](./07-vault-chunked-upload.md) |
| 伺服器端下載 `POST /vault/downloads` | 檔案在網址或 Hugging Face 上，不想經過本機 | `vault:write` | [08](./08-vault-model-download.md) |
| SCP / rsync 到 `ssh.gputw.ai:2222` | 已有執行中的執行個體與 SSH 金鑰 | 控制台加 SSH 金鑰 | [03](./03-instances-lifecycle.md) |

## 兩個主機名

| 主機 | 服務範圍 | 何時用 |
|---|---|---|
| `https://api.gputw.ai/api` | 全部 API | 列表、狀態、刪除、伺服器端下載、其他所有東西 |
| `https://upload.gputw.ai/api` | **只有**傳輸路由：`/vault/upload`, `/vault/uploads/*`, `/vault/download`, `/vault/download-zip` | 大檔上傳 / 下載——沒有 100 MB 請求上限、沒有 ~100 秒逾時、速度快很多 |

傳輸主機上其他路徑一律 `404`（包含 `/vault/list`, `/vault/stats`, `/vault/downloads`）。認證、配額與欠費檢查完全相同。用之前先探測：

```bash
TRANSFER="https://upload.gputw.ai"
curl -fsS --max-time 5 "$TRANSFER/health" >/dev/null 2>&1 || TRANSFER="https://api.gputw.ai"
```

## 瀏覽：`GET /vault/list?path=models`（`vault:read`）

```json
{ "path": "models", "totalBytes": 123456789,
  "files": [ { "name": "sd_xl_base.safetensors", "size": 6938078334, "modifiedAt": "…", "type": "file" },
             { "name": "loras", "size": null, "modifiedAt": "…", "type": "directory" } ] }
```

`404 Folder not found` = 路徑不存在。`GET /vault/stats` 回傳用量與配額（`usedGb`, `quotaGb`, `vaultSizeGb`, `vaultStorageRateHr`）。

## 建資料夾 / 改名 / 刪除（`vault:write`）

| 呼叫 | Body | 回應 |
|---|---|---|
| `POST /vault/mkdir` | `{ "path": "datasets/imagenet" }` | `201` |
| `POST /vault/rename` | `{ "from": "tmp/a.bin", "to": "models/a.bin" }` | `200`；`404 File not found`、`409 Target already exists` |
| `DELETE /vault/delete` | `{ "filename": "tmp/a.bin" }` | `200` |

## 單請求上傳：`POST /vault/upload?path=<folder>`（`vault:write`）

multipart/form-data，欄位名 `file`。經主站請保持 ≤ ~90 MB；經傳輸主機可傳多 GB。

```bash
curl -fsS -X POST "$TRANSFER/api/vault/upload?path=datasets" -A my-automation/1.0 \
  -H "Authorization: Bearer $GPUTW_API_KEY" -F "file=@train.csv"
# → 201 { "name": "train.csv", "size": 1234, "modifiedAt": "…", "type": "file" }
```

`413` = 超過 Vault 配額；`507` = 儲存空間暫時不足（稍後重試或聯絡支援）。

## 下載（`vault:read`）

```bash
# 單檔（支援 Range，可續傳）
curl -fsS -A my-automation/1.0 -H "Authorization: Bearer $GPUTW_API_KEY" \
  "$TRANSFER/api/vault/download?filename=models/model.safetensors" -o model.safetensors

# 整個資料夾打包成 zip 串流（不壓縮）
curl -fsS -A my-automation/1.0 -H "Authorization: Bearer $GPUTW_API_KEY" \
  "$TRANSFER/api/vault/download-zip?folder=datasets" -o datasets.zip
```

腳本直接帶 `Authorization` header 即可；`POST /vault/download-token` 是瀏覽器 `<a href>` 用的，API 金鑰無法呼叫。

## ComfyUI 的模型擺放

放在 `models/<category>/` 就會出現在 ComfyUI 的選單（重新整理後）：`checkpoints`, `diffusion_models`, `text_encoders`, `vae`, `loras`, `clip_vision`, `controlnet`, `upscale_models`, `embeddings`。

## 相關文件

- [07 · 分段續傳上傳](./07-vault-chunked-upload.md) ｜ [08 · 伺服器端模型下載](./08-vault-model-download.md)
- 官方：https://gputw.ai/zh-TW/docs/vault
