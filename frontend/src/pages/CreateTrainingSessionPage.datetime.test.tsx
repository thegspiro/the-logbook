/**
 * The Create Training Session wizard's date/time fields must not drift.
 *
 * `DateTimeQuarterHour` emits a local wall-clock string ("2026-09-15T09:00")
 * and `localToUTC` on submit interprets it as one. The value bindings sent it
 * back out through `formatForDateTimeInput`, which parses a bare string as an
 * *instant* and re-renders it in the organization's timezone — so the field
 * lost the org's UTC offset on every render, compounding once per interaction.
 * Setting 9:00 AM and then adjusting the minutes left 5:00 AM behind; three
 * interactions in a row moved a 15 September 9:00 AM session to 14 September
 * 9:00 PM.
 *
 * Asserted against the source: the bug is a wrapper around a value, and a
 * render test would need a full wizard with API mocks to reach the same line.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'CreateTrainingSessionPage.tsx'), 'utf8');

/** The `value={...}` expression bound to each DateTimeQuarterHour. */
const dateTimeValueBindings = (): string[] =>
  [...source.matchAll(/<DateTimeQuarterHour\s+value=\{([^}]*)\}/g)].map((m) => m[1] ?? '');

describe('CreateTrainingSessionPage date/time bindings', () => {
  it('finds the date/time controls', () => {
    expect(dateTimeValueBindings().length).toBeGreaterThanOrEqual(3);
  });

  it('passes the stored local string straight to the control', () => {
    for (const binding of dateTimeValueBindings()) {
      expect(binding).not.toContain('formatForDateTimeInput');
    }
  });

  it('still converts to UTC once, on submit', () => {
    // The other half of the contract: if this ever stops happening the stored
    // wall-clock string would reach the API as though it were UTC.
    expect(source).toContain('localToUTC(formData.start_datetime, tz)');
    expect(source).toContain('localToUTC(formData.end_datetime, tz)');
  });

  it('converts the quick-duration Date back into a local string', () => {
    // The one legitimate use left: a computed Date rendered for the field.
    expect(source).toContain("updateField('end_datetime', formatForDateTimeInput(end, tz))");
  });
});
