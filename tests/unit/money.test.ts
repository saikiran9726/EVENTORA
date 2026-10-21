import { describe, it, expect } from 'vitest';
import { formatINR } from '../../packages/frontend/src/lib/utils';

describe('Integer Paise Money Invariants', () => {
  it('should format integer paise to INR correctly without floating-point artifacts', () => {
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(15000)).toBe('₹150');
    expect(formatINR(25000)).toBe('₹250');
    expect(formatINR(7420000)).toBe('₹74,200');
  });

  it('should enforce non-negative integer representation in financial calculations', () => {
    const calculateTotalPaise = (items: Array<{ quantity: number; unitPricePaise: number }>) => {
      return items.reduce((acc, item) => {
        if (item.unitPricePaise < 0 || !Number.isInteger(item.unitPricePaise)) {
          throw new Error('Price must be a non-negative integer in paise');
        }
        if (item.quantity <= 0 || !Number.isInteger(item.quantity)) {
          throw new Error('Quantity must be a positive integer');
        }
        return acc + item.quantity * item.unitPricePaise;
      }, 0);
    };

    const total = calculateTotalPaise([
      { quantity: 2, unitPricePaise: 15000 },
      { quantity: 1, unitPricePaise: 25000 },
    ]);

    expect(total).toBe(55000); // ₹550 in paise
    expect(() => calculateTotalPaise([{ quantity: 1, unitPricePaise: -100 }])).toThrow();
    expect(() => calculateTotalPaise([{ quantity: 1, unitPricePaise: 150.5 }])).toThrow();
  });
});
