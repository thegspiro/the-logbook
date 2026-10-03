/**
 * A reminder send that failed must not be reported as a success.
 *
 * `POST /elections/{id}/remind-non-voters` returns the same EmailBallotResponse
 * as send-ballot, with `success: failed == 0`. `handleSendBallotEmails` reads
 * that flag and toasts red when it is false; `handleSendReminders` ignored it
 * and called `toast.success` unconditionally, so "Reminders sent to 0
 * non-voter(s), 12 failed" appeared in green. The same handler also feeds
 * `lastSkippedDetails`, whose banner heading was hard-wired to "when sending
 * ballots", so a reminder-time skip was attributed to the wrong send.
 *
 * Asserted against the source, like ElectionDetailPage.w50-s18.test.tsx:
 * rendering this page needs a dozen services mocked, and the defect is one
 * missing branch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');
const start = page.indexOf('const handleSendReminders');
const end = page.indexOf('const handleDeleteElection');
const handler = page.slice(start, end);

describe('ElectionDetailPage remind non-voters outcome (S20)', () => {
  it('reads response.success before choosing the toast, like the ballot send does', () => {
    expect(handler).toMatch(/response\.success/);
    expect(handler).toMatch(/toast\.error\(/);
  });

  it('does not attribute a reminder-time skip to the ballot send', () => {
    expect(page).not.toMatch(/member\(s\) skipped when sending ballots/);
  });
});
