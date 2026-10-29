# Eventora Branch Protection & Environments Architecture

## 1. Branch Protection Policy (`master`)

To guarantee zero regressions, maintain audit compliance, and prevent unauthorized production writes, the `master` branch is protected by the following GitHub Branch Protection / Ruleset rules:

### Required Protections:
1. **Require Pull Request Before Merging:**
   - Minimum required approvals: **1** (Code Owner / Lead Reviewer).
   - Dismiss stale pull request approvals when new commits are pushed: **Enabled**.
   - Require review from Code Owners: **Enabled**.
   - Restrict who can dismiss pull request reviews: **Admins only**.

2. **Required Status Checks (Must Pass Before Merge):**
   - `validate`: Static analysis, Typecheck (`pnpm typecheck`), ESLint (`pnpm lint`), Production Dependency Audit (`pnpm audit --prod`), License Check (`scripts/check-licenses.ts`), Secret Scan (Gitleaks).
   - `test`: Unit & Integration Test Suites with Postgres and Redis service containers.
   - `build`: Production build of `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`, and Docker container images (`Dockerfile.api`, `Dockerfile.web`, `Dockerfile.worker`) + Trivy vulnerability scan.
   - `e2e`: Playwright Cross-Device Test Suite (Desktop Chrome, Mobile Safari, Desktop Firefox) with Axe-Core WCAG 2.1 AA accessibility audit.

3. **Branch Hygiene & Commit Integrity:**
   - Require branches to be up to date before merging: **Enabled**.
   - Require signed commits (GPG/SSH): **Enabled**.
   - Require linear commit history (Squash or Rebase): **Enabled**.
   - Do not allow bypass: **Enabled** (Even organization administrators cannot bypass failing status checks or review requirements).

---

## 2. Environments Architecture

### Staging Environment (`staging`)
- **Trigger:** Automatic continuous deployment upon successful merge to `master`.
- **Database:** Independent Supabase PostgreSQL database (`eventora_staging`).
- **Redis:** Dedicated Staging Redis instance.
- **Payments:** Sandbox simulator / YouPI-PG Sandbox environment.
- **Transactional Email:** Resend in sandbox/test mode.
- **URL:** `https://staging.eventora.campus.edu`

### Production Environment (`production`)
- **Trigger:** Manual approval gate required via GitHub Environments protection rules.
- **Reviewers:** Release Engineering / Technical Lead approval required before trigger.
- **Database:** Production Supabase PostgreSQL with read-only replicas and point-in-time recovery.
- **Payments:** Live self-hosted YouPI-PG gateway.
- **Post-Deploy Smoke Test:** Automated curl to `/health` and `/readiness`.
- **Auto-Rollback:** If post-deploy smoke checks fail within 120 seconds, triggers `scripts/rollback.sh` to revert Canary traffic to the previous stable release.
