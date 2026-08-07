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
 * A monetary value as it may arrive from the API.
 *
 * Backend money columns are SQL `Numeric`, which Pydantic serializes as a
 * JSON *string* ("133.65") to avoid float rounding. Response types across the
 * app nonetheless declare these fields `number`, so the string form reaches
 * formatters unannounced — see `Money` handling below.
 */
export type Money = number | string | null | undefined;

/** Coerce an API money value, treating anything non-numeric as absent. */
function toAmount(amount: Money): number | null {
  if (amount == null || amount === '') return null;
  const value = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(value) ? value : null;
}

/**
 * Format a number as USD currency (e.g., "$1,234.56").
 * Returns "-" for null/undefined values.
 */
export function formatCurrency(amount: Money): string {
  const value = toAmount(amount);
  if (value == null) return '-';
  return defaultFormatter.format(value);
}

/**
 * Format a number as USD currency without cents (e.g., "$1,235").
 * Returns "--" for null/undefined values.
 */
export function formatCurrencyWhole(amount: Money): string {
  const value = toAmount(amount);
  if (value == null) return '--';
  return wholeNumberFormatter.format(value);
}
