import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLearningProgressStore } from '../../stores/learningProgressStore';
import LearningPathPage from './LearningPathPage';

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: () => true, enabledModules: null, isLoading: false }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: { id: 'member-a' } };
    return selector ? selector(state) : state;
  },
}));

const renderPath = (pathId: string) =>
  render(
    <MemoryRouter initialEntries={[`/learning/${pathId}`]}>
      <Routes>
        <Route path="/learning/:pathId" element={<LearningPathPage />} />
        <Route path="/learning" element={<h1>Learning Center</h1>} />
      </Routes>
    </MemoryRouter>
  );

describe('LearningPathPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useLearningProgressStore.setState({ userId: null, completed: {}, promptDismissed: false });
  });

  it('teaches the step in the app rather than linking away for it', () => {
    renderPath('getting-started');

    expect(screen.getByRole('heading', { level: 1, name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Read your dashboard top to bottom' })).toBeInTheDocument();

    // The three things a reference manual leaves out: why it matters, the
    // concrete moves, and what finished looks like.
    expect(screen.getByText(/what do I need to do next/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'How to do it' })).toHaveLength(4);
    expect(screen.getByText(/You can name your next commitment/)).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: /Open the screen for: Read your dashboard top to bottom/ })
    ).toHaveAttribute('href', '/dashboard');
  });

  it('keeps the full reference reachable but secondary', () => {
    renderPath('training');

    const reference = screen.getByRole('link', { name: /Read the full reference guide/ });
    expect(reference).toHaveAttribute(
      'href',
      'https://github.com/thegspiro/the-logbook/blob/main/docs/training/02-training.md#my-training-dashboard'
    );
    expect(reference).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('records completion against the signed-in member', async () => {
    const user = userEvent.setup();
    renderPath('getting-started');

    expect(screen.getByText('0 of 4 complete')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Mark complete: Read your dashboard top to bottom' }));

    expect(screen.getByText('1 of 4 complete')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('logbook.learning-progress.v2.member-a') ?? '{}')).toEqual({
      'getting-started.dashboard': true,
    });
  });

  it('redirects an unknown lesson id back to the index', () => {
    renderPath('not-a-lesson');

    expect(screen.getByRole('heading', { name: 'Learning Center' })).toBeInTheDocument();
  });
});
