import { useEffect, useState } from 'react';
import { memberStatusService } from '../services/api';
import type { MembershipTier } from '../types/user';

/**
 * The department's membership ladder, for a control that offers tier ids as
 * statuses or labels a stored one.
 *
 * The config endpoint needs `members.manage`. A caller without it gets an
 * empty ladder rather than an error: every screen that uses this still works
 * from the built-in statuses, and a 403 on a dropdown's option list is not
 * something to toast about.
 *
 * Pass `enabled: false` where the caller already knows it lacks the grant —
 * the member directory, which every member opens — so the request that can
 * only be refused is never sent. The result is the same empty ladder.
 */
export function useMembershipTierOptions(enabled = true): { tiers: MembershipTier[]; loaded: boolean } {
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setTiers([]);
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    memberStatusService
      .getTierConfig()
      .then((config) => {
        if (!cancelled) setTiers(Array.isArray(config?.tiers) ? config.tiers : []);
      })
      .catch(() => {
        if (!cancelled) setTiers([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { tiers, loaded };
}
