import { Page, TestInfo } from '@playwright/test';
import path from 'path';

/**
 * Safe deterministic screenshot helper for concurrent multi-viewport Playwright execution on Windows.
 * - Prevents concurrent worker collisions on shared canonical screenshot paths.
 * - Captures desktop canonical evidence from Desktop-1280 (or Mobile-375 for mobile-specific tests).
 * - Always captures project-scoped evidence when the filename already includes the project name.
 * - Implements exponential retry backoff against transient Windows NTFS file locking.
 */
export async function safeScreenshot(page: Page, targetPath: string, testInfo?: TestInfo) {
  const resolvedPath = path.resolve(targetPath);
  const projectName = testInfo?.project?.name;

  // If the path is already project-scoped (e.g. phase7-01-...-Desktop-1280.png), always capture it.
  // Otherwise, only capture canonical desktop screenshots on Desktop-1280 (or Mobile-375 for mobile tests)
  // to avoid multi-worker file handle collisions on Windows.
  if (projectName && !resolvedPath.includes(projectName)) {
    const isMobileOnlyTest = resolvedPath.includes('mobile-');
    const shouldCapture = isMobileOnlyTest
      ? projectName === 'Mobile-375'
      : projectName === 'Desktop-1280';
    if (!shouldCapture) {
      return;
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.screenshot({ path: resolvedPath });
      return;
    } catch (err: any) {
      if (attempt < 4 && (err.message?.includes('UNKNOWN') || err.message?.includes('EBUSY') || (err as any).code === 'EBUSY')) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}
