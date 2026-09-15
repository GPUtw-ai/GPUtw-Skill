#!/usr/bin/env bash
# Weekly: every official URL referenced in references/docs-site.md must still answer 200.
set -uo pipefail
cd "$(dirname "$0")/../.."
fail=0
mapfile -t urls < <(grep -ohE 'https://[a-z.]*gputw\.ai[^ )|]*' references/docs-site.md | sed 's/[.,]$//' | sort -u)
for u in "${urls[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -A "gputw-skill-ci/1.0" "$u" || echo 000)
  case "$code" in
    200|30[178]) printf '  %s %s\n' "$code" "$u" ;;
    *) printf 'FAIL %s %s\n' "$code" "$u"; fail=1 ;;
  esac
done
[ $fail -eq 0 ] && echo "OK: ${#urls[@]} documentation URLs reachable"
exit $fail
