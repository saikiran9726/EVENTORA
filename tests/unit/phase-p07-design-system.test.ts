import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase P07: Design System, Tokens, UI Components & Overlays', () => {
  const uiComponentsDir = path.resolve(process.cwd(), 'packages/frontend/src/components/ui');
  const shellsDir = path.resolve(process.cwd(), 'packages/frontend/src/components/shells');
  const indexCssPath = path.resolve(process.cwd(), 'packages/frontend/src/index.css');
  const tailwindConfigPath = path.resolve(process.cwd(), 'packages/frontend/tailwind.config.ts');

  it('1. Design tokens enforce Inter font, motion <= 200ms, and prefers-reduced-motion', () => {
    const cssContent = fs.readFileSync(indexCssPath, 'utf8');
    const tailwindContent = fs.readFileSync(tailwindConfigPath, 'utf8');

    // Font Inter
    expect(cssContent).toContain("'Inter'");
    expect(tailwindContent).toContain("'Inter'");

    // Motion durations <= 200ms
    expect(tailwindContent).toContain("fast: '100ms'");
    expect(tailwindContent).toContain("normal: '180ms'");
    expect(tailwindContent).toContain("slow: '200ms'");
    expect(tailwindContent).not.toMatch(/:\s*'(3\d\d|4\d\d|5\d\d)ms'/);

    // Reduced motion media query
    expect(cssContent).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssContent).toContain('animation-duration: 0.01ms');
    expect(cssContent).toContain('transition-duration: 0.01ms');

    // Safe-area insets
    expect(cssContent).toContain('env(safe-area-inset-bottom');
    expect(cssContent).toContain('env(safe-area-inset-top');
    expect(cssContent).toContain('.pb-safe');
    expect(cssContent).toContain('.pt-safe');
  });

  it('2. Modal, Dialog & BottomSheet store onClose in a ref and depend ONLY on isOpen (no focus stealing)', () => {
    const overlayFiles = ['Modal.tsx', 'Dialog.tsx', 'BottomSheet.tsx'];

    for (const fileName of overlayFiles) {
      const filePath = path.join(uiComponentsDir, fileName);
      const content = fs.readFileSync(filePath, 'utf8');

      // onClose stored in ref
      expect(
        content,
        `${fileName} must store onClose in a ref to prevent focus stealing`
      ).toContain('const onCloseRef = useRef(onClose)');
      expect(content).toContain('onCloseRef.current = onClose');

      // useEffect dependency array contains isOpen, not onClose
      expect(
        content,
        `${fileName} focus effect must depend only on isOpen to avoid re-triggering on parent render`
      ).toMatch(/\}, \[isOpen(?:, isDismissible)?\]\);/);

      // Body scroll-lock with restore
      expect(
        content,
        `${fileName} must lock body scroll and restore on unmount`
      ).toContain("document.body.style.overflow = 'hidden'");
      expect(content).toContain('document.body.style.overflow = previousOverflow');

      // useId for accessible aria attributes
      expect(content).toContain('useId()');
      expect(content).toContain('aria-labelledby={titleId}');

      // Non-dismissible variant support
      expect(content).toContain('isDismissible');

      // Transitions <= 200ms
      const durationMatches = content.match(/duration:\s*shouldReduceMotion\s*\?\s*0\.01\s*:\s*([0-9.]+)/g);
      expect(durationMatches).not.toBeNull();
      durationMatches?.forEach((m) => {
        const dur = parseFloat(m.split(':').pop()?.trim() || '0');
        expect(dur, `${fileName} transition duration must be <= 0.2s`).toBeLessThanOrEqual(0.2);
      });
    }
  });

  it('3. Form inputs (Input, Select, Textarea, Checkbox, Switch) enforce aria-describedby and validation states', () => {
    const inputFiles = [
      { name: 'Input.tsx', requiresChevron: false },
      { name: 'Select.tsx', requiresChevron: true },
      { name: 'Textarea.tsx', requiresChevron: false },
      { name: 'Checkbox.tsx', requiresChevron: false },
      { name: 'Switch.tsx', requiresChevron: false },
    ];

    for (const { name, requiresChevron } of inputFiles) {
      const filePath = path.join(uiComponentsDir, name);
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content, `${name} must generate accessible ids via useId()`).toContain('useId()');
      expect(content, `${name} must link validation via aria-describedby`).toContain('aria-describedby');
      expect(content, `${name} must flag error state via aria-invalid`).toContain('aria-invalid');

      if (requiresChevron) {
        // Custom chevron icon to eliminate unstyled native dropdown arrows
        expect(content, `${name} must include custom styled chevron icon`).toContain('ChevronDown');
      }
    }
  });

  it('4. Tabs component provides accessible roles, keyboard arrow navigation, and TabPanel', () => {
    const tabsPath = path.join(uiComponentsDir, 'Tabs.tsx');
    const content = fs.readFileSync(tabsPath, 'utf8');

    expect(content).toContain('role="tablist"');
    expect(content).toContain('role="tab"');
    expect(content).toContain('role="tabpanel"');
    expect(content).toContain('aria-selected={isActive}');
    expect(content).toContain('tabIndex={isActive ? 0 : -1}');
    expect(content).toContain("handleKeyDown");
    expect(content).toContain("'ArrowRight'");
    expect(content).toContain("'ArrowLeft'");
    expect(content).toContain("'Home'");
    expect(content).toContain("'End'");
    expect(content).toContain('export const TabPanel');
  });

  it('5. Pagination component renders numbered page buttons, ellipsis, and aria-current="page"', () => {
    const paginationPath = path.join(uiComponentsDir, 'Pagination.tsx');
    const content = fs.readFileSync(paginationPath, 'utf8');

    expect(content).toContain('aria-current={isCurrent ? \'page\' : undefined}');
    expect(content).toContain('role="navigation"');
    expect(content).toContain('pageNumbers.map');
    expect(content).toContain('MoreHorizontal');
    expect(content).toContain('disabled={currentPage <= 1}');
    expect(content).toContain('disabled={currentPage >= totalPages}');
  });

  it('6. FeedbackStates provides EmptyState and ErrorState with optional requestId display and copy', () => {
    const feedbackPath = path.join(uiComponentsDir, 'FeedbackStates.tsx');
    const content = fs.readFileSync(feedbackPath, 'utf8');

    expect(content).toContain('export const EmptyState');
    expect(content).toContain('export const ErrorState');
    expect(content).toContain('requestId?: string');
    expect(content).toContain('handleCopyRequestId');
    expect(content).toContain('Request: {requestId.slice');
  });

  it('7. Navigation shells (Student, Organizer, Reviewer, Admin, Checkin) apply safe-area insets and mobile-first widths', () => {
    const shellFiles = [
      'StudentShell.tsx',
      'OrganizerShell.tsx',
      'ReviewerShell.tsx',
      'AdminShell.tsx',
      'CheckinShell.tsx',
    ];

    for (const shellName of shellFiles) {
      const filePath = path.join(shellsDir, shellName);
      const content = fs.readFileSync(filePath, 'utf8');

      // Top safe-area or pt-safe
      expect(
        content,
        `${shellName} must include pt-safe on header`
      ).toContain('pt-safe');

      // Main content padding accommodates bottom navigation safe area
      expect(
        content,
        `${shellName} main content must have pb accommodating mobile safe area`
      ).toMatch(/pb-\[?(?:calc|safe)/);

      // Bottom nav or footer safe-area
      if (shellName !== 'CheckinShell.tsx') {
        expect(
          content,
          `${shellName} must include pb-safe on mobile bottom nav`
        ).toContain('pb-safe');
      }

      // No fixed wide pixel widths on layout containers
      expect(content).not.toMatch(/className="[^"]*\bw-\[(?:[4-9]\d\d|1\d\d\d)px\]/);
      expect(content).toContain('overflow-x-hidden');
    }
  });

  it('8. Button component provides loading spinner, aria-busy, and active scale press feedback', () => {
    const buttonPath = path.join(uiComponentsDir, 'Button.tsx');
    const content = fs.readFileSync(buttonPath, 'utf8');

    expect(content).toContain('aria-busy={isLoading ? true : undefined}');
    expect(content).toContain('active:scale-[0.98]');
    expect(content).toContain('type = \'button\'');
    expect(content).toContain('animate-spin');
  });
});
