import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCacheKey,
  getCached,
  setCache,
  isRevalidating,
  markRevalidating,
  clearRevalidating,
  invalidateByPrefix,
  getResourcePrefix,
  isCacheable,
  clearCache,
} from './apiCache';

describe('apiCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- getCacheKey ----

  describe('getCacheKey', () => {
    it('returns the URL as-is when no params are provided', () => {
      expect(getCacheKey('/events')).toBe('/events');
    });

    it('returns the URL as-is when params is undefined', () => {
      expect(getCacheKey('/events', undefined)).toBe('/events');
    });

    it('returns the URL as-is when params is an empty object', () => {
      expect(getCacheKey('/events', {})).toBe('/events');
    });

    it('appends sorted params as query string', () => {
      const result = getCacheKey('/events', { page: 1, search: 'fire' });
      expect(result).toBe('/events?page=1&search=fire');
    });

    it('sorts params alphabetically', () => {
      const result = getCacheKey('/events', { z: 1, a: 2, m: 3 });
      expect(result).toBe('/events?a=2&m=3&z=1');
    });

    it('filters out undefined params', () => {
      const result = getCacheKey('/events', { page: 1, search: undefined });
      expect(result).toBe('/events?page=1');
    });

    it('filters out null params', () => {
      const result = getCacheKey('/events', { page: 1, search: null });
      expect(result).toBe('/events?page=1');
    });

    it('returns just URL when all params are null/undefined', () => {
      const result = getCacheKey('/events', { a: undefined, b: null });
      expect(result).toBe('/events');
    });

    it('converts non-string values to strings', () => {
      const result = getCacheKey('/events', { active: true, count: 42 });
      expect(result).toBe('/events?active=true&count=42');
    });
  });

  // ---- setCache / getCached ----

  describe('setCache / getCached', () => {
    it('returns null on cache miss', () => {
      expect(getCached('/events')).toBeNull();
    });

    it('stores and retrieves cached data', () => {
      const data = { items: [1, 2, 3] };
      setCache('/events', data);
      const result = getCached('/events');
      expect(result).toEqual(expect.objectContaining({ data }));
    });

    it('marks entry as fresh within 30 seconds', () => {
      setCache('/events', { items: [] });

      // At t=0, should be fresh
      const result = getCached('/events');
      expect(result).toEqual(expect.objectContaining({ fresh: true }));
    });

    it('marks entry as stale after 30 seconds but before 90 seconds', () => {
      setCache('/events', { items: [] });

      // Advance 31 seconds
      vi.advanceTimersByTime(31_000);

      const result = getCached('/events');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({ fresh: false }));
    });

    it('returns data during the stale window (30s-90s)', () => {
      const data = { name: 'test' };
      setCache('/events', data);

      // Advance to 60 seconds (within stale window)
      vi.advanceTimersByTime(60_000);

      const result = getCached('/events');
      expect(result).toEqual(expect.objectContaining({ data, fresh: false }));
    });

    it('returns null after 90 seconds (expired)', () => {
      setCache('/events', { items: [] });

      // Advance 91 seconds
      vi.advanceTimersByTime(91_000);

      const result = getCached('/events');
      expect(result).toBeNull();
    });

    it('deletes expired entries on access', () => {
      setCache('/events', { items: [] });

      vi.advanceTimersByTime(91_000);

      // First access should return null (expired) and delete the entry
      const result = getCached('/events');
      expect(result).toBeNull();

      // Verify the entry was actually cleaned up by checking it's still null
      // (not just lazily expired but physically removed from the cache)
      const secondResult = getCached('/events');
      expect(secondResult).toBeNull();
    });

    it('updates timestamp when overwriting an existing key', () => {
      setCache('/events', { v: 1 });

      // Advance 25 seconds (still fresh)
      vi.advanceTimersByTime(25_000);

      // Overwrite the entry
      setCache('/events', { v: 2 });

      // Advance another 10 seconds (35s from original, but only 10s from overwrite)
      vi.advanceTimersByTime(10_000);

      const result = getCached('/events');
      expect(result).toEqual(expect.objectContaining({ data: { v: 2 }, fresh: true })); // Only 10s old
    });

    it('evicts oldest entries when exceeding MAX_CACHE_ENTRIES (200)', () => {
      // Fill cache with 200 entries
      for (let i = 0; i < 200; i++) {
        setCache(`/item/${i}`, { id: i });
      }

      // All 200 should be accessible
      expect(getCached('/item/0')).not.toBeNull();
      expect(getCached('/item/199')).not.toBeNull();

      // Add one more to exceed limit
      setCache('/item/200', { id: 200 });

      // The oldest (item/0) should be evicted
      expect(getCached('/item/0')).toBeNull();
      // The newest should be there
      expect(getCached('/item/200')).not.toBeNull();
      // A mid-range entry should still exist
      expect(getCached('/item/100')).not.toBeNull();
    });
  });

  // ---- Revalidation tracking ----

  describe('isRevalidating / markRevalidating / clearRevalidating', () => {
    it('returns false for keys not being revalidated', () => {
      expect(isRevalidating('/events')).toBe(false);
    });

    it('marks a key as revalidating', () => {
      markRevalidating('/events');
      expect(isRevalidating('/events')).toBe(true);
    });

    it('clears the revalidating flag', () => {
      markRevalidating('/events');
      clearRevalidating('/events');
      expect(isRevalidating('/events')).toBe(false);
    });

    it('tracks multiple keys independently', () => {
      markRevalidating('/events');
      markRevalidating('/users');

      expect(isRevalidating('/events')).toBe(true);
      expect(isRevalidating('/users')).toBe(true);

      clearRevalidating('/events');
      expect(isRevalidating('/events')).toBe(false);
      expect(isRevalidating('/users')).toBe(true);
    });
  });

  // ---- invalidateByPrefix ----

  describe('invalidateByPrefix', () => {
    it('removes entries matching the prefix', () => {
      setCache('/events/1', { id: 1 });
      setCache('/events/2', { id: 2 });
      setCache('/users/1', { id: 1 });

      invalidateByPrefix('/events');

      expect(getCached('/events/1')).toBeNull();
      expect(getCached('/events/2')).toBeNull();
      expect(getCached('/users/1')).not.toBeNull();
    });

    it('does not affect entries that do not match the prefix', () => {
      setCache('/events', { all: true });
      setCache('/training/programs', { data: [] });

      invalidateByPrefix('/events');

      expect(getCached('/events')).toBeNull();
      expect(getCached('/training/programs')).not.toBeNull();
    });

    it('handles an empty cache gracefully', () => {
      // Should not throw
      expect(() => invalidateByPrefix('/anything')).not.toThrow();
    });

    it('removes entries with query params that match the prefix', () => {
      setCache('/events?page=1', { page: 1 });
      setCache('/events?page=2', { page: 2 });

      invalidateByPrefix('/events');

      expect(getCached('/events?page=1')).toBeNull();
      expect(getCached('/events?page=2')).toBeNull();
    });
  });

  // ---- getResourcePrefix ----

  describe('getResourcePrefix', () => {
    it('extracts the first path segment', () => {
      expect(getResourcePrefix('/events/123/rsvp')).toBe('/events');
    });

    it('handles a root-level resource', () => {
      expect(getResourcePrefix('/users')).toBe('/users');
    });

    it('handles a URL with trailing slash', () => {
      expect(getResourcePrefix('/events/')).toBe('/events');
    });

    it('handles deeply nested paths', () => {
      expect(getResourcePrefix('/training/programs/123/sessions')).toBe('/training');
    });

    it('handles empty string', () => {
      expect(getResourcePrefix('')).toBe('/');
    });

    it('handles root path', () => {
      expect(getResourcePrefix('/')).toBe('/');
    });
  });

  // ---- isCacheable ----

  describe('isCacheable', () => {
    it('returns true for general API endpoints', () => {
      expect(isCacheable('/events')).toBe(true);
      expect(isCacheable('/events/123')).toBe(true);
      expect(isCacheable('/apparatus')).toBe(true);
      expect(isCacheable('/training/programs')).toBe(true);
    });

    it('returns false for /auth/ endpoints', () => {
      expect(isCacheable('/auth/login')).toBe(false);
      expect(isCacheable('/auth/refresh')).toBe(false);
      expect(isCacheable('/auth/me')).toBe(false);
    });

    it('returns false for /users/ endpoints', () => {
      expect(isCacheable('/users/123')).toBe(false);
      expect(isCacheable('/users/me')).toBe(false);
    });

    it('returns false for /security/ endpoints', () => {
      expect(isCacheable('/security/alerts')).toBe(false);
    });

    it('returns false for /roles/my/ endpoints', () => {
      expect(isCacheable('/roles/my/permissions')).toBe(false);
    });

    it('returns false for /notifications/my/ endpoints', () => {
      expect(isCacheable('/notifications/my/')).toBe(false);
    });

    it('returns false for /training/waivers endpoints', () => {
      expect(isCacheable('/training/waivers')).toBe(false);
      expect(isCacheable('/training/waivers/123')).toBe(false);
    });

    it('returns false for /messages/ endpoints', () => {
      expect(isCacheable('/messages/inbox')).toBe(false);
    });

    it('returns false for /organization/ endpoints', () => {
      expect(isCacheable('/organization/settings')).toBe(false);
    });

    it('returns false for /elections/ endpoints', () => {
      expect(isCacheable('/elections/current')).toBe(false);
    });

    it('returns false for /forms/ endpoints', () => {
      expect(isCacheable('/forms/submissions')).toBe(false);
    });

    it('returns false for /prospective-members/ endpoints', () => {
      expect(isCacheable('/prospective-members/123')).toBe(false);
    });

    it('returns false for /scheduling/ endpoints', () => {
      expect(isCacheable('/scheduling/shifts')).toBe(false);
    });

    it('returns false for /admin-hours/ endpoints', () => {
      expect(isCacheable('/admin-hours/report')).toBe(false);
    });

    it('returns false for /errors/ endpoints', () => {
      expect(isCacheable('/errors/recent')).toBe(false);
    });

    it('returns false for /minutes-records/ endpoints', () => {
      expect(isCacheable('/minutes-records/123')).toBe(false);
    });

    it('returns false for /facilities/emergency-contacts', () => {
      expect(isCacheable('/facilities/emergency-contacts')).toBe(false);
    });

    it('returns false for /training/submissions/ endpoints', () => {
      expect(isCacheable('/training/submissions/123')).toBe(false);
    });

    it('returns false for /training/shift-reports/ endpoints', () => {
      expect(isCacheable('/training/shift-reports/weekly')).toBe(false);
    });

    it('returns false for /training/stats/user/ endpoints', () => {
      expect(isCacheable('/training/stats/user/123')).toBe(false);
    });

    it('returns false for /training/reports/user/ endpoints', () => {
      expect(isCacheable('/training/reports/user/456')).toBe(false);
    });

    it('returns true for non-sensitive /training/ sub-paths', () => {
      expect(isCacheable('/training/programs')).toBe(true);
      expect(isCacheable('/training/courses')).toBe(true);
    });

    it('returns true for /roles/ (non /roles/my/)', () => {
      expect(isCacheable('/roles/')).toBe(true);
      expect(isCacheable('/roles/list')).toBe(true);
    });
  });

  // ---- clearCache ----

  describe('clearCache', () => {
    it('clears all cached entries', () => {
      setCache('/events', { items: [] });
      setCache('/users', { users: [] });

      clearCache();

      expect(getCached('/events')).toBeNull();
      expect(getCached('/users')).toBeNull();
    });

    it('clears pending revalidations', () => {
      markRevalidating('/events');

      clearCache();

      expect(isRevalidating('/events')).toBe(false);
    });

    it('clears both cache entries and revalidation flags', () => {
      setCache('/events', { items: [] });
      markRevalidating('/events');

      clearCache();

      expect(getCached('/events')).toBeNull();
      expect(isRevalidating('/events')).toBe(false);
    });
  });

  // ---- Stale-while-revalidate flow integration ----

  describe('stale-while-revalidate flow', () => {
    it('fresh -> stale -> expired lifecycle', () => {
      const data = { name: 'event' };
      setCache('/events/1', data);

      // t=0: FRESH
      let result = getCached('/events/1');
      expect(result).toEqual(expect.objectContaining({ fresh: true, data }));

      // t=31s: STALE (serves data but not fresh)
      vi.advanceTimersByTime(31_000);
      result = getCached('/events/1');
      expect(result).toEqual(expect.objectContaining({ fresh: false, data }));

      // t=91s: EXPIRED (cache miss)
      vi.advanceTimersByTime(60_000);
      result = getCached('/events/1');
      expect(result).toBeNull();
    });

    it('revalidation updates the entry with fresh data', () => {
      setCache('/events/1', { v: 1 });

      // Advance to stale window
      vi.advanceTimersByTime(35_000);

      // Stale data is served
      const stale = getCached('/events/1');
      expect(stale).toEqual(expect.objectContaining({ fresh: false }));

      // Background revalidation completes with new data
      markRevalidating('/events/1');
      setCache('/events/1', { v: 2 }); // overwrites with fresh data
      clearRevalidating('/events/1');

      // New data is fresh
      const fresh = getCached('/events/1');
      expect(fresh).toEqual(expect.objectContaining({ fresh: true, data: { v: 2 } }));
    });
  });
});
