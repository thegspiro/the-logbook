import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listTrainingWaivers = vi.fn();
const listLeavesOfAbsence = vi.fn();
const getUsers = vi.fn();
vi.mock('../services/api', () => ({
  memberStatusService: {
    listTrainingWaivers: (...args: unknown[]) => listTrainingWaivers(...args) as unknown,
    listLeavesOfAbsence: (...args: unknown[]) => listLeavesOfAbsence(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => getUsers(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { renderWithRouter } from '../test/utils';
import TrainingWaiversTab from './TrainingWaiversTab';

describe('TrainingWaiversTab status filter', () => {
  beforeEach(() => {
    listTrainingWaivers.mockReset();
    listTrainingWaivers.mockResolvedValue([]);
    listLeavesOfAbsence.mockReset();
    listLeavesOfAbsence.mockResolvedValue([]);
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
  });

  // The five segments are a toggle group: the selected one has to be exposed
  // as pressed, not only painted red, and the group needs a name now that it
  // is a scroll region on a phone.
  it('exposes the selected status as pressed and moves it on click', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingWaiversTab />);

    const group = await screen.findByRole('group', { name: 'Waiver status' });
    expect(group).toHaveAttribute('data-mobile-scroll-region');

    const all = screen.getByRole('button', { name: 'All' });
    const inactive = screen.getByRole('button', { name: 'Inactive' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(inactive).toHaveAttribute('aria-pressed', 'false');

    await user.click(inactive);
    expect(inactive).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });
});

// Calendar dates far enough either side of the real day that the test does not
// age: the component reads today from the clock.
const waiver = (user_id: string, start_date: string, end_date: string | null, active = true) => ({
  id: `w-${user_id}`,
  user_id,
  waiver_type: 'leave_of_absence',
  reason: null,
  start_date,
  end_date,
  requirement_ids: null,
  granted_by: null,
  active,
});

describe('TrainingWaiversTab status rule', () => {
  beforeEach(() => {
    listTrainingWaivers.mockReset();
    listTrainingWaivers.mockResolvedValue([
      waiver('ended', '2025-07-01', '2026-09-01'),
      waiver('current', '2026-01-01', '2099-12-31'),
      waiver('permanent', '2026-01-01', null),
      waiver('upcoming', '2099-01-01', '2099-02-01'),
      waiver('cancelled', '2026-01-01', '2099-12-31', false),
    ]);
    listLeavesOfAbsence.mockReset();
    listLeavesOfAbsence.mockResolvedValue([]);
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
  });

  const rowFor = (memberLabel: string) => {
    const link = screen.getByRole('link', { name: memberLabel });
    const row = link.closest('tr');
    if (!row) throw new Error(`no row for ${memberLabel}`);
    return within(row);
  };

  it('badges each row by the rule the member profile uses', async () => {
    renderWithRouter(<TrainingWaiversTab />);
    await screen.findByRole('link', { name: 'ended' });
    expect(rowFor('ended').getByText('Expired', { selector: '.rounded-full' })).toBeInTheDocument();
    expect(rowFor('current').getByText('Active', { selector: '.rounded-full' })).toBeInTheDocument();
    expect(rowFor('permanent').getByText('Permanent', { selector: '.rounded-full' })).toBeInTheDocument();
    expect(rowFor('upcoming').getByText('Future', { selector: '.rounded-full' })).toBeInTheDocument();
    // "Inactive", as the filter that finds it is named, not "Deactivated".
    expect(rowFor('cancelled').getByText('Inactive', { selector: '.rounded-full' })).toBeInTheDocument();
  });

  it('filters by the same badge the row shows', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingWaiversTab />);
    await screen.findByRole('link', { name: 'ended' });

    // Member links only: the footer links to the Waivers screen.
    const shown = () =>
      screen
        .getAllByRole('link')
        .filter((l) => l.getAttribute('href')?.startsWith('/members/') && !l.getAttribute('href')?.includes('admin'))
        .map((l) => l.textContent);

    await user.click(screen.getByRole('button', { name: 'Active' }));
    expect(shown()).toEqual(expect.arrayContaining(['current', 'permanent']));
    expect(shown()).not.toContain('ended');

    await user.click(screen.getByRole('button', { name: 'Expired' }));
    expect(shown()).toEqual(['ended']);

    await user.click(screen.getByRole('button', { name: 'Inactive' }));
    expect(shown()).toEqual(['cancelled']);
  });
});
