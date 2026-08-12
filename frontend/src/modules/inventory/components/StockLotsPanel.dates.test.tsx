/**
 * An expiration date is a calendar date, not an instant.
 *
 * The panel formatted lot expirations with `formatDate(value, tz)`, which
 * converts through a timezone. "Expires 2026-09-04" is the same day for every
 * reader, so converting it printed the day before for any viewer behind UTC —
 * and the day count on the same line is computed in calendar space, so the two
 * disagreed inside one sentence: "Exp 9/3/2026 · 24d left", when 24 days after
 * 8/11 is 9/4. The screenshot is what caught it.
 *
 * `formatCalendarDate` is the repo's helper for exactly this, and the apparatus
 * inventory screen was already using it for the same values.
 *
 * Asserted against the source: rendering the panel needs the item, its lots,
 * its deployments and a timezone context, and a test running in UTC would pass
 * against the broken formatter — which is how this survived.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'StockLotsPanel.tsx'), 'utf8');

describe('StockLotsPanel expiration dates', () => {
  it('formats both the shelf lot and the deployed lot in calendar space', () => {
    const calls = source.match(/formatCalendarDate\(/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it('does not put a calendar date through the timezone formatter', () => {
    expect(source).not.toContain('formatDate(lot.expiration_date');
    expect(source).not.toContain('formatDate(d.expirationDate');
  });

  it('still asks "how many days left" from where the reader is standing', () => {
    // The count is the one part that is genuinely relative to the viewer.
    expect(source).toContain('getTodayLocalDate(tz)');
  });
});
