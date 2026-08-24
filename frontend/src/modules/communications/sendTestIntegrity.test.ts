/**
 * A test send reports what actually happened.
 *
 * `POST /message-history/test-email` answers **200 with the history row it
 * just wrote**, and that row says `failed` when the provider rejected the
 * message — a refused relay, a bad mailbox, SMTP switched off. Nothing throws.
 * So a caller that toasts success on the absence of an exception tells an
 * admin their email configuration works at exactly the moment it does not,
 * which is the single question the button exists to answer.
 *
 * The endpoint's own history records the other half of this: the button used
 * to post a blank address, the send went to "", SMTP rejected it, and the UI
 * reported success for an email nobody received. That was fixed server-side by
 * defaulting to the caller's own address; the client-side half — believing the
 * 200 — outlived it on the Email Templates page.
 *
 * Scanned rather than rendered because the defect is one missing branch at
 * each call site and the point is that *every* call site has it, including the
 * next one. Reaching either button in a render needs that page's whole store,
 * permission and fetch surface mocked, and a render test would pass against a
 * mock that happened to return `sent`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_ROOT = join(__dirname, '/');

const collect = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
};

/** Every file that asks the API to send a test email. */
const callSites = collect(MODULE_ROOT)
  .map((file) => ({ file: file.slice(MODULE_ROOT.length), source: readFileSync(file, 'utf8') }))
  .filter(({ source }) => source.includes('sendTestEmail('));

const sourceOf = (file: string): string => callSites.find((c) => c.file === file)?.source ?? '';

describe('test-email result handling', () => {
  it('finds the call sites', () => {
    // Two today: the Email Templates save bar and the History tab's own form.
    expect(callSites.length).toBeGreaterThanOrEqual(2);
  });

  it.each(callSites.map((c) => c.file))('%s keeps the result rather than discarding it', (file) => {
    // A bare `await ...sendTestEmail(...)` in statement position is the shape
    // of the bug: the row came back and nothing looked at it.
    expect(sourceOf(file)).not.toMatch(/^\s*await\s+messageHistoryService\.sendTestEmail\(/m);
  });

  it.each(callSites.map((c) => c.file))('%s branches on the reported status', (file) => {
    expect(sourceOf(file)).toContain("status === 'sent'");
  });

  it.each(callSites.map((c) => c.file))('%s surfaces the failure reason', (file) => {
    // `error_message` is what the provider said. Without it the toast can only
    // say "it failed", and the admin has nowhere to go next.
    expect(sourceOf(file)).toContain('error_message');
  });
});
