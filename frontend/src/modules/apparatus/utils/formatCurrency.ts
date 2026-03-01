/**
 * Format Currency Utility
 *
 * Formats a numeric amount as a US dollar currency string.
 */

/**
 * Format a number as USD currency.
 * @param amount - The amount to format, or null for missing values.
 * @returns Formatted currency string (e.g., "$1,234.56") or "-" if null.
 */
export const formatCurrency = (amount: number | null): string => {
  if (amount === null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};
