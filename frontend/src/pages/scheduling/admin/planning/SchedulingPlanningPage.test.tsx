/**
 * The planning screen's three sections, and the settings it deliberately
 * does not let you edit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';

vi.mock('./StaffingGapsSection', () => ({ default: () => <div>section:gaps</div> }));
vi.mock('./PlanningSettingsSummary', () => ({ default: () => <div>settings summary</div> }));
vi.mock('../../../ShiftTemplatesPage', () => ({ default: () => <div>section:templates</div> }));
vi.mock('../../PatternsTab', () => ({ default: () => <div>section:patterns</div> }));

import SchedulingPlanningPage from './SchedulingPlanningPage';

describe('SchedulingPlanningPage', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/scheduling/admin/planning');
  });

  it('renders the section its route mounts, and lists the rest', async () => {
    renderWithRouter(<SchedulingPlanningPage section="gaps" />);

    expect(await screen.findByText('section:gaps')).toBeInTheDocument();
    for (const label of ['Staffing gaps', 'Templates', 'Patterns']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  // A section is a route, so it can be linked to and bookmarked — the same
  // reason the settings sections are routes rather than a ?tab=.
  it('navigates to the chosen section', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SchedulingPlanningPage section="gaps" />);

    await user.click((await screen.findAllByRole('button', { name: /Patterns/ }))[0] as HTMLElement);

    expect(window.location.pathname).toBe('/scheduling/admin/planning/patterns');
  });

  it('absorbs the templates and patterns screens rather than linking out to them', async () => {
    const { unmount } = renderWithRouter(<SchedulingPlanningPage section="templates" />);
    expect(await screen.findByText('section:templates')).toBeInTheDocument();
    unmount();

    renderWithRouter(<SchedulingPlanningPage section="patterns" />);
    expect(await screen.findByText('section:patterns')).toBeInTheDocument();
  });

  // Shown beside the gaps because the officer working them is who notices the
  // default crew is wrong; edited in one place because General and Apparatus
  // save the whole settings object and two writers would overwrite each other.
  it('shows the planning settings beside the gaps, and only there', async () => {
    const { unmount } = renderWithRouter(<SchedulingPlanningPage section="gaps" />);
    expect(await screen.findByText('settings summary')).toBeInTheDocument();
    unmount();

    renderWithRouter(<SchedulingPlanningPage section="templates" />);
    expect(screen.queryByText('settings summary')).not.toBeInTheDocument();
  });

  it('offers a way back to the administration hub', () => {
    renderWithRouter(<SchedulingPlanningPage section="gaps" />);

    expect(screen.getByRole('link', { name: 'Back to scheduling administration' })).toHaveAttribute(
      'href',
      '/scheduling/admin'
    );
  });
});
