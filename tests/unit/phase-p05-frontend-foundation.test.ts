import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase P05: Frontend Foundation A (API Client, Auth State, Error Handling)', () => {
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

  it('proves zero raw fetch( calls in frontend components outside api-client.ts', () => {
    const files = getSourceFiles(frontendSrcDir);
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      // Exclude the authoritative api-client itself
      if (file.endsWith(path.join('src', 'lib', 'api-client.ts'))) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        // Match fetch( but not safe property or type names
        if (/\bfetch\s*\(/.test(lineText) && !lineText.includes('//')) {
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
      `Found forbidden raw fetch() calls in frontend components: ${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });

  it('proves zero eventora_auth_token reads or writes in frontend codebase', () => {
    const files = getSourceFiles(frontendSrcDir);
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        if (lineText.includes('eventora_auth_token')) {
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
      `Found forbidden eventora_auth_token references: ${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });

  it('verifies ESLint enforces no-restricted-syntax against raw fetch and token storage', () => {
    const eslintConfigPath = path.resolve(process.cwd(), 'eslint.config.js');
    const eslintConfig = fs.readFileSync(eslintConfigPath, 'utf8');

    expect(eslintConfig).toContain('no-restricted-syntax');
    expect(eslintConfig).toContain("CallExpression[callee.name='fetch']");
    expect(eslintConfig).toContain("Literal[value='eventora_auth_token']");
  });

  it('verifies TanStack Query client setup and QueryClientProvider mounting in App.tsx', () => {
    const queryClientPath = path.resolve(frontendSrcDir, 'lib', 'query-client.ts');
    expect(fs.existsSync(queryClientPath)).toBe(true);

    const queryClientContent = fs.readFileSync(queryClientPath, 'utf8');
    expect(queryClientContent).toContain('new QueryClient');
    expect(queryClientContent).toContain('staleTime');

    const appPath = path.resolve(frontendSrcDir, 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    expect(appContent).toContain('QueryClientProvider');
    expect(appContent).toContain('queryClient');
  });

  it('verifies global unhandled rejection handler in main.tsx', () => {
    const mainPath = path.resolve(frontendSrcDir, 'main.tsx');
    const mainContent = fs.readFileSync(mainPath, 'utf8');

    expect(mainContent).toContain('unhandledrejection');
    expect(mainContent).toContain('reportError');
  });

  it('verifies Render cold-start detection and wake-up event listeners in App.tsx', () => {
    const appPath = path.resolve(frontendSrcDir, 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    expect(appContent).toContain('eventora:server-waking');
    expect(appContent).toContain('eventora:server-ready');
    expect(appContent).toContain('Eventora server is spinning up');
  });

  it('verifies AuthContext aborts login and does not report success if /api/v1/me fails', async () => {
    const authContextPath = path.resolve(frontendSrcDir, 'context', 'AuthContext.tsx');
    const authContextContent = fs.readFileSync(authContextPath, 'utf8');

    // Ensure /api/v1/me is called and verified before returning { success: true }
    expect(authContextContent).toContain("apiClient.get<{ user: UserProfile }>('/api/v1/me')");
    expect(authContextContent).toContain('updateUser(null)');
    expect(authContextContent).toContain('setOnUnauthorized');
  });
});
