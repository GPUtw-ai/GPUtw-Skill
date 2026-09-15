#!/usr/bin/env bash
# Print GPU/VRAM utilisation against allocation for one instance; distinguishes "idle" from "no telemetry".
# Usage: GPUTW_API_KEY=... ./gpu_util_check.sh <instance-id>
# Scope: instances:read
set -euo pipefail
: "${GPUTW_API_KEY:?set GPUTW_API_KEY}"
ID=${1:?instance id}
API=${GPUTW_API:-https://api.gputw.ai/api}
curl -fsS -A "gputw-skill-example/1.0" -H "Authorization: Bearer $GPUTW_API_KEY" "$API/instances/$ID/resources" | python3 -c '
import sys, json
d = json.load(sys.stdin)["data"]; a, u, b = d["allocated"], d["usage"], d["billing"]
if u["source"] == "none":
    print(f"{d[\"instanceId\"]}: no telemetry (source=none) - metrics are null, not idle"); sys.exit(2)
gpu = "n/a" if u["gpuPct"] is None else f"{u[\"gpuPct\"]}%"
vram = "n/a" if u["vramUsedMib"] is None else f"{u[\"vramUsedMib\"]}/{a[\"vramGb\"]*1024} MiB"
print(f"{d[\"instanceId\"]} [{d[\"status\"]}] GPU {gpu}  VRAM {vram}  RAM {u[\"ramPct\"]}%  CPU {u[\"cpuPct\"]}%  (${b[\"hourlyRate\"]}/hr, source={u[\"source\"]})")
'
