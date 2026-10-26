import { describe, it, expect } from 'vitest';
import { formatINR } from '../../packages/frontend/src/lib/utils';
import {
  rupeeToPaise,
  paiseToRupee,
  formatPaiseToRupee,
  ALLOWED_CURRENCIES,
  isAllowedCurrency,
} from '../../packages/shared/src/money';

describe('Integer Paise Money Invariants & Helpers', () => {
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

  describe('rupeeToPaise converter', () => {
    it('accurately converts numeric rupees to integer paise', () => {
      expect(rupeeToPaise(0)).toBe(0);
      expect(rupeeToPaise(1)).toBe(100);
      expect(rupeeToPaise(250)).toBe(25000);
      expect(rupeeToPaise(99.5)).toBe(9950);
      expect(rupeeToPaise(149.99)).toBe(14999);
      expect(rupeeToPaise(5000.25)).toBe(500025);
    });

    it('accurately converts string rupees to integer paise without floating point issues', () => {
      expect(rupeeToPaise('0')).toBe(0);
      expect(rupeeToPaise('0.00')).toBe(0);
      expect(rupeeToPaise('250')).toBe(25000);
      expect(rupeeToPaise('99.50')).toBe(9950);
      expect(rupeeToPaise('149.99')).toBe(14999);
      expect(rupeeToPaise('  500.5  ')).toBe(50050);
    });

    it('rejects negative numbers and negative string values', () => {
      expect(() => rupeeToPaise(-1)).toThrow(/non-negative/i);
      expect(() => rupeeToPaise(-0.01)).toThrow(/non-negative/i);
      expect(() => rupeeToPaise('-100')).toThrow(/Invalid rupee amount/i);
      expect(() => rupeeToPaise('-0.50')).toThrow(/Invalid rupee amount/i);
    });

    it('rejects fractional paise (more than 2 decimal places)', () => {
      expect(() => rupeeToPaise(10.555)).toThrow(/Fractional paise is not supported/i);
      expect(() => rupeeToPaise('10.555')).toThrow(/at most 2 decimal places/i);
      expect(() => rupeeToPaise(0.001)).toThrow(/Fractional paise is not supported/i);
      expect(() => rupeeToPaise('0.001')).toThrow(/at most 2 decimal places/i);
    });

    it('rejects invalid inputs such as NaN, Infinity, and malformed strings', () => {
      expect(() => rupeeToPaise(NaN)).toThrow();
      expect(() => rupeeToPaise(Infinity)).toThrow();
      expect(() => rupeeToPaise(-Infinity)).toThrow();
      expect(() => rupeeToPaise('abc')).toThrow();
      expect(() => rupeeToPaise('')).toThrow();
      expect(() => rupeeToPaise('₹250')).toThrow();
      expect(() => rupeeToPaise('12.34.56')).toThrow();
    });
  });

  describe('paiseToRupee converter', () => {
    it('converts non-negative integer paise to rupee numbers', () => {
      expect(paiseToRupee(0)).toBe(0);
      expect(paiseToRupee(100)).toBe(1);
      expect(paiseToRupee(25000)).toBe(250);
      expect(paiseToRupee(9950)).toBe(99.5);
      expect(paiseToRupee(14999)).toBe(149.99);
    });

    it('rejects negative or non-integer paise', () => {
      expect(() => paiseToRupee(-1)).toThrow();
      expect(() => paiseToRupee(100.5)).toThrow();
      expect(() => paiseToRupee(NaN as any)).toThrow();
    });
  });

  describe('formatPaiseToRupee localized formatter', () => {
    it('formats integer paise as localized INR currency string', () => {
      expect(formatPaiseToRupee(0)).toBe('₹0');
      expect(formatPaiseToRupee(25000)).toBe('₹250');
      expect(formatPaiseToRupee(9950)).toBe('₹99.50');
      expect(formatPaiseToRupee(25000, true)).toBe('₹250.00');
    });

    it('handles unexpected inputs gracefully by returning ₹0', () => {
      expect(formatPaiseToRupee(-100)).toBe('₹0');
      expect(formatPaiseToRupee(NaN as any)).toBe('₹0');
    });
  });

  describe('Currency Allow-List', () => {
    it('defines INR as the allowed campus currency', () => {
      expect(ALLOWED_CURRENCIES).toEqual(['INR']);
      expect(isAllowedCurrency('INR')).toBe(true);
      expect(isAllowedCurrency('USD')).toBe(false);
      expect(isAllowedCurrency('EUR')).toBe(false);
      expect(isAllowedCurrency('')).toBe(false);
    });
  });
});
