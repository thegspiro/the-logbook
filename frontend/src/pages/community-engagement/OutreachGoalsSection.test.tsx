import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { OutreachGoalYear } from '../../services/outreachGoalServices';
import { renderWithRouter } from '../../test/utils';
import OutreachGoalsSection from './OutreachGoalsSection';

const year = (overrides: Partial<OutreachGoalYear> = {}): OutreachGoalYear => ({
  year: 2026,
  year_fraction: 0.5,
  year_complete: false,
  goals: [
    {
      id: 'g-events',
      year: 2026,
      kind: 'outreach',
      measure_id: null,
      outreach_metric: 'events_held',
      label: 'Events held',
      target: 40,
      actual: 24,
      pace_target: 20,
      met: false,
      on_pace: true,
    },
    {
      id: 'g-alarms',
      year: 2026,
      kind: 'crr_measure',
      measure_id: 'm-alarms',
      outreach_metric: null,
      label: 'Smoke alarm install · Alarms installed',
      target: 200,
      actual: 60,
      pace_target: 100,
      met: false,
      on_pace: false,
    },
  ],
  ...overrides,
});

describe('OutreachGoalsSection', () => {
  it("shows each goal's progress, pace and status, as a progress bar", () => {
    renderWithRouter(<OutreachGoalsSection goals={year()} />);

    const section = screen.getByRole('region', { name: 'Goals for 2026' });
    const events = within(section).getByRole('progressbar', { name: 'Events held' });
    expect(events).toHaveAttribute('aria-valuetext', '24 of 40, on pace');
    expect(within(section).getByText('24 of 40 (60%)')).toBeInTheDocument();
    const alarms = within(section).getByRole('progressbar', { name: 'Smoke alarm install · Alarms installed' });
    expect(alarms).toHaveAttribute('aria-valuetext', '60 of 200, behind pace');
    expect(within(section).getByText('Behind pace')).toBeInTheDocument();
  });

  it('says the goals follow the calendar year, whatever the period', () => {
    renderWithRouter(<OutreachGoalsSection goals={year()} />);

    expect(screen.getByText(/whichever period is chosen above/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit goals' })).toHaveAttribute(
      'href',
      '/events/admin?tab=settings&section=goals'
    );
  });

  it('offers to set goals when there are none', () => {
    renderWithRouter(<OutreachGoalsSection goals={year({ goals: [] })} />);

    expect(screen.getByText(/No goals set for 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set goals' })).toBeInTheDocument();
  });

  it('reads a finished year as met or missed, with no pace mark', () => {
    renderWithRouter(<OutreachGoalsSection goals={year({ year_complete: true })} />);

    expect(screen.getAllByText('Missed')).toHaveLength(2);
    expect(screen.queryByTitle('Where the goal should be by now')).not.toBeInTheDocument();
  });
});
