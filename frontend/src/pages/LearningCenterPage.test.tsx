import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LearningCenterPage from './LearningCenterPage';

const isModuleOn = vi.fn(() => true);
vi.mock('../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn, enabledModules: null }),
}));

describe('LearningCenterPage', () => {
  beforeEach(() => {
    localStorage.clear();
    isModuleOn.mockImplementation(() => true);
  });

  it('hides learning paths for disabled modules', () => {
    isModuleOn.mockImplementation((module: string) => module !== 'scheduling');
    renderPage();

    expect(screen.queryByRole('heading', { name: 'Scheduling: Cover a Vacancy' })).not.toBeInTheDocument();
    expect(screen.getByText('0 of 6 tasks')).toBeInTheDocument();
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <LearningCenterPage />
      </MemoryRouter>
    );

  it('shows the three pilot learning paths and task progress', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Training: Submission to Credit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scheduling: Cover a Vacancy' })).toBeInTheDocument();
    expect(screen.getByText('0 of 9 tasks')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open task' })).toHaveLength(9);
  });

  it('persists task completion and can reset it', () => {
    const { unmount } = renderPage();
    const task = screen.getByLabelText('Review your dashboard and next scheduled item');

    fireEvent.click(task);
    expect(screen.getByText('1 of 9 tasks')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('logbook.learning-progress.v1') ?? '{}')).toEqual({
      'getting-started.dashboard': true,
    });

    unmount();
    renderPage();
    expect(screen.getByLabelText('Review your dashboard and next scheduled item')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Reset progress' }));
    expect(screen.getByText('0 of 9 tasks')).toBeInTheDocument();
    expect(localStorage.getItem('logbook.learning-progress.v1')).toBeNull();
  });
});
