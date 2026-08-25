/**
 * Local datetime integrity
 *
 * All datetimes are stored as UTC. ESLint enforces one half of that contract —
 * `.toLocaleString()`, `.toLocaleDateString()` and bare `date-fns` imports are
 * banned so a UTC instant is never rendered raw. Nothing enforced the other
 * half.
 *
 * `DateTimeQuarterHour` and `<input type="datetime-local">` both produce a
 * naive `YYYY-MM-DDTHH:mm` in the department's own timezone. Sent as-is, the
 * backend stores it as UTC, and the value silently shifts by the offset. That
 * shipped in `EventRequestsTab.handleSchedule`: a 6pm demo confirmed in a
 * UTC-05:00 department became 6pm UTC — 1pm locally — and the error propagated
 * into the calendar event, the requester's confirmation email, the volunteer
 * staffing shift and the call for help, all by the same five hours.
 *
 * `localToUTC(value, tz)` in utils/dateFormatting is the conversion. This walks
 * the source for a value bound to such an input that then reaches an API
 * payload without it.
 *
 * The check is deliberately narrow. A presentational modal takes the value as a
 * prop and never calls a service, and its parent wraps the value in
 * `localToUTC` before sending — of the twenty files using one of these inputs,
 * thirteen convert and the other seven are exactly that shape. Flagging a file
 * merely for containing a picker would fail on all seven. So this looks for the
 * one shape that is always wrong: an identifier bound to a picker's `value`
 * that also appears, bare, as a value in an object literal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** `<DateTimeQuarterHour ... value={x}` / `<input type="datetime-local" ... value={x}`. */
const PICKER_VALUE = /value=\{([A-Za-z_$][\w$]*)\}/g;

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // e2e drives a real browser; test files are not shipped screens.
      if (entry.name === 'e2e' || entry.name === 'node_modules') continue;
      found.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      found.push(full);
    }
  }
  return found;
};

/** Identifiers bound to the `value` of a naive datetime input in this source. */
export const pickerBoundIdentifiers = (source: string): Set<string> => {
  const bound = new Set<string>();
  // Walk each element that is one of the two naive inputs, then take the
  // `value={...}` binding that follows it within the same tag.
  const openings = /<(?:DateTimeQuarterHour|input)\b/g;
  let open: RegExpExecArray | null;
  while ((open = openings.exec(source))) {
    const tagEnd = source.indexOf('>', open.index);
    const tag = source.slice(open.index, tagEnd === -1 ? undefined : tagEnd);
    const isNaiveInput = tag.startsWith('<DateTimeQuarterHour') || /type="datetime-local"/.test(tag);
    if (!isNaiveInput) continue;
    PICKER_VALUE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PICKER_VALUE.exec(tag))) bound.add(m[1] as string);
  }
  return bound;
};

/**
 * Object-literal entries whose value is a bare picker-bound identifier.
 *
 * `event_date: scheduleDate,` is the defect. `event_date: localToUTC(scheduleDate, tz)`
 * and `value={scheduleDate}` are not, because neither is `key: identifier`.
 */
