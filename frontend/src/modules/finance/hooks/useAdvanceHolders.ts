import { useEffect, useState } from 'react';
import { advanceService } from '../services/api';
import type { AdvanceHolder } from '../types';

/**
 * The members the finance office can raise a cash advance for, as the server
 * decides it (`GET /finance/advances/holders`, `finance.manage`): the same set
 * creating one on a member's behalf admits. *excludeId* leaves out the
 * signed-in officer, who is offered as "Me". A failed read offers no one.
 */
export function useAdvanceHolders(enabled: boolean, excludeId?: string): AdvanceHolder[] {
  const [holders, setHolders] = useState<AdvanceHolder[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    advanceService
      .holders()
      .then((list) => {
        if (current) setHolders(list.filter((holder) => holder.id !== excludeId));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled, excludeId]);

  return holders;
}
