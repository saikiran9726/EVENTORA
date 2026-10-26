/**
 * Eventora Money & Currency Utilities
 *
 * Safety Invariant:
 * All monetary amounts are stored and calculated server-side in integer paise (1 INR = 100 paise).
 * Floating point arithmetic is strictly forbidden in financial calculations.
 */

export const ALLOWED_CURRENCIES = ['INR'] as const;
export type AllowedCurrency = typeof ALLOWED_CURRENCIES[number];

/**
 * Validates whether a given currency code is in the allowed campus currency list.
 */
export function isAllowedCurrency(currency: string): currency is AllowedCurrency {
  return (ALLOWED_CURRENCIES as readonly string[]).includes(currency);
}

/**
 * Converts a rupee amount (number or string representation) to integer paise.
 * Throws a descriptive Error if the input is negative, NaN, non-finite,
 * or contains more than 2 decimal places.
 *
 * Examples:
 *   rupeeToPaise(250) -> 25000
 *   rupeeToPaise(99.50) -> 9950
 *   rupeeToPaise("149.99") -> 14999
 *   rupeeToPaise(0) -> 0
 */
export function rupeeToPaise(rupees: number | string): number {
  if (typeof rupees === 'string') {
    const trimmed = rupees.trim();
    if (!trimmed || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      throw new Error(`Invalid rupee amount: "${rupees}". Must be a non-negative number with at most 2 decimal places.`);
    }
    const [intPart, decPart = ''] = trimmed.split('.');
    const paddedDec = (decPart + '00').slice(0, 2);
    const paise = parseInt(intPart, 10) * 100 + parseInt(paddedDec, 10);
    return paise;
  }

  if (typeof rupees !== 'number' || isNaN(rupees) || !isFinite(rupees) || rupees < 0) {
    throw new Error(`Invalid rupee amount: ${rupees}. Must be a non-negative finite number.`);
  }

  // Check that the number does not exceed 2 decimal places
  const scaled = Math.round(rupees * 100);
  if (Math.abs(rupees * 100 - scaled) > 1e-6) {
    throw new Error(`Invalid rupee amount: ${rupees}. Fractional paise is not supported (at most 2 decimal places).`);
  }

  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`Amount is too large to represent safely in integer paise.`);
  }

  return scaled;
}

/**
 * Converts integer paise to rupees as a standard number.
 * Throws if the input is not a non-negative integer.
 *
 * Examples:
 *   paiseToRupee(25000) -> 250
 *   paiseToRupee(9950) -> 99.5
 *   paiseToRupee(0) -> 0
 */
export function paiseToRupee(paise: number): number {
  if (typeof paise !== 'number' || !Number.isInteger(paise) || paise < 0) {
    throw new Error(`Invalid paise amount: ${paise}. Must be a non-negative integer.`);
  }
  return paise / 100;
}

/**
 * Formats integer paise into a standard localized Indian Rupee currency string.
 *
 * Examples:
 *   formatPaiseToRupee(25000) -> "₹250"
 *   formatPaiseToRupee(9950) -> "₹99.50"
 *   formatPaiseToRupee(25000, true) -> "₹250.00"
 */
export function formatPaiseToRupee(paise: number, forceDecimals = false): string {
  if (typeof paise !== 'number' || !Number.isInteger(paise) || paise < 0) {
    return '₹0';
  }
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: forceDecimals ? 2 : (paise % 100 === 0 ? 0 : 2),
    maximumFractionDigits: 2,
  }).format(rupees);
}
