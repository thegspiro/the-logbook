/**
 * The board and the position-configuration screens have to agree about what
 * one seat is called. They did not: a template built with two EMT seats
 * listed them as "EMS" on the schedule, because the board printed the stored
 * token where the label belonged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/shiftSettings';

const getCachedShiftSettings = vi.fn(() => DEFAULT_SETTINGS);

vi.mock('../services/shiftSettingsApi', () => ({
  getCachedShiftSettings: () => getCachedShiftSettings(),
  ensureShiftSettingsLoaded: () => Promise.resolve(DEFAULT_SETTINGS),
}));

// Imported after the mock is in place (store test pattern).
import { positionLabel } from './positionLabels';

describe('positionLabel', () => {
  beforeEach(() => {
    getCachedShiftSettings.mockReset();
    getCachedShiftSettings.mockReturnValue(DEFAULT_SETTINGS);
  });

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

  it("gives a department's own seat the label the department chose", () => {
    getCachedShiftSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      customPositions: [{ value: 'rescue_tech', label: 'Rescue Technician' }],
    });
    expect(positionLabel('rescue_tech')).toBe('Rescue Technician');
  });

  it('keeps a seat readable while its settings have not landed', () => {
    // The cache falls back to the built-in defaults until the load returns;
    // a nameless seat on a roster is worse than a slug.
    expect(positionLabel('rescue_tech')).toBe('rescue tech');
  });

  it('names nothing when there is no seat', () => {
    expect(positionLabel(null)).toBe('');
    expect(positionLabel(undefined)).toBe('');
    expect(positionLabel('  ')).toBe('');
  });
});
