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
import { positionLabel, rankEligibleSeatOptions } from './positionLabels';

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

describe('rankEligibleSeatOptions', () => {
  beforeEach(() => {
    getCachedShiftSettings.mockReset();
    getCachedShiftSettings.mockReturnValue(DEFAULT_SETTINGS);
  });

  it('does not offer a custom seat nobody can be assigned to', () => {
    // A custom seat belongs to the vocabulary everywhere else — a template can
    // carry it, `canonical_position` round-trips it, the board renders its
    // label — but `ShiftSignupRequest`, `ShiftAssignmentCreate` and
    // `StandingShiftCreate` all type `position` as the closed `ShiftPosition`
    // enum, with a MySQL ENUM column behind them. Granting a rank eligibility
    // for one is a promise the app refuses at request validation.
    getCachedShiftSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      customPositions: [{ value: 'rescue_tech', label: 'Rescue Technician' }],
    });

    const options = rankEligibleSeatOptions();

    expect(options.map((o) => o.value)).not.toContain('rescue_tech');
    expect(options.map((o) => o.value)).toContain('firefighter');
  });

  it('withholds the medic seat, which a certification confers and a rank must not', () => {
    // get_eligible_positions grants `paramedic` from step 3b, the member's
    // certifications as of the shift date. A rank that could hand it out would
    // outlive the card.
    expect(rankEligibleSeatOptions().map((o) => o.value)).not.toContain('paramedic');
  });

  it('names each built-in seat the way every other screen does', () => {
    const ems = rankEligibleSeatOptions().find((o) => o.value === 'ems');
    expect(ems?.label).toBe('EMT');
  });

  it('offers each built-in seat exactly once', () => {
    getCachedShiftSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      customPositions: [{ value: 'officer', label: 'Company Officer' }],
    });

    expect(rankEligibleSeatOptions().filter((o) => o.value === 'officer')).toHaveLength(1);
  });
});
