import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import PhoneMonth from './PhoneMonth';
import type { ShiftRecord } from '../../../modules/scheduling';

/**
 * What a past day looks like is a contrast decision as much as a visual one,
 * and this grid has been through three versions of it. Fading the cell put the
 * date's legibility and the strength of the cue on one number; the cue now
 * lives on weight and on the bars, so the date is never measured against it.
 *
 * These pin the part a screenshot would not catch: that the date keeps its full
 * colour token whatever state the cell is in, and that the cue is still applied
 * to the right cells.
 */
vi.mock('../../../modules/scheduling/hooks/useSignupWindow', () => ({
  useSignupWindow: () => ({ closesMinutesBefore: 0, lateGraceMinutes: 0 }),
}));

const TODAY = new Date('2026-09-15T12:00:00');

/** The calendar week containing TODAY, Sunday through Saturday. */
const WEEK = [13, 14, 15, 16, 17, 18, 19].map((d) => new Date(`2026-09-${d}T12:00:00`));

const renderGrid = (shiftsByDate = new Map<string, ShiftRecord[]>()) =>
  render(
    <PhoneMonth
      days={WEEK}
      visibleMonth={8}
      shiftsByDate={shiftsByDate}
      selectedDate={TODAY}
      currentUserId="user-1"
      filter="all"
      today={TODAY}
      onSelect={vi.fn()}
    />
  );

/** Cells are named by their screen-reader label, which spells the date out. */
const cellFor = (day: number) => screen.getByRole('gridcell', { name: new RegExp(`September ${day}\\b`) });

/**
 * The visible numeral, not the screen-reader label beside it. An exact match
 * picks out the one element whose whole text is the number — the sr-only span
 * in the same cell reads "Sunday, September 13, no shifts".
 */
const dateTextOf = (day: number) => within(cellFor(day)).getByText(String(day));

describe('PhoneMonth past days', () => {
  it('never dims the cell, because opacity would take the date down with it', () => {
    renderGrid();

    // The 13th and 14th are past, the 15th is today, the rest are ahead.
    for (const day of [13, 14, 15, 16, 19]) {
      expect(cellFor(day).className).not.toMatch(/\bopacity-/);
    }
  });

  it('keeps the date on the full colour token whether the day has passed or not', () => {
    renderGrid();

    // Same token on both sides of today. In dark and high-contrast themes this
    // is the only tier that is guaranteed to clear 7:1, which is why the cue
    // is not allowed to touch it.
    expect(dateTextOf(13).className).toMatch(/text-theme-text-primary/);
    expect(dateTextOf(16).className).toMatch(/text-theme-text-primary/);
  });

  it('marks a past day by weight, the hierarchy dark mode is left with', () => {
    renderGrid();

    expect(dateTextOf(13)).toHaveClass('font-normal');
    expect(dateTextOf(14)).toHaveClass('font-normal');
    // Today has not passed.
    expect(dateTextOf(15)).toHaveClass('font-bold');
    expect(dateTextOf(16)).toHaveClass('font-bold');
  });
});
