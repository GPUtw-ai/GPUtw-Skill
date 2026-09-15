# 07 · Vault 分段續傳上傳（任意大小，不需執行個體）

> SNAPSHOT 2026-09 ｜ 來源：公開 Vault chunked upload API 文件、傳輸主機說明、https://gputw.ai/en/docs/vault ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

透過 HTTPS 把任意大小的檔案放進 `/vault`——不需要執行中的執行個體，單檔最大 2 TB。控制台的 Vault 頁面對 > ~90 MB 的檔案自動用這個 API。

## 用哪把金鑰

建立金鑰時選 **`Upload token`** preset：只有 `vault:write`，刻意唯寫，因為這是要貼進 CI 的金鑰。外洩了也**不能**部署、不能花 GPU 費用、不能讀或下載 Vault 內容（`vault:read` 才能 `GET /vault/list`、`/download-zip`）。

它不是無害的：`vault:write` 能覆寫、刪除檔案，也能撐大 Vault（依大小計費）。像其他憑證一樣輪換。

下面每一步都是 `vault:write`，包含第 4 步與續傳的 `GET`——`GET /vault/uploads/{id}` 接受任一 vault scope，唯寫金鑰也能查自己的 session。

## 把位元組送到傳輸主機

Vault 傳輸另有專用主機 **`https://upload.gputw.ai`**：沒有 100 MB 請求上限、沒有 ~100 秒逾時、速度快很多。下面所有呼叫在主站 `api.gputw.ai` 也能跑，換 base URL 即可。先探測、失敗就退回主站（見 [06](./06-vault-basics.md)）。

## 流程

1. `POST /vault/uploads`，body `{ "path": "models/model.safetensors", "size": <bytes>, "sha256": "<hex, 選填>", "chunkSize": <bytes, 選填> }`
   → `201` `{ uploadId, path, size, sha256, chunkSize, partCount, status: "pending", … }`。
   第 n 段是檔案的第 `[n*chunkSize, (n+1)*chunkSize)` 位元組（最後一段較短）。
   **用伺服器給的 `chunkSize`**——預設 16 MiB，session 的值是權威，用別的大小切的段會被拒。可用 `chunkSize` 請求 4–64 MiB；更大的只在傳輸主機上有意義（經主站每段要在 ~100 秒內以你的上傳速度傳完）。
2. `PUT /vault/uploads/{uploadId}/parts/{n}`，body 是該段的原始位元組（`Content-Type: application/octet-stream`）。可平行、可安全重送——一段只有完整到達才算數。回 `{ part, size }`。
3. `POST /vault/uploads/{uploadId}/complete` → `202` `{ uploadId, status: "assembling" }`。伺服器串接各段（有給 `sha256` 就驗證）。
4. 輪詢 `GET /vault/uploads/{uploadId}` 直到 `status` 是 `completed`（或 `failed`，附 `error`）。狀態值：`pending` → `assembling` → `completed` | `failed` | `aborted`。

續傳：`GET /vault/uploads/{uploadId}` 回傳 `receivedParts[]`——只補上缺的索引，再 `complete` 一次。閒置 48 小時的 session 會自動清除；`DELETE /vault/uploads/{uploadId}` 提前中止。

## curl

