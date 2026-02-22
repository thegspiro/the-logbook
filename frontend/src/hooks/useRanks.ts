import { useState, useEffect, useCallback } from 'react';
import { ranksService } from '../services/api';
import type { OperationalRankResponse } from '../services/api';

let cachedRanks: OperationalRankResponse[] | null = null;

/**
 * Hook that fetches operational ranks from the API and caches them.
 * Returns { ranks, loading, refetch }.
 *
 * The `ranks` array is sorted by sort_order (highest rank first).
 * Only active ranks are returned by default.
 */
export function useRanks(activeOnly = true) {
  const [ranks, setRanks] = useState<OperationalRankResponse[]>(cachedRanks ?? []);
  const [loading, setLoading] = useState(cachedRanks === null);

  const fetchRanks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await ranksService.getRanks(activeOnly ? { is_active: true } : undefined);
      cachedRanks = data;
      setRanks(data);
    } catch {
      // Fall back to empty; dropdowns will have no options until retry
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    if (cachedRanks !== null) {
      setRanks(cachedRanks);
      setLoading(false);
      return;
    }
    fetchRanks();
  }, [fetchRanks]);

  const refetch = useCallback(async () => {
    cachedRanks = null;
    await fetchRanks();
  }, [fetchRanks]);

  const rankOptions = ranks.map((r: OperationalRankResponse) => ({ value: r.rank_code, label: r.display_name }));

  const formatRank = useCallback(
    (code: string | null | undefined): string => {
      if (!code) return '';
      const found = ranks.find((r: OperationalRankResponse) => r.rank_code === code);
      if (found) return found.display_name;
      return code.replace(/_/g, ' ');
    },
    [ranks],
  );

  return { ranks, rankOptions, loading, refetch, formatRank };
}

/** Invalidate the cached ranks so the next useRanks() call re-fetches. */
export function invalidateRanksCache() {
  cachedRanks = null;
}
