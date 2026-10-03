/**
 * "No linked meeting" must actually clear the link.
 *
 * `PATCH /elections/{id}` is applied with `model_dump(exclude_unset=True)`, so
 * an omitted key means "leave this alone" and only an explicit `null` clears
 * (CLAUDE.md Pitfall #1, update half). `handleMeetingChange` assigned
 * `undefined`, which `JSON.stringify` drops from the body, so choosing
 * "No linked meeting" (or switching event -> meeting) left the old id in place
 * behind a "Meeting link updated" toast.
 *
 * Asserted against the source, like ElectionDetailPage.tab.test.tsx: rendering
 * this page needs a dozen services mocked, and the defect is three assignments.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');
const start = page.indexOf('const handleMeetingChange');
const end = page.indexOf('const handleImportMeetingAttendees');
const handler = page.slice(start, end);

describe('ElectionDetailPage meeting link clear (S18)', () => {
  it('an undefined field never reaches the wire', () => {
    expect(JSON.stringify({ meeting_id: undefined, event_id: 'e1' })).toBe('{"event_id":"e1"}');
  });

  it('clears the meeting/event link with an explicit null, not undefined', () => {
    expect(handler).not.toMatch(/updateData\.meeting_id = undefined/);
    expect(handler).not.toMatch(/updateData\.event_id = undefined/);
    expect(handler).not.toMatch(/updateData\.meeting_date = undefined/);
    expect(handler).toMatch(/updateData\.meeting_id = null/);
    expect(handler).toMatch(/updateData\.event_id = null/);
    expect(handler).toMatch(/updateData\.meeting_date = null/);
  });
});
