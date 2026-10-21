#!/usr/bin/env bash
set -euo pipefail

TARGET_VERSION="${1:-10}"
echo "==> [Migrate Down] Rolling back schema to version: ${TARGET_VERSION}"

pnpm --filter @eventora/backend exec tsx src/db/migrate-down.ts "${TARGET_VERSION}"

echo "==> [Migrate Down] Completed successfully."
