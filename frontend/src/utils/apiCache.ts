/**
 * API Response Cache
 *
 * In-memory cache for GET request responses with stale-while-revalidate
 * semantics. Eliminates redundant network requests when navigating between
 * pages, making repeated page visits feel instant.
 *
 * - FRESH window (0-30s): return cached data, skip network request entirely.
 * - STALE window (30s-90s): return cached data immediately, trigger a
 *   background revalidation so the next caller gets fresh data.
 * - EXPIRED (>90s): cache miss, make a normal network request.
 *
 * Mutations (POST/PUT/PATCH/DELETE) automatically invalidate related cache
 * entries by URL prefix to ensure data consistency.
 */

/** How long a cached response is considered fresh (no network request). */
const FRESH_TTL_MS = 30_000; // 30 seconds

/** How long a cached response can be served while revalidating in background. */
const STALE_TTL_MS = 90_000; // 90 seconds (kept short to limit authorization-revocation gap)

/** Maximum number of entries before the oldest are evicted. */
const MAX_CACHE_ENTRIES = 200;

/**
 * URL prefixes for endpoints that must NEVER be cached.
 * These carry PII, PHI, credentials, or security-sensitive data
 * and caching them — even in-memory — conflicts with HIPAA §164.312.
 */
const UNCACHEABLE_PREFIXES = [
  '/auth/', // credentials, session tokens, password ops
  '/users', // roster + profiles, contact info, emergency contacts (no trailing slash so GET /users list is covered too)
  '/security/', // alerts, audit log integrity, monitoring
  '/audit-logs', // org audit trail: who did what, when, from where
  '/ip-security/', // IP exceptions, blocked attempts, country rules
  '/medical-screening/', // member medical screening records & compliance (PHI)
  '/message-history', // sent-message log: recipient emails, subjects (PII)
  '/roles/my/', // current user's permissions (security-sensitive)
  '/notifications/my', // user-specific notification state (list too, not just sub-paths)
  '/notifications/logs', // delivery logs: recipient identities (PII)
  '/email-templates/scheduled', // scheduled emails: recipient PII
  '/officers', // office holders: member names, emails, phone numbers (PII)
  '/nfc-tags', // member ID card credentials: names, card state, usage (PII + security)
  '/testing-checklist', // shared testing run: another tester's mark can land at any moment, and a stale one reads as a lost result
  '/training/waivers', // medical/health waivers (PHI)
  '/training/submissions/', // user-specific training submissions
  '/training/shift-reports/', // attendance/location data
  '/training/stats/user/', // individual compliance stats
  '/training/reports/user/', // individual training reports
  '/training/compliance-summary/', // per-member compliance status
  '/training/requirements/progress/', // per-member requirement progress
  '/training/category-hours/', // per-member hours by category (GET /category-hours/{user_id})
  '/training/competency/', // per-member competency evaluations
  '/training/recertification/tasks/', // per-member renewal tasks
  '/training/module-config/my-training', // current user's full training record
  '/training/programs/enrollments/', // per-member program enrollment & progress
  '/training/instructors/qualifications', // per-member instructor credentials
  '/training/compliance-matrix', // org-wide per-member compliance rollup (names + status)
  '/training/competency-matrix', // org-wide per-member competency heat map (names + status) — same shape as compliance-matrix above
  '/training/dashboard-summary', // dashboard widgets: per-member names on at-risk/needs-intervention lists
  '/training/sessions/approve/', // approval-token roster: attendee names + emails (GET /sessions/approve/{token})
  '/training/certifications/expiring', // member cert-expiry list (names, numbers)
  '/training/expiring-certifications', // under-gated twin of the above (member certs)
  '/training/reports/compliance-forecast', // per-member compliance projection
  '/training/records', // individual training records (scores, certs) — member PHI-adjacent
  '/training/skills-testing/tests', // per-member skills-test scores + evaluator notes (PHI)
  '/training/cohorts/', // cohort detail carries a resolved-name+email member roster (bare list is roster-free)
  '/training/programs/programs/', // per-program enrollment eligibility carries a full member roster + reason
  '/training/external/providers/', // provider user-mappings carry internal member name + email
  '/facilities/emergency-contacts', // emergency contact PII
  '/messages', // department messages: targeted announcements + per-member inbox/read state (no trailing slash covers GET /messages)
  '/admin-hours/', // individual work hours and clock-in records
  '/prospective-members/', // applicant PII (name, contact, documents)
  '/scheduling/', // member shift assignments and availability
  '/errors', // error logs (incl. GET /errors list) may contain user context and tracebacks
  '/organization/', // org settings including auth config, API keys
  '/elections', // voter lists, ballots, election results (no trailing slash so the list endpoint GET /elections is covered too)
  '/minutes-records/', // meeting minutes with potentially sensitive discussions
  '/meetings', // meeting list + detail: attendee PII, notes/motions/agenda (no trailing slash covers both)
  '/event-requests', // external event-request intake: contact name/email/phone, venue address (PII)
  '/events/missed-mandatory', // caller's own missed mandatory attendance (per-member compliance)
  '/forms', // form defs carry admin notification emails + creator id; no trailing slash so GET /forms list is covered too
  '/inventory/users/', // member-specific inventory, issuances & history (PII)
  '/inventory/checkout/', // GET active/overdue: who currently holds equipment (PII)
  '/inventory/members-summary', // per-member inventory roster (names, membership numbers)
  '/inventory/members/', // member size preferences — body measurements (PII)
  '/inventory/my/', // current user's own size preferences (PII)
  '/inventory/charges', // per-member cost-recovery / financial liability (PII)
  '/store/', // member orders: names, email/phone, shipping addresses, payment references, amounts owed (PII)
  '/documents', // private organizational documents (list + detail)
  '/compliance/', // compliance attestations, member compliance data (PII)
  '/integrations', // integration config (list + detail): API keys, webhook URLs, secrets
  '/finance/', // budgets, purchase/expense/check requests & reimbursements tied to members (PII)
  '/grants', // grant applications and donor/fundraising records (PII); no trailing slash so GET /grants list is covered too
  '/roles/user/', // an arbitrary user's full permission set (authz data)
  '/roles/admin-access', // admin-status probe (authz decision — must not go stale)
  '/facilities/occupants', // facility occupant PII
  '/facilities/access-keys', // physical building access-key inventory
  '/admin-hub/', // module attention queues: medical-screening lapses, applicant backlogs (PHI/PII-adjacent)
  '/equipment-checks', // reporter/member names, free-text restock notes, deployed-lot detail (PII)
  '/analytics/export', // raw analytics events: per-event user_id + free-form metadata
] as const;

