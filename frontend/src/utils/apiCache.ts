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

/**
 * URL prefixes for endpoints that must NEVER be cached.
 * These carry PII, PHI, credentials, or security-sensitive data
 * and caching them — even in-memory — conflicts with HIPAA §164.312.
 */
const UNCACHEABLE_PREFIXES = [
  '/auth/',           // credentials, session tokens, password ops
  '/users/',          // profiles, contact info, emergency contacts, audit history
  '/security/',       // alerts, audit log integrity, monitoring
  '/roles/my/',       // current user's permissions (security-sensitive)
  '/notifications/my/', // user-specific notification state
  '/training/waivers',  // medical/health waivers (PHI)
  '/training/submissions/', // user-specific training submissions
  '/training/shift-reports/', // attendance/location data
  '/training/stats/user/',    // individual compliance stats
  '/training/reports/user/',  // individual training reports
  '/facilities/emergency-contacts', // emergency contact PII
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
export function getCacheKey(
  url: string,
  params?: Record<string, unknown>,
): string {
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
 * Store a response in the cache.
 */
export function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
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
  return !UNCACHEABLE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Clear the entire cache. Useful on logout or session idle.
 */
export function clearCache(): void {
  cache.clear();
  pendingRevalidations.clear();
}
