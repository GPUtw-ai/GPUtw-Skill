#!/usr/bin/env bash
# Every relative markdown link must point at a file that exists.
set -uo pipefail
cd "$(dirname "$0")/../.."
fail=0
while IFS= read -r f; do
  while IFS= read -r link; do
    target=${link%%#*}
    [ -z "$target" ] && continue
    case "$target" in http*|mailto:*) continue ;; esac
    resolved="$(dirname "$f")/$target"
    if [ ! -e "$resolved" ]; then
      echo "FAIL: $f -> $target (missing)"; fail=1
    fi
  done < <(grep -oE '\]\(([^)]+)\)' "$f" | sed -E 's/^\]\((.*)\)$/\1/')
done < <(find . -name '*.md' -not -path './.git/*')
[ $fail -eq 0 ] && echo "OK: all relative links resolve"
exit $fail
