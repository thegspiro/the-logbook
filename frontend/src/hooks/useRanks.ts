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
      const data = await ranksService.getRanks(activeOnly ? { is_active: true } : undefined);
      setCachedRanks(cacheKey, data);
      if (currentKeyRef.current === cacheKeyString) {
        setRankState({ key: cacheKeyString, ranks: data });
      }
    } catch {
      // Fall back to empty; dropdowns will have no options until retry
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

  return { ranks, rankOptions, loading, refetch, formatRank };
}
