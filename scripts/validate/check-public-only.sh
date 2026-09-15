#!/usr/bin/env bash
# Guard: this repo is public and must contain only the public API contract.
# No source paths, internal component names, infrastructure details or non-production hostnames.
set -uo pipefail
cd "$(dirname "$0")/../.."
PATTERN='gputw-dev|backend/src|frontend/(app|lib|components)|apiKeyPolicy|requireAuth|serializeInstance|redactInfraIdentifiers|assertPublicHost|pinningLookup|requireVaultTransferCredit|seaweed|mergerfs|mdadm|RAID10|XFS|NFS export|k3s|kubectl|kubelet|ContainerSSH|sshpiper|flannel|Traefik|ForwardAuth|prisma|PROJECT_MEMORY|DEPLOYMENT\.md|JWT_SECRET|SECRET_BOX_KEY|NEXT_PUBLIC_|SUDO_PASSWORD|OLLAMA_|node[0-9]+-[a-z]|10\.42\.|192\.168\.|172\.1[6-9]\.'
# nvidia-smi and prometheus/DCGM appear as user-visible values, so they are allowed only in those forms.
if grep -rInE "$PATTERN" --include='*.md' --include='*.py' --include='*.sh' --include='*.yml' \
     --exclude='check-public-only.sh' . ; then
  echo "FAIL: internal identifier(s) found above - this repo is public"
  exit 1
fi
echo "OK: no internal identifiers found"
