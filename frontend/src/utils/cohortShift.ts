import { MAX_COHORT_SHIFT_DAYS } from '@/constants/config';

/**
 * Why a typed shift is not allowed, or null when it is. The API refuses the
 * same values; this only saves the round trip and says why.
 */
export const shiftDaysError = (raw: string): string | null => {
  const days = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(days) || days === 0) {
    return 'Enter a whole number of days';
  }
  if (Math.abs(days) > MAX_COHORT_SHIFT_DAYS) {
    return `Classes can be moved by at most ${MAX_COHORT_SHIFT_DAYS} days either way`;
  }
  return null;
};
