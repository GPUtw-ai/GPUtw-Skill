#!/usr/bin/env bash
# Guard: this repo is public and must contain only the public API contract.
# Internal names live in denylist.sha256 as hashes only, so this guard does not itself publish them.
# Scans git-tracked text files only - third-party code under node_modules is not our content.
set -uo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import hashlib, re, subprocess, sys
deny = {l.strip() for l in open("scripts/validate/denylist.sha256") if l.strip() and not l.startswith("#")}
files = subprocess.run(["git", "ls-files", "-z", "*.md", "*.py", "*.sh", "*.yml", "*.json", "*.ts"],
                       capture_output=True, text=True).stdout.split("\0")
# mcp/dist is a compiled bundle of third-party code (CI rebuilds it from src/); package-lock.json holds
# base64 integrity hashes that collide with short tokens by chance. Nothing human-written lives there.
files = [f for f in files if f and not f.startswith("mcp/dist/") and not f.endswith("package-lock.json")]
private_ip = re.compile(r"\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b")
bad = 0
for f in files:
    for n, line in enumerate(open(f, encoding="utf-8", errors="ignore"), 1):
        toks = set(re.findall(r"[A-Za-z0-9_./-]{3,}", line))
        toks |= {p for t in list(toks) for p in re.split(r"[./-]", t) if len(p) >= 3}
        hit = [t for t in toks if hashlib.sha256(t.lower().encode()).hexdigest()[:16] in deny]
        if hit or private_ip.search(line):
            bad += 1
            print(f"{f}:{n}: internal identifier or private address")
if bad:
    print("FAIL: internal identifier(s) found above - this repo is public"); sys.exit(1)
print("OK: no internal identifiers in tracked content")
PY
