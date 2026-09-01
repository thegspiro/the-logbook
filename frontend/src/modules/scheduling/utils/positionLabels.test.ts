/**
 * The board and the template form have to agree about what one seat is
 * called. They did not: a template built with two EMT seats listed them as
 * "EMS" on the schedule, because the board printed the stored token where the
 * label belonged.
 */

import { describe, it, expect } from 'vitest';
import { positionLabel } from './positionLabels';

describe('positionLabel', () => {
  it('names the ems seat the way the template form does', () => {
    expect(positionLabel('ems')).toBe('EMT');
  });

  it('folds the spellings that mean the same seat', () => {
    // Rows written before the backend settled on one token.
    expect(positionLabel('EMS')).toBe('EMT');
    expect(positionLabel('EMT')).toBe('EMT');
    expect(positionLabel(' emt ')).toBe('EMT');
  });

  it('resolves the rest of the built-in vocabulary', () => {
    expect(positionLabel('driver')).toBe('Driver/Operator');
    expect(positionLabel('officer')).toBe('Officer');
    expect(positionLabel('firefighter')).toBe('Firefighter');
  });

  it("keeps a department's own seat readable rather than blank", () => {
    // Custom seats carry their label in the department's settings, not here;
    // a nameless seat on a roster is worse than a slug.
    expect(positionLabel('medic_student')).toBe('medic student');
  });

  it('names nothing when there is no seat', () => {
    expect(positionLabel(null)).toBe('');
    expect(positionLabel(undefined)).toBe('');
    expect(positionLabel('  ')).toBe('');
  });
});
