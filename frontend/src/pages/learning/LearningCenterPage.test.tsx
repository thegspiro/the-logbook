import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { useLearningProgressStore } from '../../stores/learningProgressStore';
import LearningCenterPage from './LearningCenterPage';

const isModuleOn = vi.fn((_module: string) => true);
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn, enabledModules: null, isLoading: false }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: { id: 'member-a' } };
    return selector ? selector(state) : state;
  },
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <LearningCenterPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('LearningCenterPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useLearningProgressStore.setState({ userId: null, completed: {}, promptDismissed: false });
    isModuleOn.mockImplementation(() => true);
  });

  it('lists a lesson per path with a link into it', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Put The Logbook on Your Phone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Training: Submission to Credit' })).toBeInTheDocument();
    expect(screen.getByText('0 of 19 tasks')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Start lesson: Getting Started/ })).toHaveAttribute(
      'href',
      '/learning/getting-started'
    );
  });

  it('hides lessons for modules the department has switched off', () => {
    isModuleOn.mockImplementation((module: string) => module !== 'scheduling' && module !== 'inventory');
    renderPage();

    expect(screen.queryByRole('heading', { name: 'Scheduling: Cover a Vacancy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your Issued Gear' })).not.toBeInTheDocument();
    // A step behind a disabled module is not work the member is failing to do,
    // so it leaves the denominator too.
    expect(screen.getByText('0 of 13 tasks')).toBeInTheDocument();
  });

  it('reflects stored progress and resets it once the member confirms', async () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);

    renderPage();
    expect(screen.getByText('1 of 19 tasks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Continue lesson: Getting Started/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset progress' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset progress' }));

    expect(await screen.findByText('0 of 19 tasks')).toBeInTheDocument();
    expect(localStorage.getItem('logbook.learning-progress.v2.member-a')).toBeNull();
  });

  it('keeps progress when the member backs out of the reset', async () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Reset progress' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('clears the 1 task you have completed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my progress' }));

    expect(await screen.findByText('1 of 19 tasks')).toBeInTheDocument();
    expect(localStorage.getItem('logbook.learning-progress.v2.member-a')).not.toBeNull();
  });

  it('reports the completed count to assistive technology', () => {
    renderPage();

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '0 of 19 tasks complete');
  });
});