/**
 * Substring patterns for sensitive SUB-resources whose parent path IS cacheable
 * (e.g. event list/detail may be cached, but a specific event's attendance
 * roster must not be). These are matched with `includes` because the resource
 * id sits mid-path, so a `startsWith` prefix cannot target them.
 */
const UNCACHEABLE_SUBSTRINGS = [
  '/rsvps', // event attendance roster (member names/status — PII)
  '/rsvp-history', // per-member attendance/decline history (PII) — not matched by '/rsvps'
  '/eligible-members', // returns member first/last name + email (PII)
  '/external-attendees', // external attendee PII
  '/check-in-monitoring', // live attendee/location check-in data (PII)
] as const;

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export interface CacheLookupResult {
  data: unknown;
  /** True if the entry is within the fresh window. */
  fresh: boolean;
}

const cache = new Map<string, CacheEntry>();
const pendingRevalidations = new Set<string>();

/**
 * Build a deterministic cache key from a URL path and optional query params.
 */
export function getCacheKey(url: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return url;

  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);

  return sorted.length > 0 ? `${url}?${sorted.join('&')}` : url;
}

/**
 * Look up a cached response. Returns null on cache miss or expiry.
 */
export function getCached(key: string): CacheLookupResult | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > STALE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return {
    data: entry.data,
    fresh: age <= FRESH_TTL_MS,
  };
}

/**
 * Store a response in the cache, evicting the oldest entries if the
 * cache exceeds MAX_CACHE_ENTRIES.
 */
export function setCache(key: string, data: unknown): void {
  // Delete first so re-insertion moves the key to the end (Map preserves insertion order)
  cache.delete(key);
  cache.set(key, { data, timestamp: Date.now() });

  // Evict oldest entries when over the limit
  if (cache.size > MAX_CACHE_ENTRIES) {
    const excess = cache.size - MAX_CACHE_ENTRIES;
    const iter = cache.keys();
    for (let i = 0; i < excess; i++) {
      const oldest = iter.next();
      // Unreachable at runtime: `excess` is `size - MAX_CACHE_ENTRIES` and the
      // cap is positive, so the iterator always yields at least `excess` keys.
      // The check is here for the type system — `next().value` is
      // `string | undefined`, and `cache.delete` takes a `string`. Removing it
      // fails typecheck with TS2345 rather than changing behaviour, which is
      // why mutation testing reports this branch as an equivalent mutant and
      // no test can kill it.
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }
  }
}

/**
 * Check whether a background revalidation is already in progress for this key.
 */
export function isRevalidating(key: string): boolean {
  return pendingRevalidations.has(key);
}

/**
 * Mark a key as having a background revalidation in progress.
 */
export function markRevalidating(key: string): void {
  pendingRevalidations.add(key);
}

/**
 * Clear the revalidation flag for a key.
 */
export function clearRevalidating(key: string): void {
  pendingRevalidations.delete(key);
}

/**
 * Invalidate all cache entries whose key starts with the given prefix.
 * Used after mutations to ensure stale data is not served.
 */
export function invalidateByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Extract the base resource path for cache invalidation.
 * E.g. "/events/123/rsvp" → "/events", "/users/123" → "/users"
 */
export function getResourcePrefix(url: string): string {
  // Strip leading slash, split, take first segment, re-add slash
  const segments = url.replace(/^\//, '').split('/');
  return '/' + (segments[0] ?? '');
}

/**
 * Check whether a URL is eligible for caching.
 * Returns false for endpoints carrying sensitive/PII/PHI data.
 */
export function isCacheable(url: string): boolean {
  if (UNCACHEABLE_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return false;
  }
  return !UNCACHEABLE_SUBSTRINGS.some((pattern) => url.includes(pattern));
}

/**
 * Clear the entire cache. Useful on logout or session idle.
 */
export function clearCache(): void {
  cache.clear();
  pendingRevalidations.clear();
}
