# 08 · 伺服器端模型下載：網址 / Hugging Face → `/vault`

> SNAPSHOT 2026-09 ｜ 來源：公開 Vault model downloader API 文件 ｜ 生成程式碼前請 web_fetch https://gputw.ai/zh-TW/docs/vault 確認最新規格

由**伺服器**替你抓檔案直接放進 `/vault`——不需要執行中的執行個體、shell 或本機副本。最適合 ComfyUI 的底模：放在 `models/<category>/` 下就會出現在 ComfyUI 的選單。控制台的「從網址下載」按鈕（Vault 頁與 ComfyUI 新手面板）就是用這個 API。

需要 `vault:write` 建立與取消、`vault:read` 查詢。**只在 `api.gputw.ai` 上**——傳輸主機不服務 `/vault/downloads`（回 `404`）；反正位元組是伺服器端抓的，不經過你的網路。

## 流程

1. `POST /vault/downloads`，body `{ "source": "<url 或 hf 參照>", "targetPath": "models/checkpoints/model.safetensors", "hfToken": "<選填>" }`
   → `202` `{ id, url, targetPath, status, bytesDownloaded, totalBytes, error, createdAt, updatedAt }`。下載在背景進行。
2. 輪詢 `GET /vault/downloads/{id}` 直到 `status` 是 `completed`（或 `failed` / `canceled`）。`bytesDownloaded` 與 `totalBytes`（伺服器有回 Content-Length 才有）可做進度條。狀態值：`pending` → `downloading` → `completed` | `failed` | `canceled`。
3. `DELETE /vault/downloads/{id}` 取消進行中的下載；`GET /vault/downloads` 列出最近的下載。

### `source` 格式

- 直接的 `http(s)` 下載網址。
- Hugging Face **blob/resolve** 網址，例如 `https://huggingface.co/Comfy-Org/z_image/blob/main/vae.safetensors`（伺服器改寫為 raw `resolve` 網址）。
- `hf:` 簡寫：`hf:<owner>/<repo>:<file path>`，例如 `hf:Comfy-Org/z_image:split_files/vae/z_image_vae.safetensors`。

### `targetPath`

相對於 Vault 根目錄，應含檔名。只給資料夾（例如 `models/loras`）時，檔名取自來源網址。ComfyUI 類別：`checkpoints`, `diffusion_models`, `text_encoders`, `vae`, `loras`, `clip_vision`, `controlnet`, `upscale_models`, `embeddings`——放在 `models/<category>/`。

### 需要授權的模型（gated）

部分底模（例如某些 FLUX / Krea 倉庫）需要 Hugging Face token。用 `hfToken` 傳入；**只用於該次請求**，不儲存、不記錄。沒帶 token 時 gated 倉庫會回 `failed`，訊息會提示可能需要 token。

## curl

```bash
API=https://api.gputw.ai/api
KEY=gputw_live_xxxxxxxxxxxxxxxx
UA="my-automation/1.0"

ID=$(curl -fsS -X POST "$API/vault/downloads" -A "$UA" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"source":"hf:Comfy-Org/z_image:split_files/vae/z_image_vae.safetensors","targetPath":"models/vae"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')

while :; do
  STATUS=$(curl -fsS "$API/vault/downloads/$ID" -A "$UA" -H "Authorization: Bearer $KEY" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')
  echo "status: $STATUS"
  [ "$STATUS" = completed ] && break
  { [ "$STATUS" = failed ] || [ "$STATUS" = canceled ]; } && exit 1
  sleep 2
done
```

## 注意事項

- 配額在開始時檢查、位元組落地後再檢查一次（沒有 Content-Length 的伺服器可能超額）——超額的下載會被丟棄並標記 `failed`。
- 每位使用者最多 **3 個**同時下載；超過回 `429`。
- 來源網址由伺服器抓取：私有網段、loopback、link-local 與雲端 metadata 位址會被拒絕，每次轉址都重新驗證。只能用公開可達的網址。
- 本機已有的檔案請改用 [分段上傳](./07-vault-chunked-upload.md)。

## 相關文件

- [06 · Vault 基礎](./06-vault-basics.md) ｜ [07 · 分段續傳上傳](./07-vault-chunked-upload.md) ｜ [11 · 工作流程：ComfyUI 底模](./11-workflows.md)
- 官方：https://gputw.ai/zh-TW/docs/vault
