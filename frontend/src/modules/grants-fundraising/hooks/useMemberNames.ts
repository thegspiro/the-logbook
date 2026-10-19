/**
 * Names for the member ids grant records store (`assigned_to`).
 *
 * W68: the applications list printed `assignedTo` as given — once the form
 * stored a member's id, that was a UUID. The directory needs members.view or
 * users.view, which fundraising.manage does not imply, so a refusal leaves the
 * map empty and callers fall back to a neutral label rather than the id.
 */

import { useEffect, useState } from 'react';
import { memberDirectoryService } from '@/services/memberDirectoryService';
import type { MemberDirectoryEntry } from '@/services/memberDirectoryService';

export const memberLabel = (m: MemberDirectoryEntry): string =>
  m.display_name || m.full_name || `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'Unnamed member';

export interface MemberNames {
  /** Directory entries, or null while loading / when the directory is refused. */
  members: MemberDirectoryEntry[] | null;
  /** The member's name, or `fallback` for an id the directory does not list. */
  nameOf: (id: string | null | undefined, fallback?: string) => string;
}

export const useMemberNames = (): MemberNames => {
  const [members, setMembers] = useState<MemberDirectoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    memberDirectoryService
      .getDirectory()
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = (id: string | null | undefined, fallback = 'Assigned member'): string => {
    if (!id) return '--';
    const match = members?.find((m) => m.id === id);
    return match ? memberLabel(match) : fallback;
  };

  return { members, nameOf };
};
