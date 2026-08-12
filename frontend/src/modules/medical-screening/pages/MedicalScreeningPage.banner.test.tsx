/**
 * The "expiring in the next 30 days" banner counts screenings within 30 days.
 *
 * It used to print `expiringScreenings.length` — the whole store slice. The
 * page fills that slice with a 30-day fetch, but `ComplianceDashboard` fills
 * the *same* slice with a 60-day one, so opening the Compliance tab widened
 * the banner's data while leaving its sentence alone. The screenshot that
 * caught it read "3 screenings expiring in the next 30 days" above a list of
 * 6, 31 and 56 days: the true answer was one.
 *
 * Asserted against the source rather than a render: reaching the banner needs
 * the module's whole store, permission and fetch surface mocked, and a render
 * test would pass against a mock that happened to return only near-term rows —
 * which is precisely the case that hid this.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'MedicalScreeningPage.tsx'), 'utf8');

describe('MedicalScreeningPage expiring banner', () => {
  it('derives its own 30-day list rather than trusting the fetch window', () => {
    expect(source).toContain('const expiringWithin30 = expiringScreenings.filter(');
    expect(source).toContain('days_until_expiration');
  });

  it('counts that list, not the whole store slice', () => {
    const banner = source.slice(source.indexOf('{/* Expiring Soon Alert */}'), source.indexOf('{/* Tabs */}'));
    expect(banner).toContain('expiringWithin30.length');
    expect(banner).not.toContain('expiringScreenings.length');
  });

  it('still says 30 days, so the number and the sentence agree', () => {
    const banner = source.slice(source.indexOf('{/* Expiring Soon Alert */}'), source.indexOf('{/* Tabs */}'));
    expect(banner).toContain('the next 30 days');
  });
});
