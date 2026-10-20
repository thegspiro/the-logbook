/**
 * What to tell the Treasurer about an account QuickBooks' journal-entry
 * import would reject. The backend decides which accounts these are
 * (`accountsNotInChart` and the `not_in_chart` / `unsafe_account_name`
 * statuses on the readiness report); this only words it, so the category,
 * dues and cash-advance tables say it the same way.
 */

export const UNSAFE_ACCOUNT_NAME_HINT =
  'An account name starts with =, +, - or @. The export escapes those so spreadsheets do not run them as formulas, and QuickBooks would then not recognize the account. Rename it in QuickBooks and here.';

export function notInChartHint(accounts: readonly string[] | undefined): string {
  const names = (accounts ?? []).join(', ');
  return `Not in the uploaded chart of accounts${names ? `: ${names}` : ''}. Check the spelling against QuickBooks, or upload the chart again if the account was added there since.`;
}
