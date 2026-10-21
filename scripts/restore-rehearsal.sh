#!/usr/bin/env bash
set -euo pipefail

echo "==> Running Disaster Recovery & Restore Rehearsal..."
pnpm --filter @eventora/backend exec tsx ../../scripts/restore-rehearsal.ts
echo "==> Rehearsal Complete."
