import type { OperationalRankResponse } from '../services/api';

export interface RanksCacheKey {
  activeOnly: boolean;
  organizationId: string | null;
}

const ranksCache = new Map<string, OperationalRankResponse[]>();

function serializeKey(key: RanksCacheKey): string {
  return JSON.stringify([key.organizationId, key.activeOnly]);
}

export function getCachedRanks(key: RanksCacheKey): OperationalRankResponse[] | null {
  return ranksCache.get(serializeKey(key)) ?? null;
}

export function setCachedRanks(key: RanksCacheKey, ranks: OperationalRankResponse[]): void {
  ranksCache.set(serializeKey(key), ranks);
}

/** Invalidate one query, or every ranks query when no key is supplied. */
export function invalidateRanksCache(key?: RanksCacheKey): void {
  if (key) {
    ranksCache.delete(serializeKey(key));
  } else {
    ranksCache.clear();
  }
}
