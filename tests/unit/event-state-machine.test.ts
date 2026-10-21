import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  VALID_TRANSITIONS,
  InvalidTransitionError,
  transitionEventStatus,
} from '../../packages/backend/src/services/event-lifecycle.js';
import type { EventStatus } from '../../packages/backend/src/db/schema.js';

describe('Event Lifecycle State Machine (Table-Driven)', () => {
  const allStatuses: EventStatus[] = [
    'draft',
    'pending_approval',
    'approved',
    'changes_requested',
    'rejected',
    'published',
    'postponed',
    'cancelled',
    'completed',
  ];

  it('verifies all structurally valid transition pairs according to blueprint specification', () => {
    // Valid transitions
    expect(isValidTransition('draft', 'pending_approval')).toBe(true);
    expect(isValidTransition('pending_approval', 'approved')).toBe(true);
    expect(isValidTransition('pending_approval', 'changes_requested')).toBe(true);
    expect(isValidTransition('pending_approval', 'rejected')).toBe(true);
    expect(isValidTransition('changes_requested', 'pending_approval')).toBe(true);
    expect(isValidTransition('approved', 'published')).toBe(true);
    expect(isValidTransition('approved', 'cancelled')).toBe(true);
    expect(isValidTransition('published', 'postponed')).toBe(true);
    expect(isValidTransition('published', 'cancelled')).toBe(true);
    expect(isValidTransition('published', 'completed')).toBe(true);
    expect(isValidTransition('postponed', 'published')).toBe(true);
    expect(isValidTransition('postponed', 'cancelled')).toBe(true);
    expect(isValidTransition('rejected', 'draft')).toBe(true);
  });

  it('rejects every illegal transition pair in the matrix', () => {
    let testedCount = 0;
    let rejectedCount = 0;

    for (const from of allStatuses) {
      for (const to of allStatuses) {
        testedCount++;
        const shouldBeValid = VALID_TRANSITIONS[from]?.includes(to) ?? false;
        const result = isValidTransition(from, to);

        if (shouldBeValid) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
          rejectedCount++;
        }
      }
    }

    // Out of 81 possible (9x9) combinations, exactly 13 are valid and 68 are illegal
    expect(testedCount).toBe(81);
    expect(rejectedCount).toBe(68);
  });

  it('critical illegal skips are blocked (e.g. bypass faculty review directly to published)', async () => {
    // Bypass review from draft directly to published
    expect(isValidTransition('draft', 'published')).toBe(false);

    // Bypass approval from pending_approval directly to published
    expect(isValidTransition('pending_approval', 'published')).toBe(false);

    // Reopen cancelled event directly to published
    expect(isValidTransition('cancelled', 'published')).toBe(false);

    // Publish rejected event directly
    expect(isValidTransition('rejected', 'published')).toBe(false);

    // Transitioning from invalid state throws InvalidTransitionError
    await expect(
      transitionEventStatus('00000000-0000-0000-0000-000000000000', 'draft', 'published', {
        actorId: 'test-user',
        actorRole: 'student',
      })
    ).rejects.toThrow(InvalidTransitionError);
  });
});
