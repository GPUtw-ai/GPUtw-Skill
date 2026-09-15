# 05 · HTTP 連接埠、raw TCP/UDP 曝露與 Web UI

> SNAPSHOT 2026-09 ｜ 來源：https://gputw.ai/en/docs/ports 、/jupyter-web-ui 、/rest-api-quickstart ｜ 生成程式碼前請 web_fetch 來源頁面確認最新規格

所有端點需 `ports:manage`，執行個體必須 `RUNNING` 且屬於同帳號。變更連接埠**不需要**重啟容器。

## 兩種曝露方式

| | HTTP 連接埠 | Raw TCP/UDP 曝露 |
|---|---|---|
| 網址 | `https://<port>-<instance-id>.gputw.ai` | `tcp.gputw.ai:<公開埠>` / `udp.gputw.ai:<公開埠>` |
| 保護 | `private` / `public` / `unlisted`+密碼 | **無**——第 4 層直通，沒有擁有者 session、沒有密碼頁 |
| 適合 | Jupyter、ComfyUI、Gradio、dashboard | 遊戲伺服器、WireGuard、QUIC、自帶驗證的自訂協定 |
| 端點 | `PATCH /instances/{id}/ports` | `POST` / `DELETE /instances/{id}/exposures` |

> ⚠️ **絕對不要用 raw 曝露開放無驗證的 Web UI**（Jupyter、ComfyUI、終端機…）。平台會擋掉已知的無驗證 UI 埠並要求改用 HTTP 連接埠存取控制。

## HTTP 連接埠：`PATCH /instances/{id}/ports`

```bash
curl -fsS -X PATCH "$API/instances/$ID/ports" -A my-automation/1.0 \
  -H "Authorization: Bearer $GPUTW_API_KEY" -H "Content-Type: application/json" \
  -d '{"ports":[8080,18080],"portAccess":{"8080":{"mode":"unlisted","password":"strong-password1"},"18080":{"mode":"public"}}}'
```

| 欄位 | 規則 |
|---|---|
| `ports[]` | 完整的連接埠清單（**取代**現有清單）；`1024–65535`，排除 `2222`, `6443`, `9000–9999`；最多 20 個 |
| `portAccess["<port>"].mode` | `private`（預設；只有擁有者透過控制台交接能開）／ `public`（有網址就能連）／ `unlisted`（有網址還要先過 GPUtw 密碼頁） |
| `portAccess["<port>"].password` | `unlisted` 用；≥ 8 字元、含字母與數字。伺服器端以 bcrypt 儲存，永不回傳；省略則保留原密碼 |

回應是更新後的執行個體物件（`allowedPorts[]`, `portAccess{ "<port>": { mode, hasPassword } }`）。

選擇模式（給 AI 建議用）：個人 notebook / dashboard → `private`；分享連結給協作者 → `unlisted` + 密碼；服務本身有驗證或內容本來就公開 → `public`。

## Raw TCP/UDP：`POST /instances/{id}/exposures`

```bash
curl -fsS -X POST "$API/instances/$ID/exposures" -A my-automation/1.0 \
  -H "Authorization: Bearer $GPUTW_API_KEY" -H "Content-Type: application/json" \
  -d '{"protocol":"tcp","containerPort":25565}'
# → 201 { "id": "…", "protocol": "tcp", "containerPort": 25565, "publicPort": 31000, "endpoint": "tcp.gputw.ai:31000", "createdAt": "…" }
```

- `protocol`: `tcp` 或 `udp`；`containerPort`: `1024–65535`。
- 公開埠由平台指派；TCP 與 UDP 的埠號各自獨立配置，同一個數字可能同時出現在兩邊。
- `DELETE /instances/{id}/exposures/{exposureId}` 移除並釋放公開埠 → `{ "removed": true }`。

## 費用

- 範本的 Web UI 埠（通常 `8080`）免費。
- 每台執行個體另含 **3 個**免費的額外連接埠；超過的 HTTP 連接埠或 raw 曝露每個依設定的每小時連接埠費計費（顯示在執行個體的 `extraPortFee`）。

## 開啟 Web UI（Jupyter / ComfyUI）

控制台的「Web UI」按鈕會鑄造一個短效存取網址，然後在瀏覽器留下該執行個體專用的 cookie。API 對應：`POST /instances/{id}/access-token` `{ "port": 8080, "path": "" }` → `{ url, token, port, expiresIn: 90 }`，網址形如 `https://8080-<instance-id>.gputw.ai/?__t=<token>`，**90 秒內**要開啟。適合腳本把 Jupyter 連結丟給使用者。

> 💡 Brave 瀏覽器 ipywidgets 不顯示 → Brave Shields 擋了 Jupyter 需要的 CDN（unpkg / jsdelivr）；對該執行個體網域關閉 Shields 後重新整理。

## 相關文件

- [03 · 生命週期](./03-instances-lifecycle.md)（`create` 時的 `ports`）｜ [09 · 帳務](./09-account-billing-teams.md)
- 官方：https://gputw.ai/zh-TW/docs/ports 、https://gputw.ai/zh-TW/docs/jupyter-web-ui
