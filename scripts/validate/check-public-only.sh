#!/usr/bin/env bash
# Guard: this repo is public and must contain only the public API contract.
# No source paths, internal component names, infrastructure details or non-production hostnames.
# Scans git-tracked text files only - third-party code under node_modules is not our content.
set -uo pipefail
cd "$(dirname "$0")/../.."
PATTERN='gputw-dev|backend/src|frontend/(app|lib|components)|apiKeyPolicy|requireAuth|serializeInstance|redactInfraIdentifiers|assertPublicHost|pinningLookup|requireVaultTransferCredit|seaweed|mergerfs|mdadm|\\bRAID10\\b|\\bXFS\\b|NFS export|k3s|kubectl|kubelet|ContainerSSH|sshpiper|flannel|Traefik|ForwardAuth|prisma|PROJECT_MEMORY|DEPLOYMENT\.md|JWT_SECRET|SECRET_BOX_KEY|NEXT_PUBLIC_|SUDO_PASSWORD|OLLAMA_|node[0-9]+-[a-z]|10\.42\.|192\.168\.|172\.1[6-9]\.'
# Two exclusions, both about generated content rather than ours:
#  - mcp/dist/ is a compiled bundle of third-party code; its provenance is checked by CI
#    rebuilding it from src/, not by grepping vendor strings.
#  - package-lock.json holds base64 integrity hashes, which collide with short tokens by
#    chance (a real hash contained "XFS"). Nothing human-written lives there.
if git ls-files -z '*.md' '*.py' '*.sh' '*.yml' '*.json' '*.ts' \
  | grep -zv '^mcp/dist/' \
  | grep -zv 'package-lock.json$' \
  | grep -zv 'check-public-only.sh$' \
  | xargs -0 grep -InE "$PATTERN" ; then
  echo "FAIL: internal identifier(s) found above - this repo is public"
  exit 1
fi
echo "OK: no internal identifiers in tracked content"
