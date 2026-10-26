import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ALLOWED_CURRENCIES } from '../../packages/shared/src/money';
import { transliterateToSlug } from '../../packages/backend/src/services/slug';

// Extract the exact validation schema tested on the backend
const ticketTierInputSchema = z.object({
  name: z.string().min(1, 'Tier name is required').max(100),
  pricePaise: z.number().int().min(0, 'Price must be non-negative'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1'),
  perUserLimit: z.number().int().min(1).max(50).default(5),
});

const baseCreateEventSchema = z.object({
  organizerId: z.string().uuid().optional(),
  title: z.string().min(3).max(255),
  description: z.string().min(10),
  category: z.string().min(2).max(100),
  tags: z.array(z.string()).default([]),
  department: z.string().max(100).optional(),
  format: z.enum(['in_person', 'online', 'hybrid']),
  venueId: z.string().uuid().optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  registrationOpensAt: z.string().datetime().optional().nullable(),
  registrationClosesAt: z.string().datetime().optional().nullable(),
  capacity: z.number().int().min(1, 'Capacity must be at least 1'),
  pricingType: z.enum(['free', 'paid']).default('free'),
  currency: z.string().default('INR'),
  ticketTiers: z.array(ticketTierInputSchema).optional(),
  eligibility: z.record(z.any()).default({}),
  visibility: z.enum(['college', 'public']).default('college'),
  teamMode: z.enum(['none', 'optional', 'required']).default('none'),
  teamMin: z.number().int().min(1).optional().nullable(),
  teamMax: z.number().int().min(1).optional().nullable(),
  contactEmail: z.string().email(),
});

const createEventSchema = baseCreateEventSchema.superRefine((data, ctx) => {
  // 1. Currency allow-list
  if (!ALLOWED_CURRENCIES.includes(data.currency as any)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currency'],
      message: `Currency '${data.currency}' is not supported. Allowed currencies: ${ALLOWED_CURRENCIES.join(', ')}.`,
    });
  }

  // 2. Paid events validation: paid => >= 1 tier, price>0, sum(tier.capacity) <= event.capacity
  if (data.pricingType === 'paid') {
    const tiers = data.ticketTiers || [];
    if (tiers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ticketTiers'],
        message: 'Paid events must have at least one ticket tier.',
      });
    }

    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i].pricePaise <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ticketTiers', i, 'pricePaise'],
          message: 'Paid ticket tiers must have price greater than 0 paise.',
        });
      }
    }

    const totalTierCapacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
    if (totalTierCapacity > data.capacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ticketTiers'],
        message: `Sum of tier capacities (${totalTierCapacity}) cannot exceed overall event capacity (${data.capacity}).`,
      });
    }
  }

  // 3. Free events validation: free => price_paise = 0
  if (data.pricingType === 'free') {
    const tiers = data.ticketTiers || [];
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i].pricePaise !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ticketTiers', i, 'pricePaise'],
          message: 'Free event ticket tiers must have price_paise = 0.',
        });
      }
    }

    const totalTierCapacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
    if (totalTierCapacity > data.capacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ticketTiers'],
        message: `Sum of tier capacities (${totalTierCapacity}) cannot exceed overall event capacity (${data.capacity}).`,
      });
    }
  }
});

