/**
 * Shift Report Draft Auto-Save
 *
 * Persists in-progress shift report form data to localStorage so work
 * isn't lost when connectivity drops, the browser tab closes, or the
 * user navigates away. Drafts are keyed by shift ID.
 *
 * For full offline submission (queuing reports when offline and syncing
 * when back online), see shiftReportOfflineQueue.ts.
 */

const DRAFT_KEY_PREFIX = 'shift-report-draft-';
const DRAFT_INDEX_KEY = 'shift-report-draft-index';
const MAX_DRAFTS = 20;

export interface ShiftReportDraft {
  shiftId: string;
  shiftLabel: string;
  formData: Record<string, unknown>;
  crewSelections: string[];
  traineeEvals: Record<string, unknown>;
  crewRemarks: Record<string, string>;
  savedAt: number;
}

function getDraftKey(shiftId: string): string {
  return `${DRAFT_KEY_PREFIX}${shiftId}`;
}

export function saveDraft(draft: ShiftReportDraft): void {
  try {
    localStorage.setItem(getDraftKey(draft.shiftId), JSON.stringify(draft));

    const index: string[] = JSON.parse(
      localStorage.getItem(DRAFT_INDEX_KEY) || '[]',
    ) as string[];
    if (!index.includes(draft.shiftId)) {
      index.push(draft.shiftId);
    }

    while (index.length > MAX_DRAFTS) {
      const oldest = index.shift();
      if (oldest) localStorage.removeItem(getDraftKey(oldest));
    }

    localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(index));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export function loadDraft(shiftId: string): ShiftReportDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(shiftId));
    if (!raw) return null;
    return JSON.parse(raw) as ShiftReportDraft;
  } catch {
    return null;
  }
}

export function deleteDraft(shiftId: string): void {
  try {
    localStorage.removeItem(getDraftKey(shiftId));
    const index: string[] = JSON.parse(
      localStorage.getItem(DRAFT_INDEX_KEY) || '[]',
    ) as string[];
    const filtered = index.filter(id => id !== shiftId);
    localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(filtered));
  } catch {
    // silent fail
  }
}

/**
 * Remove every saved draft on this device.
 *
 * SEC (FE-6): drafts hold member PII — crew names, trainee evaluations,
 * narrative remarks — in localStorage, which is shared by every user of the
 * browser profile. Station computers are shared by whoever is on duty, so
 * drafts must not outlive the session that created them. Called from the
 * logout purge; returns how many were discarded so the UI can say so rather
 * than destroying work silently.
 */
export function clearAllDrafts(): number {
  try {
    const index: string[] = JSON.parse(
      localStorage.getItem(DRAFT_INDEX_KEY) || '[]',
    ) as string[];
    index.forEach(shiftId => localStorage.removeItem(getDraftKey(shiftId)));
    localStorage.removeItem(DRAFT_INDEX_KEY);

    // Belt and braces: the index can drift from reality if a write failed
    // part-way, so sweep any orphaned draft keys too.
    let orphans = 0;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_KEY_PREFIX)) {
        localStorage.removeItem(key);
        orphans += 1;
      }
    }
    return index.length + orphans;
  } catch {
    return 0;
  }
}
