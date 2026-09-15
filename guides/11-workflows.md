# 11 · 端到端工作流程

> SNAPSHOT 2026-09 ｜ 組合 [02](./02-catalog-and-capacity.md)–[08](./08-vault-model-download.md) 的端點；細節以各指南與官方文件為準

每個流程都遵守同一組原則：**先查目錄再選機器、用 `/status` 輪詢、任何指標 `null` ≠ 0、結束一定 stop/delete、金鑰只給需要的 scope**。

## A. 部署 → 等待 → 執行 → 關機（訓練 / 批次任務）

需要 scopes：`catalog:read`, `instances:read`, `instances:create`, `instances:manage`；若要 `exec` 再加 `instances:exec`（建議另發專用金鑰）。

```
1. GET  /gpus/active                         → 依 vramGb / idealFor 選 catalog，確認 liveRentablePrice != null
2. GET  /nodes/available?catalogId=…          → 取第一台 availableGpus > 0 的 nodeId
3. GET  /templates                            → 依 name 找範本（例：PyTorch 2.x + JupyterLab），確認 architectures 含機器 arch
4. POST /instances/create                     → 201，記下 data.id
5. 迴圈 GET /instances/{id}/status 每 5 秒     → RUNNING 成功；FAILED → /logs?previous=1；整體逾時 20 分鐘
6. POST /instances/{id}/exec {"command":["sh","-c","cd /vault/proj && python train.py"], "timeoutMs":120000}
      （長任務請改用 nohup / tmux 背景執行，再用 exec 查進度或用 SSH）
7. GET  /instances/{id}/resources             → 監看 gpuPct / vramPct；source == "none" 表示沒遙測
8. POST /instances/stop  {"instanceId": id}   → 停止計費（之後可 restart）；不再需要 → POST /instances/delete
```

`scripts/gputw_client.py deploy --gpu "RTX 4090" --template "PyTorch" --wait` 實作 1–5；`… stop <id>` 實作 8。

> ⚠️ 步驟 8 不能省。`RUNNING` 就在扣點數。用 `try/finally` 或 CI 的 `always()` 保證關機。

## B. 把模型放進 Vault，再開 ComfyUI

需要：`vault:write`（下載 / 上傳）、`vault:read`（確認）、部署 scopes。

```
1. POST /vault/downloads {"source":"hf:Comfy-Org/z_image:split_files/vae/z_image_vae.safetensors","targetPath":"models/vae"}
   → 202；輪詢 GET /vault/downloads/{id} 到 completed（最多 3 個同時）
   本機檔案 → 改走 07 分段上傳到 upload.gputw.ai
2. GET  /vault/list?path=models/vae            → 確認檔案在
3. GET /templates → name == "ComfyUI"（amd64）→ 部署（流程 A 步驟 1–5）
4. POST /instances/{id}/access-token {"port":8080} → 90 秒內開啟 url（或控制台 Web UI 按鈕）
   模型出現在 ComfyUI 選單（必要時重新整理）。
```

ComfyUI 類別目錄：`checkpoints`, `diffusion_models`, `text_encoders`, `vae`, `loras`, `clip_vision`, `controlnet`, `upscale_models`, `embeddings`。

## C. CI 把資料集推進 Vault（唯寫金鑰）

需要：`Upload token` preset（只有 `vault:write`）。

```
1. 控制台建立 Upload token 金鑰 → 存到 CI secret GPUTW_UPLOAD_TOKEN
2. TRANSFER=$(curl -fsS --max-time 5 https://upload.gputw.ai/health >/dev/null && echo https://upload.gputw.ai || echo https://api.gputw.ai)
3. 小檔：POST $TRANSFER/api/vault/upload?path=datasets  (-F file=@…)
   大檔：07 分段上傳（scripts/gputw_client.py upload ./data.tar --dest datasets/data.tar）
4. 完成訊號：GET /vault/uploads/{id} status == completed（唯寫金鑰也能查自己的 session）
```

唯寫金鑰不能 `GET /vault/list`——要驗證清單請用另一把 `vault:read` 金鑰，或相信 `completed` 狀態與 `sha256`。

## D. 監控閒置 GPU、自動關機

需要：`instances:read`, `instances:manage`。

```
每 5 分鐘：
  GET /instances/active
  對每台 RUNNING：
    usage.source == "none" → 略過（沒遙測，不是閒置）
    usage.gpuPct != null 且連續 6 次 (30 分鐘) < 5 → POST /instances/stop
  通知（Slack 等）附 instanceId 與 billing.hourlyRate
```

控制台另有「執行個體警示」（例如「GPU 忙碌後閒置 10 分鐘就通知」，可 Email / webhook），目前只能在控制台設定，API 金鑰不可用。

## E. 自訂映像（BYO image）

```
1. POST /instances/validate-image {"dockerImage":"ghcr.io/acme/trainer:1.4.2"}   → ok:true 才繼續
2. POST /instances/create {"nodeId":…,"customImage":{"dockerImage":"…","sshEnabled":true,
        "env":[{"name":"HF_TOKEN","value":"…"}],"args":["--port","8080"]},"ports":[8080]}
3. 輪詢 /status；PULLING_IMAGE 可能數分鐘（計費中）
4. FAILED → /logs?previous=1、/events；常見：沒在 22 監聽、Web UI 埠 < 1024、用了 :latest
```

## F. 安全關機檢查表（任何自動化結束前）

- [ ] `GET /instances/active` 沒有意外的 `RUNNING`
- [ ] 需要保留的輸出已在 `/vault`（`/workspace` 會隨刪除消失）
- [ ] `POST /instances/stop`（可能再用）或 `POST /instances/delete`（不再需要）
- [ ] 臨時 `instances:exec` 金鑰已 `DELETE /api-keys/{id}`
- [ ] Vault 的 `recovered/` 資料夾已檢視並清理（7 天後計費）

## 相關文件

- [`scripts/gputw_client.py`](../scripts/gputw_client.py)、[`scripts/examples/`](../scripts/examples/)
- 官方教學：https://gputw.ai/zh-TW/docs/tutorials
