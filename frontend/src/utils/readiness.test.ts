import { describe, it, expect } from 'vitest';
import { computeReadiness } from './readiness';
import type { ReadinessCert } from './readiness';

const cert = (overrides: Partial<ReadinessCert> = {}): ReadinessCert => ({
  id: 'cert-1',
  course_name: 'EMT-B Recertification',
  expiration_date: '2026-09-05',
  is_expired: false,
  days_until_expiry: 400,
  ...overrides,
});

describe('computeReadiness', () => {
  // A member with nothing tracked is *unknown*, not clear. Deriving a green
  // verdict from an empty set would assert something the department has no
  // basis for — the one failure mode that makes this feature worse than
  // having no verdict at all.
  it('returns null when the member holds no tracked certifications', () => {
    expect(computeReadiness([])).toBeNull();
  });

  it('reports clear when every certification is current', () => {
    const result = computeReadiness([cert(), cert({ id: 'c2', days_until_expiry: 200 })]);

    expect(result?.level).toBe('clear');
    expect(result?.headline).toBe('Clear to respond');
    expect(result?.detail).toBe('2 certifications current');
  });

  it('singularises a lone current certification', () => {
    expect(computeReadiness([cert()])?.detail).toBe('1 certification current');
  });

  it('reports conditions when a certification expires inside the window', () => {
    const result = computeReadiness([cert({ days_until_expiry: 24 }), cert({ id: 'c2', days_until_expiry: 300 })]);

    expect(result?.level).toBe('conditions');
    expect(result?.headline).toBe('Clear, with conditions');
    expect(result?.detail).toBe('1 certification expiring within 60 days');
  });

  it('counts every expiring certification rather than naming one', () => {
    const result = computeReadiness([
      cert({ id: 'c1', course_name: 'Hazmat Awareness', days_until_expiry: 50 }),
      cert({ id: 'c2', course_name: 'EMT-B Recertification', days_until_expiry: 12 }),
      cert({ id: 'c3', course_name: 'CPR', days_until_expiry: 30 }),
    ]);

    expect(result?.detail).toBe('3 certifications expiring within 60 days');
  });

  it('leaves a certification just outside the window alone', () => {
    expect(computeReadiness([cert({ days_until_expiry: 61 })])?.level).toBe('clear');
    expect(computeReadiness([cert({ days_until_expiry: 60 })])?.level).toBe('conditions');
  });

  it('reports not clear when anything has expired', () => {
    const result = computeReadiness([cert({ is_expired: true, days_until_expiry: -3 })]);

    expect(result?.level).toBe('not-clear');
    expect(result?.headline).toBe('Not clear to respond');
    expect(result?.detail).toBe('1 certification expired');
  });

  it('counts rather than names when several have expired', () => {
    const result = computeReadiness([
      cert({ id: 'c1', is_expired: true }),
      cert({ id: 'c2', is_expired: true, course_name: 'CPR' }),
    ]);

    expect(result?.detail).toBe('2 certifications expired');
  });

  // Expired outranks expiring: a member who is grounded should not be told
  // they are clear because a different card also happens to be near renewal.
  it('lets an expired certification outrank an expiring one', () => {
    const result = computeReadiness([cert({ id: 'c1', days_until_expiry: 10 }), cert({ id: 'c2', is_expired: true })]);

    expect(result?.level).toBe('not-clear');
  });

  it('treats a certification with no expiry as current', () => {
    expect(computeReadiness([cert({ expiration_date: null, days_until_expiry: null })])?.level).toBe('clear');
  });

  // The rows beneath the verdict state the course name and carry the renewal
  // button. Repeating it here is the "said twice" fault the redesign removed.
  it('never names a certification, so it cannot restate the row below it', () => {
    const named = [
      computeReadiness([cert({ days_until_expiry: 24 })]),
      computeReadiness([cert({ is_expired: true })]),
      computeReadiness([cert({ id: 'c1', is_expired: true }), cert({ id: 'c2', days_until_expiry: 10 })]),
    ];

    for (const result of named) {
      expect(result?.detail).not.toContain('EMT-B');
    }
  });

  it('still counts what the two-row panel below cannot show', () => {
    const certs = Array.from({ length: 5 }, (_, i) =>
      cert({ id: `c${i}`, course_name: `Course ${i}`, days_until_expiry: 10 + i })
    );

    expect(computeReadiness(certs)?.detail).toBe('5 certifications expiring within 60 days');
  });
});
