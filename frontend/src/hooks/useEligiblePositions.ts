/**
 * Hook to fetch the current user's eligible shift positions.
 *
 * Optionally accepts a shift ID to scope eligibility to that shift's
 * defined positions and account for its open_to_all_members flag.
 */

import { useCallback, useEffect, useState } from 'react';

import { schedulingService } from '../modules/scheduling/services/api';

interface UseEligiblePositionsResult {
  positions: string[];
  /**
   * The subset of `positions` with a seat still free on this shift — what a
   * picker should offer, since the seat cap refuses the rest. Falls back to
   * `positions` when the shift was not named or a backend predating the field
   * answered, so an older server behaves exactly as it did before.
   */
  openPositions: string[];
  isExcluded: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEligiblePositions(shiftId?: string): UseEligiblePositionsResult {
  const [positions, setPositions] = useState<string[]>([]);
  const [openPositions, setOpenPositions] = useState<string[]>([]);
  const [isExcluded, setIsExcluded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    setError(null);
    schedulingService
      .getEligiblePositions(shiftId)
      .then((data) => {
        setPositions(data.positions);
        setOpenPositions(data.open_positions ?? data.positions);
        setIsExcluded(data.is_excluded);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load eligible positions';
        setError(message);
        setPositions([]);
        setOpenPositions([]);
      })
      .finally(() => setLoading(false));
  }, [shiftId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { positions, openPositions, isExcluded, loading, error, refetch: fetch };
}
