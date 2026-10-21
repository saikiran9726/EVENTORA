import { describe, it, expect } from 'vitest';
import { DESIGN_TOKENS } from '@eventora/shared';

describe('Design Tokens Invariants', () => {
  it('should define exact brand color palette for light and dark modes', () => {
    expect(DESIGN_TOKENS.colors.light.brand).toBe('#4F46E5');
    expect(DESIGN_TOKENS.colors.light.brandHover).toBe('#4338CA');
    expect(DESIGN_TOKENS.colors.light.brandPressed).toBe('#3730A3');

    expect(DESIGN_TOKENS.colors.dark.brand).toBe('#818CF8');
    expect(DESIGN_TOKENS.colors.dark.brandHover).toBe('#A5B4FC');
    expect(DESIGN_TOKENS.colors.dark.brandPressed).toBe('#C7D2FE');
  });

  it('should define clean neutral background, surface, and surface-2', () => {
    expect(DESIGN_TOKENS.colors.light.bg).toBe('#FAFAFB');
    expect(DESIGN_TOKENS.colors.light.surface).toBe('#FFFFFF');
    expect(DESIGN_TOKENS.colors.light.surface2).toBe('#F4F4F8');

    expect(DESIGN_TOKENS.colors.dark.bg).toBe('#0B0B14');
    expect(DESIGN_TOKENS.colors.dark.surface).toBe('#12121F');
    expect(DESIGN_TOKENS.colors.dark.surface2).toBe('#1A1A2B');
  });

  it('should define border and text contrasts', () => {
    expect(DESIGN_TOKENS.colors.light.border).toBe('#E4E4EC');
    expect(DESIGN_TOKENS.colors.dark.border).toBe('#2A2A40');

    expect(DESIGN_TOKENS.colors.light.text).toBe('#111118');
    expect(DESIGN_TOKENS.colors.light.muted).toBe('#5B5B70');

    expect(DESIGN_TOKENS.colors.dark.text).toBe('#F2F2F8');
    expect(DESIGN_TOKENS.colors.dark.muted).toBe('#A1A1B8');
  });

  it('should define semantic success, warning, error, and info colors', () => {
    expect(DESIGN_TOKENS.colors.light.success).toBe('#15803D');
    expect(DESIGN_TOKENS.colors.light.warning).toBe('#B45309');
    expect(DESIGN_TOKENS.colors.light.error).toBe('#B91C1C');
    expect(DESIGN_TOKENS.colors.light.info).toBe('#1D4ED8');

    expect(DESIGN_TOKENS.colors.dark.success).toBe('#4ADE80');
    expect(DESIGN_TOKENS.colors.dark.warning).toBe('#FBBF24');
    expect(DESIGN_TOKENS.colors.dark.error).toBe('#F87171');
    expect(DESIGN_TOKENS.colors.dark.info).toBe('#60A5FA');
  });

  it('should define radii 6/10/16 and cubic-bezier motion curves', () => {
    expect(DESIGN_TOKENS.radii.sm).toBe('6px');
    expect(DESIGN_TOKENS.radii.md).toBe('10px');
    expect(DESIGN_TOKENS.radii.lg).toBe('16px');

    expect(DESIGN_TOKENS.motion.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(DESIGN_TOKENS.motion.fast).toBe('120ms');
    expect(DESIGN_TOKENS.motion.normal).toBe('200ms');
    expect(DESIGN_TOKENS.motion.slow).toBe('320ms');
  });

  it('should define breakpoints 375 / 640 / 768 / 1024 / 1280 and 1200px content max', () => {
    expect(DESIGN_TOKENS.breakpoints.mobile).toBe('375px');
    expect(DESIGN_TOKENS.breakpoints.sm).toBe('640px');
    expect(DESIGN_TOKENS.breakpoints.md).toBe('768px');
    expect(DESIGN_TOKENS.breakpoints.lg).toBe('1024px');
    expect(DESIGN_TOKENS.breakpoints.xl).toBe('1280px');
    expect(DESIGN_TOKENS.layout.contentMax).toBe('1200px');
    expect(DESIGN_TOKENS.layout.sidebarWidth).toBe('240px');
  });
});
