# Python 規範（GPUtw API）

## 版本與依賴
- Python 3.9+。HTTP：`requests`（推薦）或標準庫 `urllib`（**必須設 `User-Agent`**，否則 Cloudflare 回 `403`/1010）。
- 大檔上傳用 `requests` 串流 `data=f.read(chunk)`；不要把整個檔案讀進記憶體算 sha256——分塊更新 `hashlib.sha256()`。

## 客戶端骨架
```python
import os, time, requests

API = os.environ.get("GPUTW_API", "https://api.gputw.ai/api")
KEY = os.environ["GPUTW_API_KEY"]            # 永遠從環境變數讀，不寫死
S = requests.Session()
S.headers.update({"Authorization": f"Bearer {KEY}", "User-Agent": "my-automation/1.0"})

class GputwError(RuntimeError):
    def __init__(self, status, message): super().__init__(f"{status}: {message}"); self.status = status

def call(method, path, timeout=30, **kw):
    r = S.request(method, f"{API}{path}", timeout=timeout, **kw)
    try:
        body = r.json()
    except ValueError:                      # 非 JSON → 沒到 GPUtw（Cloudflare）
        raise GputwError(r.status_code, r.text[:200])
    if not r.ok or not body.get("success"):
        raise GputwError(r.status_code, body.get("error"))
    return body["data"]
```

## 錯誤處理
- `401` / `403` 不重試（不是暫時性的）；`429` 讀 `RateLimit-Reset` 後重試；`5xx` 指數退避最多 3 次。
- `402` → 提示使用者儲值（控制台），不要迴圈重試。
- `409`（機器被搶）→ 重新 `GET /nodes/available` 換一台。

## 輪詢
```python
def wait_running(iid, timeout=1200, every=5):
    t0 = time.time()
    while True:
        st = call("GET", f"/instances/{iid}/status")
        if st["status"] == "RUNNING": return st
        if st["status"] in ("FAILED", "INSUFFICIENT_FUNDS", "STOPPED", "TERMINATED"):
            raise RuntimeError(f"{st['status']} {st.get('failureReason')}")
        if time.time() - t0 > timeout: raise TimeoutError(st)
        time.sleep(every)
```

## 型別提示
用 `TypedDict` 描述 `StatusResponse`, `ResourcesResponse`（欄位見 [04](../04-instance-runtime.md)）；指標欄位型別是 `Optional[float]`——**`None` 不是 0**。

## 保證關機
```python
iid = call("POST", "/instances/create", json=spec)["id"]
try:
    wait_running(iid); run_job(iid)
finally:
    call("POST", "/instances/stop", json={"instanceId": iid})
```

## 日誌
- 記錄 `instanceId`、狀態碼、`error` 字串；**永遠不要記錄 `Authorization` header 或 `hfToken`**。
- `exec` 的 stdout 是租戶資料，預設不落地。

## 測試
用 `responses` / `respx` 模擬信封 `{"success": true, "data": …, "error": null}`；針對 `403 missing required scope` 與 `usage.source == "none"` 各寫一個案例。
