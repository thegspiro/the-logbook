import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