/** A call that puts the value on the wire, as opposed to handing it to a parent. */
const API_CALL = /(?:\w*[Ss]ervice\.\w+|\bapi\.(?:post|put|patch|delete))\s*\($/;

/**
 * Object-literal entries whose value is a bare picker-bound identifier, inside
 * a call that sends it to the API.
 *
 * Two shapes are deliberately NOT flagged, because both are correct and both
 * occur in this tree:
 *
 *   `event_date: x ? localToUTC(x, tz) : undefined`  — the conversion, written
 *   as a ternary so an empty optional field stays omitted.
 *
 *   `onSubmit({ start_date: startDate })`  — a presentational modal handing the
 *   raw value up; its parent converts before sending. CloneElectionModal and
 *   EditDatesModal both do this and ElectionDetailPage does the conversion.
 */
export const unconvertedPayloadKeys = (source: string): string[] => {
  const bound = pickerBoundIdentifiers(source);
  if (bound.size === 0) return [];
  const offenders: string[] = [];
  for (const name of bound) {
    const asPayloadValue = new RegExp(String.raw`(\w+):\s*${name}\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = asPayloadValue.exec(source))) {
      // `value: x` binds a control; it is not a payload.
      if (m[1] === 'value') continue;

      // The rest of this expression — if it converts, it is correct.
      const statementEnd = source.indexOf('\n', m.index);
      const expression = source.slice(m.index, statementEnd === -1 ? undefined : statementEnd);
      if (expression.includes('localToUTC(')) continue;

      // Walk back to the call this literal sits in. Anything that is not an
      // API call is a prop or a local object, and the conversion belongs to
      // whoever finally sends it.
      const before = source.slice(Math.max(0, m.index - 600), m.index);
      const callStart = before.lastIndexOf('(');
      if (callStart === -1) continue;
      if (!API_CALL.test(before.slice(0, callStart + 1))) continue;

      offenders.push(`${m[1]}: ${name}`);
    }
  }
  return offenders;
};

describe('local datetime integrity', () => {
  it('never sends a naive picker value straight into an API payload', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const entry of unconvertedPayloadKeys(source)) {
        offenders.push(`${path.relative(SRC, file)}  ->  ${entry}`);
      }
    }

    expect(
      offenders,
      'A value bound to DateTimeQuarterHour / <input type="datetime-local"> is a ' +
        "naive local time in the department's timezone. Sent as-is the backend " +
        'stores it as UTC and it shifts by the offset. Wrap it: ' +
        'localToUTC(value, tz) from utils/dateFormatting.\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  describe('the detector itself', () => {
    it('flags the shape that shipped', () => {
      const source = `
        <DateTimeQuarterHour value={scheduleDate} onChange={setScheduleDate} />
        await eventRequestService.scheduleRequest(id, { event_date: scheduleDate });
      `;
      expect(unconvertedPayloadKeys(source)).toEqual(['event_date: scheduleDate']);
    });

    it('accepts a converted payload', () => {
      const source = `
        <DateTimeQuarterHour value={scheduleDate} onChange={setScheduleDate} />
        await eventRequestService.schedule(id, { event_date: localToUTC(scheduleDate, tz) });
      `;
      expect(unconvertedPayloadKeys(source)).toEqual([]);
    });

    it('ignores a presentational component that only binds the value', () => {
      const source = `<DateTimeQuarterHour value={actualStartTime} onChange={onChange} />`;
      expect(unconvertedPayloadKeys(source)).toEqual([]);
    });

    it('ignores an ordinary text input', () => {
      const source = `
        <input type="text" value={notes} />
        await messageService.save({ notes: notes });
      `;
      expect(unconvertedPayloadKeys(source)).toEqual([]);
    });

    it('accepts the ternary conversion an optional field uses', () => {
      // `x ? localToUTC(x, tz) : undefined` keeps an empty field omitted while
      // still converting. Four real call sites are written this way.
      const source = `
        <DateTimeQuarterHour value={endDate} onChange={setEndDate} />
        await eventRequestService.schedule(id, {
          event_end_date: endDate ? localToUTC(endDate, tz) : undefined,
        });
      `;
      expect(unconvertedPayloadKeys(source)).toEqual([]);
    });

    it('ignores a child handing the raw value to its parent', () => {
      // CloneElectionModal does this and ElectionDetailPage converts. The
      // conversion belongs to whoever actually sends it.
      const source = `
        <input type="datetime-local" value={startDate} onChange={set} />
        onSubmit({ start_date: startDate, end_date: endDate });
      `;
      expect(unconvertedPayloadKeys(source)).toEqual([]);
    });

    it('still flags a date-only picker used as a payload value', () => {
      const source = `
        <input type="datetime-local" value={startsAt} onChange={set} />
        await messageService.save({ starts_at: startsAt || undefined });
      `;
      expect(unconvertedPayloadKeys(source)).toEqual(['starts_at: startsAt']);
    });
  });
});
