import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ranksService } from '../services/api';
import type { OperationalRankResponse } from '../services/api';
import { getCachedRanks, setCachedRanks, invalidateRanksCache } from './ranksCache';
import type { RanksCacheKey } from './ranksCache';
import { useAuthStore } from '../stores/authStore';

export { invalidateRanksCache } from './ranksCache';

/**
 * Hook that fetches operational ranks from the API and caches them.
 * Returns { ranks, loading, refetch }.
 *
 * The `ranks` array is sorted by sort_order (highest rank first).
 * Only active ranks are returned by default.
 */
export function useRanks(activeOnly = true) {
  const organizationId = useAuthStore((state) => state.user?.organization_id ?? null);
  const cacheKey = useMemo<RanksCacheKey>(() => ({ activeOnly, organizationId }), [activeOnly, organizationId]);
  const cacheKeyString = JSON.stringify([organizationId, activeOnly]);
  const currentKeyRef = useRef(cacheKeyString);
  currentKeyRef.current = cacheKeyString;

  const initialCachedRanks = getCachedRanks(cacheKey);
  const [rankState, setRankState] = useState<{ key: string; ranks: OperationalRankResponse[] }>(() => ({
    key: cacheKeyString,
    ranks: initialCachedRanks ?? [],
  }));
  const [loadingState, setLoadingState] = useState({ key: cacheKeyString, loading: initialCachedRanks === null });
  const [failed, setFailed] = useState(false);

  // Never expose results belonging to the previous filter or organization,
  // even during the render before the key-change effect runs.
  const ranks = useMemo(
    () => (rankState.key === cacheKeyString ? rankState.ranks : (getCachedRanks(cacheKey) ?? [])),
    [cacheKey, cacheKeyString, rankState]
  );
  const loading = loadingState.key === cacheKeyString ? loadingState.loading : getCachedRanks(cacheKey) === null;

  const fetchRanks = useCallback(async () => {
    try {
      setLoadingState({ key: cacheKeyString, loading: true });
      // `getRankLadder`, not `getRanks`. The latter funnels the body through
      // `asArray`, which turns a captive portal's or proxy's HTTP 200 HTML page
      // into `[]` — so the catch below never runs, `failed` stays false, and
      // the caller is handed an empty list that looks like a department with no
      // ranks. `ranksService.test.ts` names that shape exactly: a guard above
      // `asArray` never fires.
      //
      // Nothing a consumer *renders* changes. The reason `getRanks` is lenient
      // — a dropdown showing nothing beats a page dying through the
      // ErrorBoundary — is satisfied by this catch rather than by the
      // normalization, and `ranks` is still `[]` afterwards. What changes is
      // that the failure is now knowable, and that a garbage body is no longer
      // written into the shared cache as a legitimate empty ladder for every
      // later consumer to read.
      const data = await ranksService.getRankLadder(activeOnly ? { is_active: true } : undefined);
      setCachedRanks(cacheKey, data);
      if (currentKeyRef.current === cacheKeyString) {
        setRankState({ key: cacheKeyString, ranks: data });
      }
      if (currentKeyRef.current === cacheKeyString) setFailed(false);
    } catch {
      // Reported, not only swallowed. Falling back to an empty list renders a
      // dropdown that looks like a department with no ranks rather than a read
      // that did not answer — and on the onboarding IT step that reads as a
      // valid "No rank" choice, so every contact is created without the rank
      // the administrator picked. Consumers that do not care may ignore this.
      if (currentKeyRef.current === cacheKeyString) setFailed(true);
    } finally {
      if (currentKeyRef.current === cacheKeyString) {
        setLoadingState({ key: cacheKeyString, loading: false });
      }
    }
  }, [activeOnly, cacheKey, cacheKeyString]);

  useEffect(() => {
    const cachedRanks = getCachedRanks(cacheKey);
    if (cachedRanks !== null) {
      setRankState({ key: cacheKeyString, ranks: cachedRanks });
      setLoadingState({ key: cacheKeyString, loading: false });
      return;
    }
    setRankState({ key: cacheKeyString, ranks: [] });
    void fetchRanks();
  }, [cacheKey, cacheKeyString, fetchRanks]);

  const refetch = useCallback(async () => {
    invalidateRanksCache(cacheKey);
    await fetchRanks();
  }, [cacheKey, fetchRanks]);

  const rankOptions = ranks.map((r: OperationalRankResponse) => ({ value: r.rank_code, label: r.display_name }));

  const formatRank = useCallback(
    (code: string | null | undefined): string => {
      if (!code) return '';
      const found = ranks.find((r: OperationalRankResponse) => r.rank_code === code);
      if (found) return found.display_name;
      return code.replace(/_/g, ' ');
    },
    [ranks]
  );

  return { ranks, rankOptions, loading, failed, refetch, formatRank };
}
