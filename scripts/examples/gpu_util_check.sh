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

d = json.load(sys.stdin)["data"]
a, u, b = d["allocated"], d["usage"], d["billing"]
iid, status, source = d["instanceId"], d["status"], u["source"]

if source == "none":
    # No telemetry: every metric is null. That is NOT the same as an idle instance at 0%.
    print(iid + ": no telemetry (source=none) - metrics are null, not idle")
    sys.exit(2)

gpu_pct, vram_mib, vram_cap = u["gpuPct"], u["vramUsedMib"], a["vramGb"] * 1024
ram_pct, cpu_pct, rate = u["ramPct"], u["cpuPct"], b["hourlyRate"]
gpu = "n/a" if gpu_pct is None else f"{gpu_pct}%"
vram = "n/a" if vram_mib is None else f"{vram_mib}/{vram_cap} MiB"
print(f"{iid} [{status}] GPU {gpu}  VRAM {vram}  RAM {ram_pct}%  CPU {cpu_pct}%  (${rate}/hr, source={source})")
'
