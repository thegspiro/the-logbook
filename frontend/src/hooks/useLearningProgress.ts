import { useEffect } from 'react';

import { useAuthStore } from '../stores/authStore';
import { useLearningProgressStore } from '../stores/learningProgressStore';
import { learningPaths, stepKey, type LearningPath } from '../pages/learning/learningPaths';
import { useEnabledModules } from './useEnabledModules';

/**
 * Stable empty map. A fresh object literal per render would change identity and
 * re-run every effect keyed on `completed`.
 */
const NO_PROGRESS: Record<string, boolean> = Object.freeze({});

export interface LearningProgress {
  /** Paths the organization has the modules for. */
  visiblePaths: LearningPath[];
  /** True until the enabled-module lookup settles, either way. */
  modulesLoading: boolean;
  completed: Record<string, boolean>;
  /** Completed steps among `visiblePaths` only. */
  completedCount: number;
  totalCount: number;
  /** 0–100, and 0 rather than NaN when there is nothing to count. */
  percent: number;
  isStepComplete: (pathId: string, stepId: string) => boolean;
  setStepComplete: (pathId: string, stepId: string, done: boolean) => void;
  /** True once the member has waved off the dashboard orientation prompt. */
  promptDismissed: boolean;
  dismissPrompt: () => void;
  reset: () => void;
}

/**
 * Binds stored learning progress to the signed-in member and the org's enabled
 * modules, so the Learning Center, a path page, and the dashboard prompt all
 * count the same steps and update together.
 */
export function useLearningProgress(): LearningProgress {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const storeUserId = useLearningProgressStore((state) => state.userId);
  const storedCompleted = useLearningProgressStore((state) => state.completed);
  const loadFor = useLearningProgressStore((state) => state.loadFor);
  const setStepComplete = useLearningProgressStore((state) => state.setStepComplete);
  const storedDismissed = useLearningProgressStore((state) => state.promptDismissed);
  const dismissPrompt = useLearningProgressStore((state) => state.dismissPrompt);
  const reset = useLearningProgressStore((state) => state.reset);

  useEffect(() => {
    loadFor(userId);
  }, [userId, loadFor]);

  // The store is a singleton and `loadFor` runs in a passive effect, so between
  // one member signing in and that effect firing, the store still holds the
  // previous member's data. Painting it even once on a shared station browser
  // is the leak the per-member keying exists to prevent — and a stale
  // `promptDismissed` would also hide the orientation prompt from someone who
  // never dismissed it. A mismatch therefore reads as "nothing loaded yet".
  const isCurrentMember = storeUserId === userId;
  const completed = isCurrentMember ? storedCompleted : NO_PROGRESS;
  const promptDismissed = isCurrentMember ? storedDismissed : false;

  const visiblePaths = learningPaths.filter((path) => !path.module || isModuleOn(path.module));

  // Only steps the member can actually reach count toward the total. A step
  // behind a disabled module is not work they are failing to do.
  const visibleKeys = new Set(visiblePaths.flatMap((path) => path.steps.map((step) => stepKey(path.id, step.id))));
  const completedCount = Object.entries(completed).filter(([key, done]) => done && visibleKeys.has(key)).length;
  const totalCount = visibleKeys.size;

  return {
    visiblePaths,
    modulesLoading,
    completed,
    completedCount,
    totalCount,
    percent: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    isStepComplete: (pathId, stepId) => Boolean(completed[stepKey(pathId, stepId)]),
    setStepComplete,
    promptDismissed,
    dismissPrompt,
    reset,
  };
}
