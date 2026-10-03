import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { SchedulingSummary } from '../../../modules/scheduling/services/api';

const mockGetSummary = vi.fn();
vi.mock('../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
  },
}));

import { SchedulingSetupGuide } from './SchedulingSetupGuide';
import { SCHEDULING_SETUP_GUIDE_HIDDEN_KEY } from './schedulingSetupSteps';

const fresh: SchedulingSummary = {
  shifts_scheduled: 0,
  shifts_scheduled_this_week: 0,
  shifts_scheduled_this_month: 0,
  hours_worked_this_month: 0,
  active_templates: 0,
  active_patterns: 0,
};

const heading = { name: 'Set up scheduling for your department' };

describe('SchedulingSetupGuide', () => {
  beforeEach(() => {
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue(fresh);
    localStorage.removeItem(SCHEDULING_SETUP_GUIDE_HIDDEN_KEY);
  });

  it('walks a fresh department through the steps, in order, with a link to each', async () => {
    renderWithRouter(<SchedulingSetupGuide />);

    expect(await screen.findByRole('heading', heading)).toBeInTheDocument();
    expect(screen.getByText(/0 of 2 required steps done/)).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('1. Create a shift template');
    expect(items[1]).toHaveTextContent('(optional)');
    expect(items[2]).toHaveTextContent('3. Put shifts on the calendar');
    expect(screen.getByRole('link', { name: /Open Shift Templates/ })).toHaveAttribute(
      'href',
      '/scheduling/admin/planning/templates'
    );
    expect(screen.getByRole('link', { name: /Open Shift Patterns/ })).toHaveAttribute(
      'href',
      '/scheduling/admin/planning/patterns'
    );
    expect(screen.getByRole('link', { name: /Go to the Schedule/ })).toHaveAttribute('href', '/scheduling');
  });

  it('ticks off a finished step and drops its link', async () => {
    mockGetSummary.mockResolvedValue({ ...fresh, active_templates: 2 });
    renderWithRouter(<SchedulingSetupGuide />);

    expect(await screen.findByText(/1 of 2 required steps done/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Shift Templates/ })).not.toBeInTheDocument();
  });

  it('disappears once templates and shifts exist, even without a pattern', async () => {
    mockGetSummary.mockResolvedValue({ ...fresh, active_templates: 1, shifts_scheduled: 30 });
    renderWithRouter(<SchedulingSetupGuide />);

    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
    expect(screen.queryByRole('heading', heading)).not.toBeInTheDocument();
  });

  it('stays out of the way when the counts do not load', async () => {
    mockGetSummary.mockRejectedValue(new Error('offline'));
    renderWithRouter(<SchedulingSetupGuide />);

    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
    expect(screen.queryByRole('heading', heading)).not.toBeInTheDocument();
  });

  it('stays hidden after the officer dismisses it, without asking for the counts again', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithRouter(<SchedulingSetupGuide />);

    await user.click(await screen.findByRole('button', { name: 'Hide the setup guide' }));
    expect(screen.queryByRole('heading', heading)).not.toBeInTheDocument();
    unmount();
    mockGetSummary.mockClear();

    renderWithRouter(<SchedulingSetupGuide />);
    expect(screen.queryByRole('heading', heading)).not.toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
  });
});
