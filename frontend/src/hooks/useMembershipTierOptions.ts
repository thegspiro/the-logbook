import { useEffect, useState } from 'react';
import { memberStatusService } from '../services/api';
import type { MembershipTierName } from '../types/user';

/**
 * The department's membership ladder — ids and names — for a control that
 * offers tier ids as statuses or labels a stored one.
 *
 * Read from `GET /users/membership-tiers/names`, which every signed-in member
 * may call (owner decision 2026-11-01), so a member's directory filter and a
 * colleague's profile use the department's own names ("Senior Member") rather
 * than the built-in labels, and the officers' screens read the same names.
 * The tier editor, which needs the advancement rules and benefits, keeps the
 * `members.manage` config endpoint (`useTierEditor`).
 *
 * A failed request gives an empty ladder rather than an error: every screen
 * that uses this still works from the built-in statuses, and a dropdown's
 * option list is not something to toast about.
 */
export function useMembershipTierOptions(): { tiers: MembershipTierName[]; loaded: boolean } {
  const [tiers, setTiers] = useState<MembershipTierName[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    memberStatusService
      .getTierNames()
      .then((names) => {
        if (!cancelled) setTiers(Array.isArray(names) ? names : []);
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
  }, []);

  return { tiers, loaded };
}
