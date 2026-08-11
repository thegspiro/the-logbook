/**
 * A lot's expiration is a calendar date, and must render as the day it says.
 *
 * `expiration_date` is a date-only string — no time, no zone — exactly like
 * `shift_date`. `formatDate` parses one as an *instant* (UTC midnight) and
 * re-renders it in the viewer's timezone, so west of UTC it shows the previous
 * day. The same lot then read `Exp 9/4/2026` on the apparatus inventory page,
 * which uses `formatCalendarDate`, and `Exp 9/3/2026` here.
 *
 * One box, two screens, two dates. Found by photographing both, not by a test:
 * each screen was internally consistent and only the pair disagreed.
 *
 * This is the same defect `formatCalendarDate` was added for on 2026-08-10, and
 * the same one the ESLint date rules exist to prevent — but `formatDate` is an
 * approved wrapper, so nothing flagged its use on a date-only value.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { formatCalendarDate } from '@/utils/dateFormatting';

const SOURCE = readFileSync(join(__dirname, 'StockLotsPanel.tsx'), 'utf8');

describe('StockLotsPanel lot expirations', () => {
  it('formats every expiration as a calendar date', () => {
    expect(SOURCE).not.toMatch(/formatDate\(\s*(lot|d)\./);
    // Both call sites: the ready lots on the shelf, and the deployed lots on
    // an apparatus. Missing either leaves the two halves of one panel
    // disagreeing about the same box.
    expect(SOURCE).toContain('formatCalendarDate(lot.expiration_date');
    expect(SOURCE).toContain('formatCalendarDate(d.expirationDate');
  });

  it('renders the day written in the string, whatever the viewer timezone', () => {
    // The regression itself, rather than the shape of the source. 2026-09-04
    // is a date west-of-UTC viewers previously saw as the 3rd.
    expect(formatCalendarDate('2026-09-04', { year: 'numeric', month: 'numeric', day: 'numeric' })).toBe('9/4/2026');
  });
});
