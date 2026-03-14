/**
 * Currency Formatting Utilities
 *
 * Centralizes the USD currency formatting logic that was previously
 * duplicated across 20+ files in finance, grants, inventory, and
 * apparatus modules.
 */

const defaultFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a number as USD currency (e.g., "$1,234.56").
 * Returns "-" for null/undefined values.
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '-';
  return defaultFormatter.format(amount);
}

/**
 * Format a number as USD currency without cents (e.g., "$1,235").
 * Returns "--" for null/undefined values.
 */
export function formatCurrencyWhole(amount: number | null | undefined): string {
  if (amount == null) return '--';
  return wholeNumberFormatter.format(amount);
}
