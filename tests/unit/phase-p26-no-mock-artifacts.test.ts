import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase P26: Remove Every Mock / Prototype Artifact Quality Gate', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const frontendSrc = path.join(repoRoot, 'packages/frontend/src');
  const distAssets = path.join(repoRoot, 'packages/frontend/dist/assets');

  function getAllFiles(dir: string, ext = ['.ts', '.tsx']): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getAllFiles(fullPath, ext));
      } else if (ext.some((e) => entry.name.endsWith(e))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('ESLint configuration forbids mock and prototype imports in frontend src', () => {
    const eslintConfigPath = path.join(repoRoot, 'eslint.config.js');
    expect(fs.existsSync(eslintConfigPath)).toBe(true);
    const content = fs.readFileSync(eslintConfigPath, 'utf8');

    expect(content).toContain('no-restricted-imports');
    expect(content).toContain('**/mock/**');
    expect(content).toContain('**/prototype/**');
  });

  it('Zero production frontend source files import mock or prototype modules', () => {
    const srcFiles = getAllFiles(frontendSrc);
    const nonTestFiles = srcFiles.filter(
      (f) =>
        !f.includes('.test.') &&
        !f.includes('.spec.') &&
        !f.includes('.stories.') &&
        !f.includes(`${path.sep}mock${path.sep}`) &&
        !f.includes(`${path.sep}prototype${path.sep}`)
    );

    const violatingFiles: { file: string; line: string }[] = [];
    const forbiddenImportRegex = /from\s+['"][^'"]*(?:mock|prototype)[^'"]*['"]/;

    for (const file of nonTestFiles) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const [idx, line] of lines.entries()) {
        if (forbiddenImportRegex.test(line)) {
          violatingFiles.push({ file: path.relative(repoRoot, file), line: `${idx + 1}: ${line.trim()}` });
        }
      }
    }

    expect(violatingFiles).toEqual([]);
  });

  it('Zero production components contain hardcoded mock IDs (aarav-patel, evt-demo, bkg_demo_, team-mock-1)', () => {
    const srcFiles = getAllFiles(frontendSrc);
    const nonTestFiles = srcFiles.filter(
      (f) =>
        !f.includes('.test.') &&
        !f.includes('.spec.') &&
        !f.includes('.stories.') &&
        !f.includes(`${path.sep}mock${path.sep}`) &&
        !f.includes(`${path.sep}prototype${path.sep}`)
    );

    const forbiddenPatterns = ['aarav-patel', 'evt-demo', 'bkg_demo_', 'team-mock-1'];
    const violations: { file: string; pattern: string; line: string }[] = [];

    for (const file of nonTestFiles) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const [idx, line] of lines.entries()) {
        for (const pattern of forbiddenPatterns) {
          if (line.includes(pattern)) {
            violations.push({
              file: path.relative(repoRoot, file),
              pattern,
              line: `${idx + 1}: ${line.trim()}`,
            });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('Production bundle is 100% clean of mock/prototype strings', () => {
    expect(fs.existsSync(distAssets)).toBe(true);
    const jsBundleFiles = fs
      .readdirSync(distAssets)
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(distAssets, f));

    expect(jsBundleFiles.length).toBeGreaterThan(0);

    const forbiddenBundleStrings = [
      'PROTOTYPE_EVENTS',
      'MOCK_BANNER_TEXT',
      'aarav-patel',
      'evt-demo',
      'bkg_demo_',
      'team-mock-1',
      'mock/data',
      'prototype/data',
    ];

    const bundleViolations: { file: string; match: string }[] = [];

    for (const bundleFile of jsBundleFiles) {
      const content = fs.readFileSync(bundleFile, 'utf8');
      for (const forbidden of forbiddenBundleStrings) {
        if (content.includes(forbidden)) {
          bundleViolations.push({
            file: path.basename(bundleFile),
            match: forbidden,
          });
        }
      }
    }

    expect(bundleViolations).toEqual([]);
  });

  it('/components route is guarded by import.meta.env.DEV in App.tsx', () => {
    const appPath = path.join(frontendSrc, 'App.tsx');
    const content = fs.readFileSync(appPath, 'utf8');

    expect(content).toContain('path="/components"');
    expect(content).toContain('import.meta.env.DEV ?');
    expect(content).toContain('<ComponentGalleryPage />');
    expect(content).toContain('<Navigate to="/" replace />');
  });

  it('All shell components gate demo banners behind VITE_DEMO_MODE compile-time check', () => {
    const shellFiles = [
      path.join(frontendSrc, 'components/layout/AppShell.tsx'),
      path.join(frontendSrc, 'components/shells/AdminShell.tsx'),
      path.join(frontendSrc, 'components/shells/CheckinShell.tsx'),
      path.join(frontendSrc, 'components/shells/OrganizerShell.tsx'),
      path.join(frontendSrc, 'components/shells/ReviewerShell.tsx'),
      path.join(frontendSrc, 'components/shells/StudentShell.tsx'),
    ];

    for (const shellPath of shellFiles) {
      const content = fs.readFileSync(shellPath, 'utf8');
      expect(content).toContain("import.meta.env.VITE_DEMO_MODE === 'true'");
      expect(content).not.toContain("PROTOTYPE_BADGE_TEXT");
      expect(content).not.toContain("MOCK_BANNER_TEXT");
    }
  });
});
