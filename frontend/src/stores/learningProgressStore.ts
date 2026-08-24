import { create } from 'zustand';

import { stepKey } from '../pages/learning/learningPaths';

const STORAGE_PREFIX = 'logbook.learning-progress.v2';

/**
 * v1 wrote a single unnamespaced key, so on a shared station browser every
 * member saw — and overwrote — the same checkmarks. v2 keys by user id.
 *
 * The v1 data is deliberately NOT migrated: there is no record of which member
 * entered it, and attributing it to whoever signs in first would re-commit the
 * exact bug the namespacing fixes. It is removed instead, because no code path
 * can read it again.
 */
const LEGACY_KEY = 'logbook.learning-progress.v1';

/** Dismissal of the dashboard prompt, namespaced for the same reason. */
const DISMISS_PREFIX = 'logbook.learning-prompt-dismissed.v1';

const storageKey = (userId: string): string => `${STORAGE_PREFIX}.${userId}`;
const dismissKey = (userId: string): string => `${DISMISS_PREFIX}.${userId}`;

function readDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(userId)) === '1';
  } catch {
    return false;
  }
}

function readProgress(userId: string): Record<string, boolean> {
  try {
    // JSON.parse returns `any`, so narrow before returning: the stored value is
    // whatever a previous version of this page wrote, or whatever a user typed
    // into localStorage. Only own boolean entries are kept, which is what the
    // return type already promised.
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const progress: Record<string, boolean> = {};
    for (const [key, flag] of Object.entries(value)) {
      if (typeof flag === 'boolean') progress[key] = flag;
    }
    return progress;
  } catch {
    return {};
  }
}

interface LearningProgressState {
  /** Whose progress `completed` currently holds; null before sign-in resolves. */
  userId: string | null;
  completed: Record<string, boolean>;
  /** Whether the member has waved off the dashboard orientation prompt. */
  promptDismissed: boolean;
  /** Point the store at a member. Re-reads storage when the member changes. */
  loadFor: (userId: string | null) => void;
  setStepComplete: (pathId: string, stepId: string, done: boolean) => void;
  dismissPrompt: () => void;
  reset: () => void;
}

export const useLearningProgressStore = create<LearningProgressState>((set, get) => ({
  userId: null,
  completed: {},
  promptDismissed: false,

  loadFor: (userId) => {
    if (userId === get().userId) return;
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage can be unavailable outright (Safari private mode, a browser set
      // to block site data). Progress is a convenience, so degrade to in-memory
      // rather than taking the page down.
    }
    set({
      userId,
      completed: userId ? readProgress(userId) : {},
      promptDismissed: userId ? readDismissed(userId) : false,
    });
  },

  setStepComplete: (pathId, stepId, done) => {
    const { userId, completed } = get();
    const next = { ...completed, [stepKey(pathId, stepId)]: done };
    set({ completed: next });
    if (!userId) return;
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
      // Quota or blocked storage; the in-memory update above still stands for
      // this session.
    }
  },

  dismissPrompt: () => {
    const { userId } = get();
    set({ promptDismissed: true });
    if (!userId) return;
    try {
      localStorage.setItem(dismissKey(userId), '1');
    } catch {
      // See setStepComplete.
    }
  },

  reset: () => {
    const { userId } = get();
    // Resetting progress un-dismisses the prompt: the member is explicitly
    // starting over, and leaving the prompt hidden would strand them with no
    // way back to it from the dashboard.
    set({ completed: {}, promptDismissed: false });
    if (!userId) return;
    try {
      localStorage.removeItem(storageKey(userId));
      localStorage.removeItem(dismissKey(userId));
    } catch {
      // See setStepComplete.
    }
  },
}));
