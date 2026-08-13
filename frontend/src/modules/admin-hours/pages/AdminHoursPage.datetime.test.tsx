/**
 * Admin hours date/time fields must convert to UTC exactly once, on submit.
 *
 * `DateTimeQuarterHour` emits a local wall-clock string ("2026-08-12T09:00").
 * The manual-entry form and the pending-review edit form both used to send
 * that string straight to the API: Pydantic parsed it as a naive datetime,
 * the service compared it against aware UTC `now`, and the member got an
 * opaque HTTP 500 (TypeError: can't compare offset-naive and offset-aware
 * datetimes). Even without the crash, the hours would have been recorded
 * shifted by the org's UTC offset.
 *
 * Asserted against the source (same approach as
 * CreateTrainingSessionPage.datetime.test.tsx): the bug is a missing wrapper
 * around a payload value, and a render test would need the full page with API
 * mocks to reach the same line.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(join(__dirname, 'AdminHoursPage.tsx'), 'utf8');
const reviewSource = readFileSync(join(__dirname, '..', 'components', 'PendingReviewTab.tsx'), 'utf8');

describe('AdminHoursPage manual entry submit', () => {
  const submitCall = pageSource.match(/createManual\(\{[\s\S]*?\}\);/)?.[0] ?? '';

  it('finds the createManual call', () => {
    expect(submitCall).not.toBe('');
  });

  it('converts both timestamps to UTC in the payload', () => {
    expect(submitCall).toContain('localToUTC(manualData.clock_in_at, tz)');
    expect(submitCall).toContain('localToUTC(manualData.clock_out_at, tz)');
  });
});

describe('PendingReviewTab edit save', () => {
  const saveCall = reviewSource.match(/editEntry\(editingEntryId,[\s\S]*?\}\);/)?.[0] ?? '';

  it('finds the editEntry call', () => {
    expect(saveCall).not.toBe('');
  });

  it('converts both timestamps to UTC in the payload', () => {
    expect(saveCall).toContain('localToUTC(editData.clock_in_at, tz)');
    expect(saveCall).toContain('localToUTC(editData.clock_out_at, tz)');
  });
});
