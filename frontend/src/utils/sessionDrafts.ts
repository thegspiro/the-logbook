/**
 * Local drafts of long, member-facing forms (forms review F-6, owner decision
 * 2026-11-06: "local drafts").
 *
 * sessionStorage, not localStorage, on purpose: a draft lives as long as the
 * tab, so a member who taps away from Submit Training and comes back gets
 * their text back, while a station computer closed at the end of a shift keeps
 * nothing. Keys carry the signed-in user's id, so a draft is never restored to
 * somebody else, and the logout purge removes the whole namespace anyway.
 *
 * Never draft a form that holds PHI (medical screening, emergency contacts):
 * client-side storage is outside every HIPAA control the server applies. Each
 * adopting form leaves such fields out of the value it drafts and says so.
 *
 * Every storage call is wrapped: sessionStorage throws in some private modes
 * and when full, and a draft is a convenience that must never break the form.
 */

const PREFIX = 'logbook:draft:';

export interface StoredDraft<T> {
  savedAt: number;
  value: T;
}

export function sessionDraftKey(userId: string, form: string, recordId?: string | null): string {
  return `${PREFIX}${userId}:${form}${recordId ? `:${recordId}` : ''}`;
}

export function readSessionDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return null;
    return parsed as StoredDraft<T>;
  } catch {
    return null;
  }
}

export function writeSessionDraft<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value } satisfies StoredDraft<T>));
  } catch {
    // Full or unavailable: the form keeps working, it just is not drafted.
  }
}

export function removeSessionDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Unavailable storage holds nothing to remove.
  }
}

/** Remove every form draft in this tab; returns how many. Called by the logout purge. */
export function clearAllSessionDrafts(): number {
  let removed = 0;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) {
        sessionStorage.removeItem(key);
        removed += 1;
      }
    }
  } catch {
    // As above.
  }
  return removed;
}
