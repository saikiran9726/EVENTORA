import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase P06: Frontend Foundation B (Router, Guards, Boundaries & Skeletons)', () => {
  const frontendSrcDir = path.resolve(process.cwd(), 'packages/frontend/src');

  function getSourceFiles(dir: string): string[] {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getSourceFiles(fullPath));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('proves zero occurrences of manual role switcher ("Switch User Role") in frontend codebase', () => {
    const files = getSourceFiles(frontendSrcDir);
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        if (lineText.includes('Switch User Role')) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: idx + 1,
            text: lineText.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Found forbidden manual role switcher in frontend: ${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });

  it('proves zero occurrences of "mock-event-id" in frontend codebase', () => {
    const files = getSourceFiles(frontendSrcDir);
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        if (lineText.includes('mock-event-id')) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: idx + 1,
            text: lineText.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Found forbidden mock-event-id in frontend: ${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });

  it('verifies react-router-dom v6 route table in App.tsx covers canonical URLs', () => {
    const appPath = path.resolve(frontendSrcDir, 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    // Declarative React Router components
    expect(appContent).toContain('BrowserRouter');
    expect(appContent).toContain('<Routes>');
    expect(appContent).toContain('<Route');

    // Canonical route endpoints required by P06 specification
    const requiredRoutes = [
      'path="/"',
      'path="/events/:slug"',
      'path="/checkout/:bookingId"',
      'path="/tickets"',
      'path="/tickets/:id"',
      'path="/calendar"',
      'path="/teams"',
      'path="/volunteers"',
      'path="/passport"',
      'path="/p/:slug"',
      'path="/verify"',
      'path="/profile"',
      'path="/organizer"',
      'path="/review"',
      'path="/admin"',
      'path="/scan"',
      'path="/login"',
      'path="/register"',
      'path="/forgot"',
      'path="/reset/:token"',
      'path="/verify-email/:token"',
      'path="*"',
    ];

    for (const route of requiredRoutes) {
      expect(appContent, `Missing route declaration: ${route}`).toContain(route);
    }
  });

  it('verifies code-split lazy routes with Suspense fallback skeletons in App.tsx', () => {
    const appPath = path.resolve(frontendSrcDir, 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    expect(appContent).toContain('React.lazy');
    expect(appContent).toContain('RouteSkeleton');
    expect(appContent).toContain('<Suspense fallback={<RouteSkeleton />}>');
  });

  it('verifies root and route-level ErrorBoundary with retry and request-id diagnostics', () => {
    const errorBoundaryPath = path.resolve(frontendSrcDir, 'components', 'layout', 'ErrorBoundary.tsx');
    expect(fs.existsSync(errorBoundaryPath)).toBe(true);

    const errorBoundaryContent = fs.readFileSync(errorBoundaryPath, 'utf8');
    expect(errorBoundaryContent).toContain('handleRetry');
    expect(errorBoundaryContent).toContain('requestId');
    expect(errorBoundaryContent).toContain('Request ID:');

    const appPath = path.resolve(frontendSrcDir, 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    expect(appContent).toContain('<ErrorBoundary');
  });

  it('verifies RequireAuth and RequireRole guards derive authorization solely from server data', () => {
    const guardsPath = path.resolve(frontendSrcDir, 'components', 'auth', 'RouteGuards.tsx');
    expect(fs.existsSync(guardsPath)).toBe(true);

    const guardsContent = fs.readFileSync(guardsPath, 'utf8');
    expect(guardsContent).toContain('user.globalRole');
    expect(guardsContent).toContain('user.organizerMemberships');
    expect(guardsContent).toContain('user.staffAssignments');
    expect(guardsContent).toContain('ForbiddenPage');
    expect(guardsContent).toContain('returnTo');
  });

  it('verifies dedicated 404 (NotFoundPage) and 403 (ForbiddenPage) components exist and render recovery actions', () => {
    const notFoundPath = path.resolve(frontendSrcDir, 'pages', 'NotFoundPage.tsx');
    const forbiddenPath = path.resolve(frontendSrcDir, 'pages', 'ForbiddenPage.tsx');

    expect(fs.existsSync(notFoundPath)).toBe(true);
    expect(fs.existsSync(forbiddenPath)).toBe(true);

    const notFoundContent = fs.readFileSync(notFoundPath, 'utf8');
    expect(notFoundContent).toContain('404');
    expect(notFoundContent).toContain('Page Not Found');

    const forbiddenContent = fs.readFileSync(forbiddenPath, 'utf8');
    expect(forbiddenContent).toContain('403');
    expect(forbiddenContent).toContain('Access Denied');
  });

  it('verifies ScannerPage includes active event picker when no eventId is in route', () => {
    const scannerPath = path.resolve(frontendSrcDir, 'pages', 'ScannerPage.tsx');
    const scannerContent = fs.readFileSync(scannerPath, 'utf8');

    expect(scannerContent).toContain('Select Event to Scan');
    expect(scannerContent).toContain('/api/v1/events');
    expect(scannerContent).toContain('Switch Event');
  });
});
