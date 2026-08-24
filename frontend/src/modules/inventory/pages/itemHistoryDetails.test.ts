import { describe, it, expect } from 'vitest';

import { formatHistoryDetails } from './itemHistoryDetails';

/**
 * History details arrive as the stored payload: column names for keys and UTC
 * instants for timestamps. Rendered straight, an item's History tab read
 *
 *   user_name: Nadia Belhaj | reason: ... | expected_return: 2026-08-20T23:40:15+00:00
 *   | is_returned: false | is_overdue: true
 *
 * which exposes internals and, worse, shows a UTC instant as though it were the
 * reader's own clock — the one thing the project's date rules forbid outright.
 */
const TZ = 'America/New_York';

describe('formatHistoryDetails', () => {
  it('formats a UTC instant in the organization timezone', () => {
    const line = formatHistoryDetails({ expected_return: '2026-08-20T23:40:15+00:00' }, TZ);

    expect(line).not.toContain('2026-08-20T23:40:15+00:00');
    expect(line).toMatch(/^Expected return: /);
    // 23:40 UTC is the evening of the 20th in New York, not the 21st.
    expect(line).toContain('August 20, 2026');
    expect(line).toContain('7:40 PM');
  });

  it('formats a plain calendar date without moving it into a timezone', () => {
    // The trap this guards: a date-only string is a calendar date, not an
    // instant. Converted into New York it slides to the day before.
    const line = formatHistoryDetails({ purchase_date: '2026-08-20' }, TZ);

    expect(line).toBe('Purchase date: Aug 20, 2026');
    expect(line).not.toContain('8/19');
  });

  it('reads booleans as words and humanizes the key', () => {
    expect(formatHistoryDetails({ is_overdue: true, is_returned: false }, TZ)).toBe(
      'Is overdue: Yes · Is returned: No'
    );
  });

  it('drops empty values rather than rendering a bare label', () => {
    const line = formatHistoryDetails({ notes: '', condition_after: 'good' }, TZ);

    expect(line).toBe('Condition after: good');
    expect(line).not.toContain('Notes:');
  });

  it('keeps free text untouched', () => {
    expect(formatHistoryDetails({ reason: 'Carried on the CO investigation.' }, TZ)).toBe(
      'Reason: Carried on the CO investigation.'
    );
  });

  it('returns an empty string for no details, so the caller renders nothing', () => {
    expect(formatHistoryDetails(null, TZ)).toBe('');
    expect(formatHistoryDetails({}, TZ)).toBe('');
    expect(formatHistoryDetails({ notes: null }, TZ)).toBe('');
  });
});
