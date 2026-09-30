import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCertificationExpired, isCertificationExpiringSoon } from './certificationExpiry';

const NY = 'America/New_York';

describe('certification expiry on the department calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 20:00 in New York on 2026-09-30 — already 2026-10-01 in UTC.
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not expired on its last valid day, even after UTC midnight', () => {
    expect(isCertificationExpired('2026-09-30', NY)).toBe(false);
    expect(isCertificationExpiringSoon('2026-09-30', NY)).toBe(true);
  });

  it('is expired once the department date has passed it', () => {
    expect(isCertificationExpired('2026-09-29', NY)).toBe(true);
    expect(isCertificationExpiringSoon('2026-09-29', NY)).toBe(false);
  });

  it('reads the same instant against a zone already on the next day', () => {
    expect(isCertificationExpired('2026-09-30', 'UTC')).toBe(true);
  });

  it('is not expiring soon beyond the 90-day window', () => {
    expect(isCertificationExpiringSoon('2026-12-29', NY)).toBe(true);
    expect(isCertificationExpiringSoon('2026-12-30', NY)).toBe(false);
  });

  it('treats a missing date as neither', () => {
    expect(isCertificationExpired(undefined, NY)).toBe(false);
    expect(isCertificationExpiringSoon(null, NY)).toBe(false);
  });
});
