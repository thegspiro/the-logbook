import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { learningPaths } from '../../pages/learning/learningPaths';
import { useLearningProgressStore } from '../../stores/learningProgressStore';
import DashboardOrientation from './DashboardOrientation';

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: () => true, enabledModules: null, isLoading: false }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: { id: 'member-a' } };
    return selector ? selector(state) : state;
  },
}));

const renderPrompt = () =>
  render(
    <MemoryRouter>
      <DashboardOrientation />
    </MemoryRouter>
  );

const completeEverything = () => {
  useLearningProgressStore.getState().loadFor('member-a');
  for (const path of learningPaths) {
    for (const step of path.steps) {
      useLearningProgressStore.getState().setStepComplete(path.id, step.id, true);
    }
  }
};

describe('DashboardOrientation', () => {
  beforeEach(() => {
    localStorage.clear();
    useLearningProgressStore.setState({ userId: null, completed: {}, promptDismissed: false });
  });

  it('points a brand-new member straight at the first lesson', () => {
    renderPrompt();

    expect(screen.getByText('New here? Start with the basics')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/learning/getting-started');
  });

  it('switches to a resume prompt once orientation is under way', () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);

    renderPrompt();

    expect(screen.getByText('Orientation: 1 of 19 tasks done')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/learning');
  });

  it('disappears once every task is done', () => {
    completeEverything();

    const { container } = renderPrompt();

    expect(container).toBeEmptyDOMElement();
  });

  it('stays gone after the member waves it off', async () => {
    const user = userEvent.setup();
    const { container, unmount } = renderPrompt();

    await user.click(screen.getByRole('button', { name: 'Dismiss orientation prompt' }));
    expect(container).toBeEmptyDOMElement();

    unmount();
    expect(renderPrompt().container).toBeEmptyDOMElement();
  });
});
