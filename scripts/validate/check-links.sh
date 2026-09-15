#!/usr/bin/env bash
# Every relative markdown link in a TRACKED file must point at a file that exists.
# Scans git-tracked files only, so dependency READMEs under node_modules are ignored.
set -uo pipefail
cd "$(dirname "$0")/../.."
fail=0
while IFS= read -r f; do
  while IFS= read -r link; do
    target=${link%%#*}
    [ -z "$target" ] && continue
    case "$target" in http*|mailto:*|\$*) continue ;; esac
    if [ ! -e "$(dirname "$f")/$target" ]; then
      echo "FAIL: $f -> $target (missing)"; fail=1
    fi
  done < <(grep -oE '\]\(([^)]+)\)' "$f" | sed -E 's/^\]\((.*)\)$/\1/')
done < <(git ls-files '*.md')
[ $fail -eq 0 ] && echo "OK: all relative links in tracked files resolve"
exit $fail
