/**
 * Saved Training Program Wizard Draft
 *
 * The create-pipeline wizard builds a whole program — phases, requirements,
 * milestones — before anything reaches the server, because the build endpoint
 * persists it in one transaction. Without a draft, a reload, a closed tab or a
 * wander to another screen threw away everything entered so far. The draft is
 * kept in this browser, one per member (owner decision 2026-11-08: browser
 * storage rather than a server-side draft program).
 *
 * The stored value is opaque here: the wizard owns its form shape and
 * validates what it reads back, since a draft written by an older build may be
 * missing fields the current one expects. A draft is cleared when its program
 * is created, when the member starts over, and at sign-out (see
 * purgeLocalMemberData), because station computers are shared.
 */

const DRAFT_KEY_PREFIX = 'program-wizard-draft-';

/**
 * Bumped when the wizard's form shape changes in a way restoring cannot
 * reconcile. A draft carrying another version is discarded, not restored.
 */
export const PROGRAM_WIZARD_DRAFT_VERSION = 1;

export interface StoredProgramWizardDraft {
  /** `Date.now()` when the draft was written. */
  savedAt: number;
  /** The wizard's form state, unvalidated. */
  data: unknown;
}

const keyFor = (memberId: string): string => `${DRAFT_KEY_PREFIX}${memberId}`;

/** Keep `data` as this member's draft. Returns false if the browser refused it. */
export function saveProgramWizardDraft(memberId: string, data: unknown, now: number = Date.now()): boolean {
  try {
    localStorage.setItem(
      keyFor(memberId),
      JSON.stringify({ version: PROGRAM_WIZARD_DRAFT_VERSION, savedAt: now, data })
    );
    return true;
  } catch {
    // Storage full, blocked or unavailable. The caller tells the member, since
    // they would otherwise believe the draft was kept.
    return false;
  }
}

/** This member's draft, or null when there is none or it cannot be read. */
export function loadProgramWizardDraft(memberId: string): StoredProgramWizardDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(memberId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== PROGRAM_WIZARD_DRAFT_VERSION || typeof record.savedAt !== 'number') {
      return null;
    }
    return { savedAt: record.savedAt, data: record.data };
  } catch {
    return null;
  }
}

/** Remove this member's draft. */
export function clearProgramWizardDraft(memberId: string): void {
  try {
    localStorage.removeItem(keyFor(memberId));
  } catch {
    // Storage unavailable: there is nothing it could be holding either.
  }
}

/** Remove every member's draft from this browser. Returns how many were removed. */
export function clearAllProgramWizardDrafts(): number {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    return keys.length;
  } catch {
    return 0;
  }
}
