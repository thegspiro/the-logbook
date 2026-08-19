/**
 * Pure arithmetic for the shift close-out wizard.
 *
 * Kept out of the component so it can be tested on its own, and because these
 * are the calculations that were repeatedly got wrong while prototyping the
 * flow — each mistake produced a plausible number rather than an error.
 */

/** Slug for the "no type given" row. Never sent as a call type. */
export const UNCATEGORISED = '__uncategorised__';

/** Parse a count field. Blank, negative and rubbish all read as zero. */
export const num = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
};

/** Hours between two datetime-local strings, or 0 when either is unusable. */
export const hoursBetween = (inLocal: string, outLocal: string): number => {
  if (!inLocal || !outLocal) return 0;
  const a = new Date(inLocal).getTime();
  const b = new Date(outLocal).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return Math.round(((b - a) / 3_600_000) * 10) / 10;
};

/**
 * The apparatus's call count, or null when nothing has been entered at all.
 *
 * The rows are the only source — the total is derived from them, never stored
 * alongside them. Holding both meant reconciling two inputs that each claimed
 * to own the number, and the rule for revising one *down* was missing, so a
 * corrected count left the old total on screen and saved it.
 *
 * null and 0 are different facts and are stored differently: null is a gap in
 * the record, 0 is a department reporting a quiet tour.
 */
export const deriveCallTotal = (counts: Record<string, string>): number | null => {
  const entered = Object.values(counts).some((v) => v.trim() !== '');
  if (!entered) return null;
  return Object.values(counts).reduce((sum, v) => sum + num(v), 0);
};
