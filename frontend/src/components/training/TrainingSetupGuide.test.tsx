import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { TrainingDashboardSummary } from '../../services/trainingServices';
import { TrainingSetupGuide } from './TrainingSetupGuide';
import { SETUP_GUIDE_HIDDEN_KEY } from './trainingSetupSteps';

const freshStats: TrainingDashboardSummary['stats'] = {
  total_members: 20,
  tracked_members: 20,
  active_requirements: 0,
  active_courses: 0,
  training_sessions: 0,
  active_programs: 0,
  compliant_members: 20,
  compliance_percentage: 100,
  expiring_count: 0,
  completions_last_30_days: 0,
  total_hours_this_year: 0,
  average_hours_per_member: 0,
};

describe('TrainingSetupGuide', () => {
  beforeEach(() => {
    localStorage.removeItem(SETUP_GUIDE_HIDDEN_KEY);
  });

  it('walks a fresh department through every step, in order, with a link to each', () => {
    renderWithRouter(<TrainingSetupGuide stats={freshStats} />);

    expect(screen.getByRole('heading', { name: 'Set up training for your department' })).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 steps done/)).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('1. Add the courses your department teaches or accepts');
    expect(items[3]).toHaveTextContent('(optional)');
    expect(screen.getByRole('link', { name: /Open the Course Library/ })).toHaveAttribute(
      'href',
      '/training/admin?page=setup&tab=courses'
    );
    expect(screen.getByRole('link', { name: /Open Requirements/ })).toHaveAttribute(
      'href',
      '/training/admin?page=setup&tab=requirements'
    );
    expect(screen.getByRole('link', { name: /Create a session/ })).toHaveAttribute(
      'href',
      '/training/admin?page=records&tab=sessions'
    );
  });

  it('ticks off a finished step and drops its link', () => {
    renderWithRouter(<TrainingSetupGuide stats={{ ...freshStats, active_courses: 3 }} />);

    expect(screen.getByText(/1 of 3 steps done/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open the Course Library/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/— done/)).toHaveLength(1);
  });

  it('disappears once the required steps are done, even without a program', () => {
    const { container } = renderWithRouter(
      <TrainingSetupGuide
        stats={{ ...freshStats, active_courses: 2, active_requirements: 1, training_sessions: 1, active_programs: 0 }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden after the officer dismisses it', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithRouter(<TrainingSetupGuide stats={freshStats} />);

    await user.click(screen.getByRole('button', { name: 'Hide the setup guide' }));
    expect(screen.queryByRole('heading', { name: 'Set up training for your department' })).not.toBeInTheDocument();
    unmount();

    renderWithRouter(<TrainingSetupGuide stats={freshStats} />);
    expect(screen.queryByRole('heading', { name: 'Set up training for your department' })).not.toBeInTheDocument();
  });
});
