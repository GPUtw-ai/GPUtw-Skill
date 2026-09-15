#!/usr/bin/env bash
# metadata.version in SKILL.md must match the version stamped in the other entry files.
set -euo pipefail
cd "$(dirname "$0")/../.."
V=$(sed -n 's/^  version: "\(.*\)"$/\1/p' SKILL.md | head -1)
[ -n "$V" ] || { echo "FAIL: no metadata.version in SKILL.md"; exit 1; }
fail=0
for f in README.md CHANGELOG.md AGENTS.md GEMINI.md; do
  grep -q "V$V" "$f" || { echo "FAIL: $f does not mention V$V"; fail=1; }
done
[ $fail -eq 0 ] && echo "OK: version $V in sync"
exit $fail
