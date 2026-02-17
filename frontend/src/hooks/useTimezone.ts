/**
 * useTimezone Hook
 *
 * Returns the department's IANA timezone string (e.g., "America/New_York")
 * from the authenticated user's profile.  Falls back to the browser's
 * resolved timezone when the user is not yet loaded.
 */
import { useAuthStore } from '../stores/authStore';

export const useTimezone = (): string => {
  const tz = useAuthStore((s) => s.user?.timezone);
  return tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
};
