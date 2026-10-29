#!/usr/bin/env bash
set -euo pipefail

RELEASE="${1:-}"

if [[ -z "${RELEASE}" ]]; then
  echo "Usage: $0 <release-ref>"
  echo "Example: $0 511d94c"
  exit 1
fi

echo "========================================================"
echo "  EVENTORA DEPLOYMENT STATE MACHINE: FAILURE HANDLER"
echo "  Failed Release: ${RELEASE}"
echo "========================================================"

# Safety Invariant: NEVER run an automatic schema down-migration on deployment failure.
# Additive migrations are backward-compatible. Running a down-migration in production
# risks dropping columns/tables with active user data and causing catastrophic data loss.
echo "==> Safety Policy: Automated database down-migrations are PROHIBITED on deploy failure."
echo "    Additive schema remains backward-compatible with previous application release."

# Step 1: Record Deployment Failure into ops_runs table if DB is reachable (best-effort)
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "==> Recording deployment failure incident into ops_runs (best-effort)..."
  pnpm --filter @eventora/backend exec tsx -e "
import { pool } from './src/db/index.js';
async function recordIncident() {
  try {
    const res = await pool.query('SELECT MAX(version) as current_version FROM schema_migrations;');
    const currentVersion = res.rows[0]?.current_version || 'unknown';
    await pool.query(\`
      INSERT INTO ops_runs (kind, started_at, finished_at, outcome, evidence_ref)
      VALUES ('deployment_failure', NOW() - INTERVAL '15 seconds', NOW(), 'FAILED', \$1::jsonb);
    \`, [JSON.stringify({
      release: '${RELEASE}',
      schemaVersion: currentVersion,
      policy: 'additive_schema_preserved_no_down_migration',
      status: 'REQUIRES_OPERATOR_REVIEW'
    })]);
    console.log('[Incident Logged] Incident recorded in ops_runs at schema version:', currentVersion);
  } catch (err) {
    console.warn('[Incident Logging Warning] Database incident logging skipped or failed:', err.message);
  } finally {
    try { await pool.end(); } catch {}
  }
}
recordIncident().catch((e) => {
  console.warn('[Incident Logging Warning] Best-effort incident recording encountered error:', e.message);
});
" || echo "[Rollback Warning] Could not connect to database to record ops_runs incident; proceeding with operator notice."
else
  echo "==> DATABASE_URL not set; skipping ops_runs incident recording."
fi

# Step 2: Operator Action Required Notice
echo "========================================================"
echo "  CRITICAL: AUTOMATED ROLLBACK REQUIRES OPERATOR ACTION"
echo "========================================================"
echo "  1. Backend API / Worker (Render):"
echo "     Navigate to Render Dashboard -> Eventora API & Worker services."
echo "     Under 'Deploys', click the previous successful deploy and select 'Rollback'."
echo ""
echo "  2. Frontend SPA (Vercel):"
echo "     Navigate to Vercel Dashboard -> Eventora Frontend project."
echo "     Under 'Deployments', locate the previous production deployment and click 'Assign Domain'."
echo ""
echo "  3. Database Schema:"
echo "     The database schema remains intact and backward-compatible."
echo "     Do NOT run down-migrations unless instructed by lead DBA after data triage."
echo "========================================================"

exit 1
