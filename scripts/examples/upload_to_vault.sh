#!/usr/bin/env bash
# Chunked, resumable upload of one local file into /vault via the transfer host.
# Usage: GPUTW_API_KEY=<Upload token> ./upload_to_vault.sh ./model.safetensors models/model.safetensors
# Scope: vault:write (the `Upload token` preset is enough)
set -euo pipefail
: "${GPUTW_API_KEY:?set GPUTW_API_KEY}"
FILE=${1:?local file}; DEST=${2:?vault path, e.g. models/x.safetensors}
UA="gputw-skill-example/1.0"
H=(-A "$UA" -H "Authorization: Bearer $GPUTW_API_KEY")

# transfer host: no 100 MB cap / ~100 s timeout; fall back to the API host if absent
API=https://upload.gputw.ai/api
curl -fsS --max-time 5 -A "$UA" https://upload.gputw.ai/health >/dev/null 2>&1 || API=${GPUTW_API:-https://api.gputw.ai/api}
echo "transfers -> $API"

SIZE=$(stat -c%s "$FILE"); SHA=$(sha256sum "$FILE" | cut -d' ' -f1)
SESSION=$(curl -fsS -X POST "$API/vault/uploads" "${H[@]}" -H 'Content-Type: application/json' \
  -d "{\"path\":\"$DEST\",\"size\":$SIZE,\"sha256\":\"$SHA\"}")
ID=$(echo "$SESSION"    | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["uploadId"])')
CHUNK=$(echo "$SESSION" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["chunkSize"])')   # server-chosen, authoritative
PARTS=$(echo "$SESSION" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["partCount"])')

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
split -b "$CHUNK" -d -a 5 "$FILE" "$TMP/part-"
i=0
for p in "$TMP"/part-*; do
  curl -fsS -X PUT "$API/vault/uploads/$ID/parts/$i" "${H[@]}" -H 'Content-Type: application/octet-stream' \
    --data-binary "@$p" > /dev/null
  echo "part $((i+1))/$PARTS"; i=$((i+1))
done

curl -fsS -X POST "$API/vault/uploads/$ID/complete" "${H[@]}" > /dev/null
while :; do
  STATUS=$(curl -fsS "$API/vault/uploads/$ID" "${H[@]}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')
  echo "status: $STATUS"
  [ "$STATUS" = completed ] && break
  [ "$STATUS" = failed ] && exit 1
  sleep 2
done
