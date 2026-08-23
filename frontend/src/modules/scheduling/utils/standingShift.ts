/**
 * Copy for the standing-shift preview.
 *
 * Lives apart from the modal so the wording is testable on its own — it is
 * the sentence a member reads before committing to a series, and getting the
 * plural or the "not scheduled yet" case wrong changes what they think they
 * agreed to.
 */

/**
 * What the member is actually signing up for, in one line.
 *
 * Dates with no shift on record are called out separately from conflicts:
 * they are not a problem, they are simply months the department has not
 * scheduled yet, and the series will claim them when it does.
 */
export const describeCoverage = (claimable: number, conflicts: number, missing: number): string => {
  const parts: string[] = [];
  if (conflicts > 0) {
    parts.push(
      `${conflicts} of these dates conflict${conflicts === 1 ? 's' : ''} with a shift you already hold. ` +
        `${conflicts === 1 ? 'It' : 'They'} will be skipped.`
    );
  }
  if (missing > 0) {
    parts.push(
      `${missing} ${missing === 1 ? 'date is' : 'dates are'} not on the schedule yet — ` +
        `${missing === 1 ? 'it' : 'they'} will be claimed once scheduled.`
    );
  }
  if (parts.length === 0) {
    return `No conflicts with shifts you already hold. ${claimable} date${claimable === 1 ? '' : 's'} will be claimed now.`;
  }
  return parts.join(' ');
};
