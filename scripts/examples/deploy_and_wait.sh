#!/usr/bin/env bash
# Deploy a GPU instance with a template, wait for RUNNING, print the SSH command.
# Usage: GPUTW_API_KEY=... ./deploy_and_wait.sh "RTX 4090" "PyTorch"
# Scopes: catalog:read instances:read instances:create (the `deploy` preset)
set -euo pipefail
: "${GPUTW_API_KEY:?set GPUTW_API_KEY}"
API=${GPUTW_API:-https://api.gputw.ai/api}
UA="gputw-skill-example/1.0"
GPU=${1:-"RTX 4090"}; TEMPLATE=${2:-"PyTorch"}
H=(-A "$UA" -H "Authorization: Bearer $GPUTW_API_KEY")
py() { python3 -c "$1"; }

# 1. catalog -> catalogId (public endpoint)
CATALOG_ID=$(curl -fsS -A "$UA" "$API/gpus/active" | py "
import sys,json;g=[x for x in json.load(sys.stdin)['data'] if '$GPU'.lower() in x['name'].lower()]
print(g[0]['id'] if g else '')")
[ -n "$CATALOG_ID" ] || { echo "no GPU matching '$GPU'"; exit 1; }

# 2. available machines -> nodeId + arch
read -r NODE_ID ARCH < <(curl -fsS "${H[@]}" "$API/nodes/available?catalogId=$CATALOG_ID" | py "
import sys,json;n=[x for x in json.load(sys.stdin)['data'] if (x.get('availableGpus') or 0)>0]
print(n[0]['id'], n[0].get('arch','amd64')) if n else print('', '')")
[ -n "$NODE_ID" ] || { echo "no free machine for '$GPU' right now"; exit 1; }

# 3. template -> templateId (must support the machine's arch)
TEMPLATE_ID=$(curl -fsS -A "$UA" "$API/templates" | py "
import sys,json;t=[x for x in json.load(sys.stdin)['data'] if '$TEMPLATE'.lower() in x['name'].lower() and '$ARCH' in x.get('architectures',[])]
print(t[0]['id'] if t else '')")
[ -n "$TEMPLATE_ID" ] || { echo "no template matching '$TEMPLATE' for $ARCH"; exit 1; }

# 4. create
ID=$(curl -fsS -X POST "$API/instances/create" "${H[@]}" -H 'Content-Type: application/json' \
  -d "{\"nodeId\":\"$NODE_ID\",\"templateId\":\"$TEMPLATE_ID\",\"ports\":[8080]}" \
  | py 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
echo "created $ID"

# 5. poll /status (cheap, built for polling) until RUNNING; fail on terminal states
SECONDS=0
while :; do
  read -r STATUS PHASE REASON < <(curl -fsS "${H[@]}" "$API/instances/$ID/status" | py '
import sys,json;d=json.load(sys.stdin)["data"];print(d["status"], d.get("deployPhase") or "-", d.get("failureReason") or "-")')
  echo "  $STATUS $PHASE $REASON"
  case "$STATUS" in
    RUNNING) break ;;
    FAILED|INSUFFICIENT_FUNDS|STOPPED|TERMINATED) echo "ended in $STATUS"; curl -fsS "${H[@]}" "$API/instances/$ID/logs?tail=50&previous=1"; exit 1 ;;
  esac
  [ "$SECONDS" -lt 1200 ] || { echo "timeout"; exit 1; }
  sleep 5
done
echo "ssh pod-$ID@ssh.gputw.ai -p 2222"
echo "stop when done:  curl -X POST $API/instances/stop -A $UA -H 'Authorization: Bearer \$GPUTW_API_KEY' -H 'Content-Type: application/json' -d '{\"instanceId\":\"$ID\"}'"
