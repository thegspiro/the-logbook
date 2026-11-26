/**
 * Report date presets follow the department's calendar, not the browser's.
 * The browser's year, month and quarter used to decide them, so a laptop in
 * another zone (or a tab open across New Year) asked for the wrong period.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({ reportsApiService: {}, savedReportsService: {} }));

import { getPresetDates } from './reportsStore';

// 12:00 UTC on Dec 31 is already Jan 1 on Kiritimati (UTC+14).
const KIRITIMATI = 'Pacific/Kiritimati';

describe('getPresetDates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the year on the department's New Year", () => {
    expect(getPresetDates('this-year', KIRITIMATI)).toEqual({ start: '2027-01-01', end: '2027-12-31' });
    expect(getPresetDates('last-year', KIRITIMATI)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it("takes the quarters from the department's date, whole and end to end", () => {
    expect(getPresetDates('this-quarter', KIRITIMATI)).toEqual({ start: '2027-01-01', end: '2027-03-31' });
    expect(getPresetDates('last-quarter', KIRITIMATI)).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });

  it("counts the rolling ranges back from the department's today", () => {
    expect(getPresetDates('last-30', KIRITIMATI)).toEqual({ start: '2026-12-02', end: '2027-01-01' });
  });

  it('keeps a department behind UTC on its own date', () => {
    expect(getPresetDates('this-quarter', 'America/New_York')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });
});
