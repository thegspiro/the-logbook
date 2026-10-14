import { useEffect, useState } from 'react';
import { advanceService } from '../services/api';
import type { AdvanceSummary } from '../types';

/**
 * The signed-in member's own issued cash advances that still have something
 * left to account for. Advice for the request forms only: the server decides
 * what a report may settle and whether an advance is overdue, so a failed
 * read just means nothing is offered.
 */
export function useMyOpenAdvances(enabled = true): AdvanceSummary[] {
  const [advances, setAdvances] = useState<AdvanceSummary[]>([]);

  useEffect(() => {
    if (!enabled) {
      setAdvances([]);
      return undefined;
    }
    let current = true;
    advanceService
      .list({ mine: true, outstandingOnly: true })
      .then((mine) => {
        if (current) setAdvances(mine);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled]);

  return advances;
}
