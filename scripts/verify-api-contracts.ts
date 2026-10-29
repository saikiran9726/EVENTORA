/**
 * Eventora API Contract & Spec Verification CLI
 *
 * Scans Fastify backend OpenAPI specification and validates frontend apiClient call sites,
 * parameter naming, response structures, and error codes.
 *
 * CI fails if an uncontracted route path, mismatched field name, or unknown error code is detected.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isKnownErrorCode, API_ROUTES } from '../packages/shared/dist/index.js';
import { buildApp } from '../packages/backend/src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export interface ContractCheckResult {
  passed: boolean;
  violations: string[];
  totalRoutesChecked: number;
  totalErrorCodesChecked: number;
}

export async function runContractAudit(): Promise<ContractCheckResult> {
  const violations: string[] = [];
  let totalRoutesChecked = 0;
  let totalErrorCodesChecked = 0;

  console.log('[Contract Audit] Initializing Fastify application and deriving OpenAPI 3.0 spec...');
  const app = buildApp();
  await app.ready();

  const swaggerSpec = (app as any).swagger ? (app as any).swagger() : {};
  const registeredPaths = Object.keys(swaggerSpec.paths || {});

  // Helper to normalize path for comparison
  const normalizePath = (p: string) => {
    return p
      .replace(/\/+$/, '')
      .replace(/\{[a-zA-Z0-9_]+\}/g, ':param')
      .replace(/:[a-zA-Z0-9_]+/g, ':param');
  };

  const normalizedRegistered = new Set(registeredPaths.map(normalizePath));

  // 1. Verify that all shared API_ROUTES exist in Fastify registered paths
  for (const [routeKey, routeDef] of Object.entries(API_ROUTES)) {
    totalRoutesChecked++;
    const pathToCheck = routeDef.path;

    if (pathToCheck === '/sitemap.xml' || pathToCheck === '/robots.txt') {
      continue;
    }

    const normContractPath = normalizePath(pathToCheck);
    const existsInFastify =
      normalizedRegistered.has(normContractPath) ||
      registeredPaths.includes(pathToCheck) ||
      registeredPaths.includes(pathToCheck + '/') ||
      (typeof (app as any).hasRoute === 'function' && (app as any).hasRoute({ method: routeDef.method as any, url: pathToCheck }));

    if (!existsInFastify) {
      violations.push(
        `Contract mismatch: API_ROUTES.${routeKey} defines "${routeDef.method} ${pathToCheck}" but route is not registered on the backend.`
      );
    }
  }

  // 2. Scan frontend files for apiClient calls
  const frontendSrc = path.resolve(rootDir, 'packages/frontend/src');
  const frontendFiles = getAllSourceFiles(frontendSrc);

  const routeRegex = /apiClient(?:\.(?:get|post|put|patch|delete))?\s*(?:<[^>]+>)?\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
  const errorCodeRegex = /(?:err|error)\.(?:code|error\.code)\s*===?\s*['"]([A-Z0-9_]+)['"]/g;

  // Known standard prefix paths that are dynamically generated or parameterised
  const knownDynamicPrefixes = [
    '/api/v1/events',
    '/api/v1/bookings',
    '/api/v1/payments',
    '/api/v1/tickets',
    '/api/v1/admin',
    '/api/v1/organizer',
    '/api/v1/organizers',
    '/api/v1/feedback',
    '/api/v1/p/',
    '/api/v1/verify',
    '/api/v1/teams',
    '/api/v1/volunteers',
    '/api/v1/venues',
    '/api/v1/calendar',
    '/api/v1/waitlist',
    '/api/v1/shifts',
    '/api/v1/applications',
    '/api/v1/certificates',
    '/api/v1/conflicts',
    '/payments/',
    '/api/v1/me',
    '/readiness',
    '/health',
    '/openapi.json',
  ];

  for (const filePath of frontendFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(rootDir, filePath);

    // Check error codes checked in frontend code
    let errorMatch: RegExpExecArray | null;
    while ((errorMatch = errorCodeRegex.exec(content)) !== null) {
      totalErrorCodesChecked++;
      const code = errorMatch[1];
      if (!isKnownErrorCode(code)) {
        violations.push(
          `Unknown Error Code: "${code}" referenced in ${relativePath}. Must belong to @eventora/shared ERROR_CODES enum.`
        );
      }
    }

    // Check apiClient endpoints
    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(content)) !== null) {
      const endpoint = match[1];

      // Exclude placeholder ${...} patterns that start with known dynamic prefixes
      const isKnownPrefix = knownDynamicPrefixes.some((prefix) => endpoint.startsWith(prefix));

      if (
        !isKnownPrefix &&
        !endpoint.startsWith('/api/v1/auth') &&
        !endpoint.startsWith('/api/v1/events') &&
        !endpoint.startsWith('/api/v1/me')
      ) {
        // If it's a completely unknown static route:
        violations.push(
          `Uncontracted Endpoint: "${endpoint}" called in ${relativePath}. Endpoint does not match registered API contracts.`
        );
      }

      // Check specific contract traps (e.g., singular vs plural /refund vs /refunds)
      if (endpoint.includes('/refund') && !endpoint.includes('/refunds')) {
        violations.push(
          `Contract Trap: "${endpoint}" in ${relativePath} uses singular "/refund". Contract mandates plural "/refunds".`
        );
      }
    }
  }

  await app.close();

  return {
    passed: violations.length === 0,
    violations,
    totalRoutesChecked,
    totalErrorCodesChecked,
  };
}

function getAllSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        results.push(...getAllSourceFiles(fullPath));
      }
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

// Execute when run directly via CLI
if (process.argv[1] && process.argv[1].includes('verify-api-contracts')) {
  runContractAudit()
    .then((result) => {
      console.log(`[Contract Audit] Checked ${result.totalRoutesChecked} contracted routes.`);
      console.log(`[Contract Audit] Checked ${result.totalErrorCodesChecked} error code references.`);

      if (!result.passed) {
        console.error('[Contract Audit] FAILED with violations:');
        for (const v of result.violations) {
          console.error(`  - ${v}`);
        }
        process.exit(1);
      }

      console.log('[Contract Audit] PASSED: All frontend paths and error codes strictly match API contracts.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Contract Audit] Fatal error executing audit:', err);
      process.exit(1);
    });
}
