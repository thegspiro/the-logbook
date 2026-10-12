/**
 * Domain handling for the Department Email settings section. Kept apart from
 * the component so it can be shared and tested without rendering.
 */

// A bare hostname: labels of letters, digits and hyphens, at least one dot.
const DOMAIN_PATTERN = /^(?=.{1,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** What an admin types, as the generator will use it: no "@", no case, no spaces. */
export function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** Why a (normalized) domain cannot be saved, or null when it can. */
export function domainError(domain: string, enabled: boolean): string | null {
  if (!domain) return enabled ? 'Enter the domain addresses should be created on.' : null;
  return DOMAIN_PATTERN.test(domain) ? null : 'Enter a domain like firedept.org, without "@" or "https://".';
}
