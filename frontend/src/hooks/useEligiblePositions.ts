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
  isExcluded: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEligiblePositions(shiftId?: string): UseEligiblePositionsResult {
  const [positions, setPositions] = useState<string[]>([]);
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
        setIsExcluded(data.is_excluded);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Failed to load eligible positions';
        setError(message);
        setPositions([]);
      })
      .finally(() => setLoading(false));
  }, [shiftId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { positions, isExcluded, loading, error, refetch: fetch };
}
