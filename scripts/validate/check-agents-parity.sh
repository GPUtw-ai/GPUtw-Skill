#!/usr/bin/env bash
# AGENTS.md and GEMINI.md must carry byte-identical shared sections.
set -euo pipefail
cd "$(dirname "$0")/../.."
extract() { awk '/^## 決策樹$/,/^## 即時 API 規格$/' "$1" | sed '$d'; }
if diff <(extract AGENTS.md) <(extract GEMINI.md) > /tmp/parity.diff; then
  echo "OK: AGENTS.md and GEMINI.md shared sections identical"
else
  echo "FAIL: AGENTS.md and GEMINI.md diverge:"; cat /tmp/parity.diff; exit 1
fi