describe('Phase P10: Event Creation (Free/Paid & Schema Constraints)', () => {
  const baseValidEvent = {
    title: 'Smart Campus AI & Robotics Symposium 2026',
    description: 'A deep-dive campus conference focusing on edge AI, autonomy and robotics.',
    category: 'AI & Robotics',
    format: 'in_person' as const,
    startsAt: '2026-11-15T09:00:00.000Z',
    endsAt: '2026-11-15T18:00:00.000Z',
    capacity: 200,
    contactEmail: 'organizer@campus.edu',
  };

  describe('Free Event Validation Rules', () => {
    it('validates a free event with no custom tiers (backend will create default 0 paise tier)', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'free',
        currency: 'INR',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pricingType).toBe('free');
        expect(result.data.currency).toBe('INR');
      }
    });

    it('validates a free event with explicit 0 paise tiers', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'free',
        currency: 'INR',
        ticketTiers: [
          { name: 'Standard Pass', pricePaise: 0, capacity: 150, perUserLimit: 2 },
          { name: 'VIP Pass', pricePaise: 0, capacity: 50, perUserLimit: 1 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a free event with ticket price > 0 paise', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'free',
        currency: 'INR',
        ticketTiers: [
          { name: 'General Admission', pricePaise: 15000, capacity: 100, perUserLimit: 2 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.flatten();
        expect(issues.fieldErrors['ticketTiers']).toBeDefined();
        expect(issues.fieldErrors['ticketTiers']?.[0]).toContain('price_paise = 0');
      }
    });

    it('rejects a free event if sum of tier capacities exceeds total event capacity', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        capacity: 100,
        pricingType: 'free',
        ticketTiers: [
          { name: 'Track A', pricePaise: 0, capacity: 60, perUserLimit: 2 },
          { name: 'Track B', pricePaise: 0, capacity: 60, perUserLimit: 2 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors['ticketTiers']?.[0]).toContain(
          'cannot exceed overall event capacity'
        );
      }
    });
  });

  describe('Paid Event Validation Rules', () => {
    it('validates a paid event with valid ticket tier and currency INR', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'paid',
        currency: 'INR',
        ticketTiers: [
          { name: 'General Admission', pricePaise: 25000, capacity: 200, perUserLimit: 5 },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pricingType).toBe('paid');
        expect(result.data.ticketTiers?.[0].pricePaise).toBe(25000);
      }
    });

    it('validates a paid event with multiple tiered tickets within capacity limit', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        capacity: 300,
        pricingType: 'paid',
        currency: 'INR',
        ticketTiers: [
          { name: 'Early Bird', pricePaise: 15000, capacity: 100, perUserLimit: 2 },
          { name: 'Standard Pass', pricePaise: 25000, capacity: 150, perUserLimit: 4 },
          { name: 'VIP Pass', pricePaise: 50000, capacity: 50, perUserLimit: 2 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a paid event with no ticket tiers provided', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'paid',
        currency: 'INR',
        ticketTiers: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors['ticketTiers']?.[0]).toContain(
          'Paid events must have at least one ticket tier'
        );
      }
    });

    it('rejects a paid event where tier price is 0 or negative', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'paid',
        currency: 'INR',
        ticketTiers: [
          { name: 'Discounted Pass', pricePaise: 0, capacity: 100, perUserLimit: 2 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors['ticketTiers']?.[0]).toContain(
          'must have price greater than 0 paise'
        );
      }
    });

    it('rejects an unsupported currency for paid events', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        pricingType: 'paid',
        currency: 'USD',
        ticketTiers: [
          { name: 'Admission', pricePaise: 2000, capacity: 100, perUserLimit: 2 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors['currency']?.[0]).toContain(
          "Currency 'USD' is not supported"
        );
      }
    });

    it('rejects paid event when sum of tier capacities exceeds total event capacity', () => {
      const result = createEventSchema.safeParse({
        ...baseValidEvent,
        capacity: 100,
        pricingType: 'paid',
        currency: 'INR',
        ticketTiers: [
          { name: 'Tier 1', pricePaise: 10000, capacity: 80, perUserLimit: 2 },
          { name: 'Tier 2', pricePaise: 20000, capacity: 40, perUserLimit: 2 },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors['ticketTiers']?.[0]).toContain(
          'cannot exceed overall event capacity'
        );
      }
    });
  });

  describe('Slug Transliteration and Sanitization', () => {
    it('transliterates titles into clean URL-safe slugs', () => {
      expect(transliterateToSlug('AI & Robotics Symposium 2026!')).toBe(
        'ai-and-robotics-symposium-2026'
      );
      expect(transliterateToSlug('  Hackathon: Build for Campus (v2.0)  ')).toBe(
        'hackathon-build-for-campus-v20'
      );
      expect(transliterateToSlug('National Sports Meet — Day 1')).toBe(
        'national-sports-meet-day-1'
      );
      expect(transliterateToSlug('Special & Characters @ 100%')).toBe(
        'special-and-characters-at-100-percent'
      );
    });

    it('handles titles with non-ASCII or accented characters gracefully', () => {
      expect(transliterateToSlug('Café & Résumé Workshop')).toBe(
        'cafe-and-resume-workshop'
      );
    });

    it('handles completely non-alphanumeric titles with a fallback slug', () => {
      expect(transliterateToSlug('??? !!! ***')).toBe('event');
    });
  });
});
