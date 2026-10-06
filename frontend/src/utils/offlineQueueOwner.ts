/**
 * Who an offline queue entry belongs to (FE3-34-5).
 *
 * The offline queues live in IndexedDB, which is scoped to the browser
 * profile, not to the member signed in to it. Sign-in purges whatever the
 * previous member left (`claimDeviceForMember` → `purgeLocalMemberData`), but
 * that purge must never throw — a member stuck unable to sign in on a shared
 * station is worse than a failed cleanup — so when IndexedDB is blocked or
 * slow it silently does nothing. Without an owner on each entry, the queue
 * then drains the previous member's submissions under the new member's
 * cookies, and nothing could tell the two apart.
 *
 * So every entry is stamped with the member who queued it, and a drain sends
 * only the signed-in member's own. An entry with no owner was queued before
 * this field existed; whose it is cannot be known, so it is held for the
 * signed-in member to review (`offlineQueueQuarantine.ts`) rather than sent.
 */

import { useAuthStore } from '../stores/authStore';

/** Thrown when something tries to queue work with nobody signed in. */
export class OfflineQueueOwnerError extends Error {
  constructor() {
    super('You are signed out. Sign in again before saving this for later.');
    this.name = 'OfflineQueueOwnerError';
  }
}

/** The signed-in member's id, or null when nobody is signed in. */
export function currentQueueOwner(): string | null {
  const { isAuthenticated, user } = useAuthStore.getState();
  return isAuthenticated && user?.id ? user.id : null;
}

/**
 * The owner to stamp on a new entry.
 *
 * Refuses rather than writing an unowned entry. Nobody is signed in only after
 * logout or session expiry, when the purge has already run and a still-mounted
 * form is finishing a submission — exactly the write the purge is meant to
 * have prevented. An unowned entry would be held for whoever signs in next,
 * inviting them to send someone else's work as their own; failing the save
 * leaves the form's own draft as the copy to recover from.
 */
export function requireQueueOwner(): string {
  const owner = currentQueueOwner();
  if (!owner) throw new OfflineQueueOwnerError();
  return owner;
}

export interface OwnedQueueEntry {
  /**
   * The member who queued the entry. Absent only on entries written before
   * FE3-34-5, which are never sent automatically.
   */
  ownerId?: string | undefined;
}

/** Whether `entry` may be sent with the signed-in member's session. */
export function isOwnedByCurrentMember(entry: OwnedQueueEntry, owner: string | null = currentQueueOwner()): boolean {
  return owner !== null && entry.ownerId === owner;
}

/** An entry written before owners were recorded, held for review. */
export function isUntagged(entry: OwnedQueueEntry): boolean {
  return !entry.ownerId;
}
