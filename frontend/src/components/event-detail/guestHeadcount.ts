import { formatNumber } from '../../utils/dateFormatting';

/** Matches MAX_GUEST_HEADCOUNT on the backend, so a typo is caught before the round trip. */
export const MAX_GUEST_HEADCOUNT = 100_000;

/** The typed value as a count, or the reason it is not one. An empty box is not a count. */
export const parseHeadcount = (raw: string): { value: number } | { error: string } => {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { error: 'Enter the number of guests as a whole number.' };
  const value = Number(text);
  if (value > MAX_GUEST_HEADCOUNT) return { error: `That is more than ${formatNumber(MAX_GUEST_HEADCOUNT)} guests.` };
  return { value };
};
