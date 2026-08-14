import type { OperationalRankResponse } from '../services/api';

let cachedRanks: OperationalRankResponse[] | null = null;

export function getCachedRanks(): OperationalRankResponse[] | null {
  return cachedRanks;
}

export function setCachedRanks(ranks: OperationalRankResponse[]): void {
  cachedRanks = ranks;
}

export function invalidateRanksCache(): void {
  cachedRanks = null;
}
