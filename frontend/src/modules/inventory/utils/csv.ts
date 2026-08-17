/** Escape a value for CSV while preventing spreadsheet formula execution. */
export const csvEscape = (value: string): string => {
  // Spreadsheet applications may execute formula-prefixed CSV cells even when
  // they are correctly quoted. Prefix those values with an apostrophe so they
  // are imported as text before applying normal CSV escaping.
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue;
};
