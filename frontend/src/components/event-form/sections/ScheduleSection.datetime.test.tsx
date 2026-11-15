/**
 * The event form's date/time fields must not drift.
 *
 * `DateTimeQuarterHour` emits a local wall-clock string ("2026-09-15T09:00")
 * and `localToUTC` on submit interprets it as one. The value bindings once sent
 * it back out through `formatForDateTimeInput`, which parses a bare string as
 * an *instant* and re-renders it in the organization's timezone — so the field
 * lost the org's UTC offset on every render, compounding once per interaction.
 * Setting 9:00 AM and then adjusting the minutes left 5:00 AM behind; three
 * interactions in a row moved a 15 September 9:00 AM session to 14 September
 * 9:00 PM.
 *
 * That was found on the Create Training Session wizard. The wizard now draws
 * its schedule and RSVP deadline from the event form's own sections, so the
 * contract is checked where those controls live: `ScheduleSection` (start and
 * end), `RsvpSection` (the deadline) and the model that converts them on
 * submit.
 *
 * Asserted against the source: the bug is a wrapper around a value, and a
 * render test would need a full form with API mocks to reach the same line.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sections = ['ScheduleSection.tsx', 'RsvpSection.tsx'].map((file) => readFileSync(join(__dirname, file), 'utf8'));
const modelSource = readFileSync(join(__dirname, '..', 'useEventFormModel.ts'), 'utf8');

/** The props written on each DateTimeQuarterHour, whatever order they come in. */
const dateTimeControls = (): string[] =>
  sections.flatMap((source) => [...source.matchAll(/<DateTimeQuarterHour\b([\s\S]*?)\/>/g)].map((m) => m[1] ?? ''));

/** The `value={...}` expression bound to each DateTimeQuarterHour. */
const dateTimeValueBindings = (): string[] =>
  dateTimeControls().map((props) => /\bvalue=\{([^}]*)\}/.exec(props)?.[1] ?? '');

describe('event form date/time bindings', () => {
  it('finds the start, end and RSVP deadline controls', () => {
    expect(dateTimeValueBindings()).toHaveLength(3);
  });

  it('passes the stored local string straight to the control', () => {
    for (const binding of dateTimeValueBindings()) {
      expect(binding).toMatch(/^formData\.\w+/);
      expect(binding).not.toContain('formatForDateTimeInput');
    }
  });

  it('still converts to UTC once, on submit', () => {
    // The other half of the contract: if this ever stops happening the stored
    // wall-clock string would reach the API as though it were UTC.
    expect(modelSource).toContain('localToUTC(submitData.start_datetime, tz)');
    expect(modelSource).toContain('localToUTC(submitData.end_datetime, tz)');
    expect(modelSource).toContain('localToUTC(submitData.rsvp_deadline, tz)');
  });

  it('converts the quick-duration Date back into a local string', () => {
    // The one legitimate use left: a computed Date rendered for the field.
    expect(modelSource).toContain('update({ end_datetime: formatForDateTimeInput(end, tz) })');
  });
});

describe('event form date/time labels', () => {
  // The visible "Start Date & Time" text was a bare <label> with no `for`, so
  // the date input had no accessible name and a screen reader announced the
  // start, end and RSVP pickers identically as "date". Each picker now sits in
  // a FormField, which renders the label with `htmlFor` set to its `id` and
  // hands that id (and the error's aria-describedby) to the control.
  it('wraps every date/time control in a FormField whose id it receives', () => {
    const wrapped = sections.flatMap((source) => [
      ...source.matchAll(
        /<FormField\s+id="([^"]+)"(?:(?!<FormField)[\s\S])*?\{\(field\) => \(\s*<DateTimeQuarterHour\s+\{\.\.\.field\}/g
      ),
    ]);
    expect(wrapped).toHaveLength(dateTimeValueBindings().length);
    expect(wrapped.map((m) => m[1])).toEqual(['start-datetime', 'end-datetime', 'rsvp-deadline']);
  });
});
