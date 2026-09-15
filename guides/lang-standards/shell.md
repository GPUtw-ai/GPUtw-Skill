# Shell / curl 規範（GPUtw API）

## 基本樣板
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${GPUTW_API_KEY:?set GPUTW_API_KEY}"
API=${GPUTW_API:-https://api.gputw.ai/api}
UA="my-automation/1.0"
H=(-A "$UA" -H "Authorization: Bearer $GPUTW_API_KEY")
j() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["data"]'"$1"')'; }   # 取 data 的子欄位

gputw() {  # gputw METHOD PATH [JSON]
  local m=$1 p=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -fsS -X "$m" "$API$p" "${H[@]}" -H 'Content-Type: application/json' -d "$body"
  else
    curl -fsS -X "$m" "$API$p" "${H[@]}"
  fi
}
```

## 規則
- `-fsS`：非 2xx 直接失敗（`set -e` 會停），但錯誤訊息在 body——需要訊息時改用 `-sS -w '\n%{http_code}'` 再自行判斷。
- 一律帶 `-A "$UA"`；金鑰只在 header，**不要**放 URL。
- JSON 解析用 `python3 -c` 或 `jq`；不要用 grep 抓欄位。
- 輪詢 `GET /instances/{id}/status`，`sleep 5`，並設 `SECONDS` 上限。
- 用 `trap 'gputw POST /instances/stop "{\"instanceId\":\"$ID\"}"' EXIT` 保證關機。
- 分段上傳用 `split -b "$CHUNK"`（`CHUNK` 取自 session 回應）；上傳完 `rm -f part-*`。
- 大檔走 `https://upload.gputw.ai/api`，先 `curl -fsS --max-time 5 https://upload.gputw.ai/health`。

## 範例
`scripts/examples/deploy_and_wait.sh`、`upload_to_vault.sh`、`download_hf_model.sh`、`gpu_util_check.sh`。
