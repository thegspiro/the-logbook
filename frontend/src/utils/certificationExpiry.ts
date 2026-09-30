/**
 * Certification expiry, judged on the department's calendar.
 *
 * `expiration_date` is a calendar date — the last day the certificate is
 * valid — not an instant. `new Date('2026-09-30')` reads it as UTC midnight,
 * so comparing that against `new Date()` flagged a certificate "expired" from
 * the evening *before* its last valid day in any timezone west of UTC. The
 * backend draws the same line (`expiration_date < today` in the department's
 * zone, see `admin_hub_service`), so a certificate is expired only once the
 * department's date has moved past it.
 */
import { calendarDaysFromToday } from './dateFormatting';

/** How far ahead a certification counts as "expiring soon". */
export const CERTIFICATION_EXPIRING_SOON_DAYS = 90;

export const isCertificationExpired = (expirationDate: string | null | undefined, timezone: string): boolean => {
  const days = calendarDaysFromToday(expirationDate, timezone);
  return days !== null && days < 0;
};

export const isCertificationExpiringSoon = (expirationDate: string | null | undefined, timezone: string): boolean => {
  const days = calendarDaysFromToday(expirationDate, timezone);
  return days !== null && days >= 0 && days <= CERTIFICATION_EXPIRING_SOON_DAYS;
};
