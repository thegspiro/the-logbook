/**
 * Members who can be made an event's organizer or alternate.
 *
 * Active and probationary members, the same set the API accepts
 * (`eligible_member_clause` in event_organizer_service.py): a probationary
 * member running a drill is ordinary, one on leave or retired is not someone
 * to route attendance requests to. Read from `GET /users`, which the baseline
 * member position may call, so the organizer and alternate can hand an event
 * over without holding events.manage.
 */

import { useEffect, useState } from 'react';
import { userService } from '../services/api';
import { UserStatus } from '../constants/enums';
import { getErrorMessage } from '../utils/errorHandling';
import type { User } from '../types/user';
import { displayNameOf, givenName } from '../utils/memberName';

export interface OrganizerOption {
  id: string;
  name: string;
}

const ELIGIBLE: readonly string[] = [UserStatus.ACTIVE, UserStatus.PROBATIONARY];

export function toOrganizerOptions(users: readonly User[]): OrganizerOption[] {
  return users
    .filter((u) => ELIGIBLE.includes(u.status))
    .map((u) => ({
      id: u.id,
      name: displayNameOf(u) || u.username,
      sortKey: `${u.last_name ?? ''} ${givenName(u)} ${u.username}`.toLowerCase(),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ id, name }) => ({ id, name }));
}

export interface OrganizerOptionsResult {
  options: OrganizerOption[];
  loading: boolean;
  error: string | null;
}

/** Loads the options when `enabled` first becomes true. */
export function useOrganizerOptions(enabled: boolean = true): OrganizerOptionsResult {
  const [options, setOptions] = useState<OrganizerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    userService
      .getUsers()
      .then((users) => {
        if (!cancelled) setOptions(toOrganizerOptions(users));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load members.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { options, loading, error };
}
