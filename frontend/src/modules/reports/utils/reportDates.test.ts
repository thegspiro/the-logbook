import { describe, expect, it } from 'vitest';

import { renderCalendarDate, renderInstantDate } from './reportDates';

describe('renderCalendarDate', () => {
  it('reads a calendar date the way the rest of the app does', () => {
    expect(renderCalendarDate('2026-09-30')).toBe('Sep 30, 2026');
  });

  it('keeps the written day for a viewer west of UTC', () => {
    // A calendar date is not an instant: it must not slide to Sep 29.
    expect(renderCalendarDate('2026-09-30')).not.toMatch(/29/);
  });

  it('shows a dash for a missing value', () => {
    expect(renderCalendarDate(null)).toBe('-');
    expect(renderCalendarDate('')).toBe('-');
  });
});

describe('renderInstantDate', () => {
  it('puts an instant on the department calendar', () => {
    // 02:00 UTC on Oct 1 is still Sep 30 in Chicago.
    expect(renderInstantDate('America/Chicago')('2026-10-01T02:00:00Z')).toBe('9/30/2026');
  });

  it('shows a dash for a missing value', () => {
    expect(renderInstantDate('America/Chicago')(undefined)).toBe('-');
  });
});