```bash
API=https://upload.gputw.ai/api   # 傳輸主機；api.gputw.ai/api 也可
KEY=gputw_live_xxxxxxxxxxxxxxxx
UA="my-automation/1.0"
FILE=model.safetensors
SIZE=$(stat -c%s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d' ' -f1)

# 1. 建立 session
SESSION=$(curl -fsS -X POST "$API/vault/uploads" -A "$UA" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"path\":\"models/$FILE\",\"size\":$SIZE,\"sha256\":\"$SHA\"}")
ID=$(echo "$SESSION"    | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["uploadId"])')
CHUNK=$(echo "$SESSION" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["chunkSize"])')
PARTS=$(echo "$SESSION" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["partCount"])')

# 2. 以伺服器選的大小切段並逐段上傳
split -b "$CHUNK" -d -a 5 "$FILE" part-
i=0
for p in part-*; do
  curl -fsS -X PUT "$API/vault/uploads/$ID/parts/$i" -A "$UA" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/octet-stream' \
    --data-binary "@$p" > /dev/null
  echo "part $((i+1))/$PARTS"; i=$((i+1))
done
rm -f part-*

# 3. 組裝 4. 等待
curl -fsS -X POST "$API/vault/uploads/$ID/complete" -A "$UA" -H "Authorization: Bearer $KEY" > /dev/null
while :; do
  STATUS=$(curl -fsS "$API/vault/uploads/$ID" -A "$UA" -H "Authorization: Bearer $KEY" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')
  echo "status: $STATUS"
  [ "$STATUS" = completed ] && break
  [ "$STATUS" = failed ] && exit 1
  sleep 2
done
```

## Python（含續傳）

```python
import hashlib, os, time, requests

API, KEY = "https://upload.gputw.ai/api", "gputw_live_xxxxxxxxxxxxxxxx"
H = {"Authorization": f"Bearer {KEY}", "User-Agent": "my-automation/1.0"}
path_on_vault, local = "models/model.safetensors", "model.safetensors"

size = os.path.getsize(local)
h = hashlib.sha256()
with open(local, "rb") as f:
    for blk in iter(lambda: f.read(1 << 20), b""):
        h.update(blk)
sha = h.hexdigest()

s = requests.post(f"{API}/vault/uploads", headers=H,
                  json={"path": path_on_vault, "size": size, "sha256": sha}).json()["data"]
uid, chunk, parts = s["uploadId"], s["chunkSize"], s["partCount"]

done = set(requests.get(f"{API}/vault/uploads/{uid}", headers=H).json()["data"]["receivedParts"])
with open(local, "rb") as f:
    for n in range(parts):
        if n in done:
            continue  # 續傳：跳過伺服器已有的段
        f.seek(n * chunk)
        requests.put(f"{API}/vault/uploads/{uid}/parts/{n}",
                     headers={**H, "Content-Type": "application/octet-stream"},
                     data=f.read(chunk)).raise_for_status()
        print(f"part {n + 1}/{parts}")

requests.post(f"{API}/vault/uploads/{uid}/complete", headers=H).raise_for_status()
while True:
    st = requests.get(f"{API}/vault/uploads/{uid}", headers=H).json()["data"]
    if st["status"] == "completed":
        break
    if st["status"] in ("failed", "aborted"):
        raise RuntimeError(st["error"])
    time.sleep(2)
print("done")
```

`scripts/gputw_client.py upload` 是這段的可直接執行版本（含傳輸主機探測與並行）。

## 注意事項

- 配額在建立 session 時檢查，組裝後再檢查一次。暫存的段在完成 / 中止 / 過期前都計入配額。
- `sha256 mismatch` 失敗時各段會保留——重 `PUT` 有問題的段再 `complete` 一次。
- `400 part N must be exactly X bytes` → 你用的段大小不是 session 的 `chunkSize`。
- `409 Upload is <status>` → session 已在組裝 / 完成 / 中止，不能再 PUT。
- `400 missing parts: …` → `complete` 前先 `GET` 看 `receivedParts` 補齊。
- 傳統單請求 `POST /vault/upload`（multipart）在主站限 ~90 MB，在傳輸主機可傳多 GB。
- 傳輸主機**只**服務這些路由；`/vault/list`、`/vault/stats` 與 [伺服器端下載](./08-vault-model-download.md)（`/vault/downloads`）在它上面回 `404`——那些留在 `api.gputw.ai`。

## 相關文件

- [06 · Vault 基礎](./06-vault-basics.md) ｜ [08 · 伺服器端模型下載](./08-vault-model-download.md) ｜ [`scripts/gputw_client.py`](../scripts/gputw_client.py)
- 官方：https://gputw.ai/zh-TW/docs/vault
