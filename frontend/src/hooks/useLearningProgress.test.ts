import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLearningProgressStore } from '../stores/learningProgressStore';
import { useLearningProgress } from './useLearningProgress';

let currentUserId: string | null = 'member-a';

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: currentUserId ? { id: currentUserId } : null };
    return selector ? selector(state) : state;
  },
}));

vi.mock('./useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: () => true, enabledModules: null, isLoading: false }),
}));

// `setState` merges, so a test that stubs an action leaves the stub installed
// for every test after it — the same trap as a patch that outlives its test.
const realLoadFor = useLearningProgressStore.getState().loadFor;

describe('useLearningProgress', () => {
  beforeEach(() => {
    localStorage.clear();
    currentUserId = 'member-a';
    useLearningProgressStore.setState({
      userId: null,
      completed: {},
      promptDismissed: false,
      loadFor: realLoadFor,
    });
  });

  it('never paints the previous member’s progress while the load is pending', () => {
    // Member A's session, recorded and dismissed.
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);
    useLearningProgressStore.getState().dismissPrompt();

    // Member B signs in on the same tab. Freezing loadFor reproduces the frame
    // between that happening and the passive effect catching up — the window
    // where the singleton store still holds A's data.
    currentUserId = 'member-b';
    useLearningProgressStore.setState({ loadFor: () => {} });

    const { result } = renderHook(() => useLearningProgress());

    expect(result.current.completed).toEqual({});
    expect(result.current.completedCount).toBe(0);
    expect(result.current.promptDismissed).toBe(false);
  });

  it('shows the member their own progress once loaded', () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);

    const { result } = renderHook(() => useLearningProgress());

    expect(result.current.completed).toEqual({ 'getting-started.dashboard': true });
    expect(result.current.completedCount).toBe(1);
  });

  it('reports zero rather than NaN when there is nothing to count', () => {
    const { result } = renderHook(() => useLearningProgress());

    expect(result.current.percent).toBe(0);
    expect(result.current.totalCount).toBeGreaterThan(0);
  });
});
