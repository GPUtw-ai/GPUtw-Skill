#!/usr/bin/env bash
# Server-side download of a URL / Hugging Face file straight into /vault (no instance needed).
# Usage: GPUTW_API_KEY=... ./download_hf_model.sh "hf:Comfy-Org/z_image:split_files/vae/z_image_vae.safetensors" models/vae
# Scope: vault:write (+ vault:read to poll). Runs on api.gputw.ai only - not the transfer host.
set -euo pipefail
: "${GPUTW_API_KEY:?set GPUTW_API_KEY}"
SOURCE=${1:?url or hf:<owner>/<repo>:<path>}; DEST=${2:?target path, e.g. models/vae}
API=${GPUTW_API:-https://api.gputw.ai/api}
H=(-A "gputw-skill-example/1.0" -H "Authorization: Bearer $GPUTW_API_KEY")
BODY=$(python3 -c "import json,os;print(json.dumps({'source':'$SOURCE','targetPath':'$DEST', **({'hfToken':os.environ['HF_TOKEN']} if os.environ.get('HF_TOKEN') else {})}))")

ID=$(curl -fsS -X POST "$API/vault/downloads" "${H[@]}" -H 'Content-Type: application/json' -d "$BODY" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
while :; do
  read -r STATUS DONE TOTAL < <(curl -fsS "$API/vault/downloads/$ID" "${H[@]}" | python3 -c '
import sys,json;d=json.load(sys.stdin)["data"];print(d["status"], d.get("bytesDownloaded") or 0, d.get("totalBytes") or "?")')
  echo "$STATUS $DONE/$TOTAL"
  [ "$STATUS" = completed ] && break
  { [ "$STATUS" = failed ] || [ "$STATUS" = canceled ]; } && exit 1
  sleep 3
done
