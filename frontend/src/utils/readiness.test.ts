import { describe, it, expect } from 'vitest';
import { computeReadiness, currentCredentials } from './readiness';
import type { ReadinessCert, ReadinessScreenings } from './readiness';

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
    const result = computeReadiness([cert(), cert({ id: 'c2', course_name: 'CPR', days_until_expiry: 200 })]);

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
    const result = computeReadiness([
      cert({ id: 'c1', days_until_expiry: 10 }),
      cert({ id: 'c2', course_name: 'CPR', is_expired: true }),
    ]);

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

  // Screenings enter the verdict as counts. The backend never sends names, so
  // there is nothing here that could name one.
  describe('with medical screenings', () => {
    const screenings = (over: Partial<ReadinessScreenings> = {}): ReadinessScreenings => ({
      total_requirements: 2,
      non_compliant_count: 0,
      expiring_soon_count: 0,
      ...over,
    });

    it('grounds a member whose screening is overdue', () => {
      const result = computeReadiness([cert()], screenings({ non_compliant_count: 1 }));

      expect(result?.level).toBe('not-clear');
      expect(result?.detail).toBe('1 screening overdue');
    });

    it('combines certification and screening problems in one sentence', () => {
      const result = computeReadiness([cert({ is_expired: true })], screenings({ non_compliant_count: 2 }));

      expect(result?.detail).toBe('1 certification expired and 2 screenings overdue');
    });

    it('treats an expiring screening as a condition', () => {
      const result = computeReadiness([cert()], screenings({ days_until_next_expiration: 20 }));

      expect(result?.level).toBe('conditions');
      expect(result?.detail).toBe('a screening expiring in 20 days');
    });

    it('counts both when everything is current', () => {
      expect(computeReadiness([cert()], screenings())?.detail).toBe('1 certification and 2 screenings current');
    });

    it('ignores a department that tracks no screenings', () => {
      const result = computeReadiness([cert()], screenings({ total_requirements: 0 }));

      expect(result?.detail).toBe('1 certification current');
    });

    // A member with no certifications is not "unknown" if screenings are
    // tracked — there is something real to say about them.
    it('still answers for a member with screenings but no certifications', () => {
      expect(computeReadiness([], screenings({ non_compliant_count: 1 }))?.level).toBe('not-clear');
      expect(computeReadiness([], screenings())?.detail).toBe('2 screenings current');
    });

    it('stays silent when neither is tracked', () => {
      expect(computeReadiness([], screenings({ total_requirements: 0 }))).toBeNull();
      expect(computeReadiness([], null)).toBeNull();
      expect(computeReadiness([], undefined)).toBeNull();
    });

    // A failed read must never be read as a pass.
    it('does not treat a missing screening read as compliant', () => {
      const withRead = computeReadiness([cert()], screenings({ non_compliant_count: 1 }));
      const withoutRead = computeReadiness([cert()], undefined);

      expect(withRead?.level).toBe('not-clear');
      expect(withoutRead?.detail).toBe('1 certification current');
      expect(withoutRead?.detail).not.toContain('screening');
    });
  });

  // /training/module-config/my-training returns every record carrying an
  // expiration date — a history, not a current-credential list. Judging the
  // lapsed row grounds a member for having renewed.
  describe('certification history', () => {
    it('judges only the newest credential for a course', () => {
      const result = computeReadiness([
        cert({ id: 'old', expiration_date: '2024-09-05', is_expired: true, days_until_expiry: -700 }),
        cert({ id: 'new', expiration_date: '2028-09-05', is_expired: false, days_until_expiry: 700 }),
      ]);

      expect(result?.level).toBe('clear');
      expect(result?.detail).toBe('1 certification current');
    });

    it('still grounds a member whose newest credential has lapsed', () => {
      const result = computeReadiness([
        cert({ id: 'old', expiration_date: '2022-01-01', is_expired: true, days_until_expiry: -1500 }),
        cert({ id: 'new', expiration_date: '2026-01-01', is_expired: true, days_until_expiry: -30 }),
      ]);

      expect(result?.level).toBe('not-clear');
      expect(result?.detail).toBe('1 certification expired');
    });

    it('keeps distinct courses apart', () => {
      const result = computeReadiness([
        cert({ id: 'a', course_name: 'EMT-B', expiration_date: '2028-01-01', days_until_expiry: 700 }),
        cert({ id: 'b', course_name: 'CPR', expiration_date: '2028-01-01', days_until_expiry: 700 }),
      ]);

      expect(result?.detail).toBe('2 certifications current');
    });

    it('treats a credential with no expiry as never superseded', () => {
      const kept = currentCredentials([
        cert({ id: 'forever', expiration_date: null, days_until_expiry: null }),
        cert({ id: 'dated', expiration_date: '2028-01-01', days_until_expiry: 700 }),
      ]);

      expect(kept).toHaveLength(1);
      expect(kept[0]?.id).toBe('forever');
    });
  });

  // The backend counts expiring_soon over 30 days; certifications use 60. A
  // screening lapsing in 45 days must not read as current beside a
  // certification at the same distance that reads as a condition.
  describe('screening expiry window', () => {
    const base = { total_requirements: 2, non_compliant_count: 0, expiring_soon_count: 0 };

    it('treats a screening inside the readiness window as a condition', () => {
      const result = computeReadiness([cert()], { ...base, days_until_next_expiration: 45 });

      expect(result?.level).toBe('conditions');
      expect(result?.detail).toBe('a screening expiring in 45 days');
    });

    it('includes one lapsing today, which the backend window excludes', () => {
      const result = computeReadiness([cert()], { ...base, days_until_next_expiration: 0 });

      expect(result?.level).toBe('conditions');
      expect(result?.detail).toBe('a screening expiring in 0 days');
    });

    it('leaves one beyond the window alone', () => {
      const result = computeReadiness([cert()], { ...base, days_until_next_expiration: 61 });

      expect(result?.level).toBe('clear');
    });
  });
});
