import { describe, it, expect } from 'vitest';
import { PROTOTYPE_EVENTS, PROTOTYPE_ORGANIZER_STATS } from '../../packages/frontend/src/prototype/data';

describe('Prototype Data & Component Integrity', () => {
  it('should verify prototype data stores integer paise non-negative amounts', () => {
    PROTOTYPE_EVENTS.forEach((evt) => {
      expect(Number.isInteger(evt.pricePaise)).toBe(true);
      expect(evt.pricePaise).toBeGreaterThanOrEqual(0);
      if (evt.isPaid) {
        expect(evt.pricePaise).toBeGreaterThan(0);
      } else {
        expect(evt.pricePaise).toBe(0);
      }
    });

    expect(Number.isInteger(PROTOTYPE_ORGANIZER_STATS.simulatedGrossSalesPaise)).toBe(true);
    expect(PROTOTYPE_ORGANIZER_STATS.simulatedGrossSalesPaise).toBeGreaterThan(0);
  });

  it('should enforce fixed 16:9 or 4:3 aspect ratios for event visual containers', () => {
    PROTOTYPE_EVENTS.forEach((evt) => {
      expect(['16/9', '4/3']).toContain(evt.aspectRatio);
    });
  });

  it('should maintain distinct canonical event statuses', () => {
    PROTOTYPE_EVENTS.forEach((evt) => {
      expect(['PUBLISHED', 'DRAFT', 'PENDING_APPROVAL']).toContain(evt.status);
    });
  });
});
