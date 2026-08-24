import { useEffect } from 'react';

import { useAuthStore } from '../stores/authStore';
import { useLearningProgressStore } from '../stores/learningProgressStore';
import { learningPaths, stepKey, type LearningPath } from '../pages/learning/learningPaths';
import { useEnabledModules } from './useEnabledModules';

export interface LearningProgress {
  /** Paths the organization has the modules for. */
  visiblePaths: LearningPath[];
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
  const { isModuleOn } = useEnabledModules();
  const completed = useLearningProgressStore((state) => state.completed);
  const loadFor = useLearningProgressStore((state) => state.loadFor);
  const setStepComplete = useLearningProgressStore((state) => state.setStepComplete);
  const promptDismissed = useLearningProgressStore((state) => state.promptDismissed);
  const dismissPrompt = useLearningProgressStore((state) => state.dismissPrompt);
  const reset = useLearningProgressStore((state) => state.reset);

  useEffect(() => {
    loadFor(userId);
  }, [userId, loadFor]);

  const visiblePaths = learningPaths.filter((path) => !path.module || isModuleOn(path.module));

  // Only steps the member can actually reach count toward the total. A step
  // behind a disabled module is not work they are failing to do.
  const visibleKeys = new Set(visiblePaths.flatMap((path) => path.steps.map((step) => stepKey(path.id, step.id))));
  const completedCount = Object.entries(completed).filter(([key, done]) => done && visibleKeys.has(key)).length;
  const totalCount = visibleKeys.size;

  return {
    visiblePaths,
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
