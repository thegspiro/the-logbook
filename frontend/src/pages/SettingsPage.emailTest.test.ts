/**
 * The email connection test reports on the form it was sent, not the form on
 * screen when the answer arrives.
 *
 * Asserted against the source for the reason `SettingsPage.urls.test.ts`
 * gives: rendering this page needs its whole service and permission surface
 * mocked, and what is pinned here is one snapshot and one comparison.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'SettingsPage.tsx'), 'utf8');
const handler = source.slice(
  source.indexOf('const handleTestEmail = async () => {'),
  source.indexOf('// ── File storage handlers ──')
);

describe('SettingsPage email connection test', () => {
  // A test can take up to 30 seconds. An admin who corrects the password
  // while it runs would otherwise see a green toast for the value they
  // just replaced.
  it('sends the form as it was when the test started', () => {
    expect(handler).toContain('const submitted = emailSettings;');
    expect(handler).toContain('organizationService.testEmailSettings(submitted)');
  });

  it('discards the result if the form changed while the test was pending', () => {
    expect(handler).toContain('if (emailSettingsRef.current !== submitted) {');
    expect(handler).toContain('Email settings changed while the test was running. Test again.');
    // The stale branch returns before either outcome toast can fire.
    expect(handler.indexOf('emailSettingsRef.current !== submitted')).toBeLessThan(
      handler.indexOf('if (result.success) {')
    );
  });

  it('keeps the ref current with every edit so the comparison is live', () => {
    expect(source).toContain('emailSettingsRef.current = emailSettings;');
    expect(source).toContain('}, [emailSettings]);');
  });
});
