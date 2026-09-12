/**
 * How a skills-test figure is printed, everywhere it is printed.
 *
 * These live apart from the components that use them because there are five of
 * them — the verdict banner, the score breakdown, the candidate's result page,
 * the officer's records table and the printed scorecard — and a figure that
 * reads differently on two of those is the defect this module exists to
 * prevent.
 */

/** Trims float noise without hiding real fractions: 12 -> "12", 12.5 -> "12.5" */
export function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/** A percentage as every surface must print it.
 *
 *  The backend rounds a score to one decimal and judges the passing threshold
 *  against that figure, so a surface applying its own rounding can contradict
 *  the verdict beside it: `Math.round(89.5)` displayed "90%" directly above
 *  "Passing mark is 90% — not met". Every headline, list row and printed
 *  scorecard goes through this so there is one number.
 */
export function formatScore(value: number): string {
  return `${formatPoints(value)}%`;
}
