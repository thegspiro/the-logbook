/**
 * Adding a voter override (workflow review W50).
 *
 * The form asked for the member's user ID, a UUID no screen shows a
 * secretary, so an override could only be added by someone who could read
 * the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mocks = vi.hoisted(() => ({
  getVoterOverrides: vi.fn(),
  addVoterOverride: vi.fn(),
  removeVoterOverride: vi.fn(),
  getUsers: vi.fn(),
}));

vi.mock('../services/api', () => ({
  electionService: {
    getVoterOverrides: mocks.getVoterOverrides,
    addVoterOverride: mocks.addVoterOverride,
    removeVoterOverride: mocks.removeVoterOverride,
  },
  userService: { getUsers: mocks.getUsers },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { VoterOverrideManagement } from './VoterOverrideManagement';

describe('VoterOverrideManagement', () => {
  beforeEach(() => {
    mocks.getVoterOverrides.mockReset();
    mocks.getVoterOverrides.mockResolvedValue([]);
    mocks.addVoterOverride.mockReset();
    mocks.addVoterOverride.mockResolvedValue({});
    mocks.getUsers.mockReset();
    mocks.getUsers.mockResolvedValue([
      { id: 'u-alex', username: 'alex', full_name: 'Alex Brooks', status: 'active' },
      { id: 'u-gone', username: 'gone', full_name: 'Former Member', status: 'retired' },
    ]);
  });

  it('picks the member by name, not by user ID', async () => {
    renderWithRouter(<VoterOverrideManagement electionId="el-1" canManage />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add Override' }));

    const member = screen.getByLabelText('Member *');
    expect(await screen.findByRole('option', { name: 'Alex Brooks' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Former Member' })).not.toBeInTheDocument();

    await userEvent.selectOptions(member, 'u-alex');
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Arrived after the vote opened');
    await userEvent.click(screen.getByRole('button', { name: 'Add Override' }));

    expect(mocks.addVoterOverride).toHaveBeenCalledWith(
      'el-1',
      expect.objectContaining({ user_id: 'u-alex', reason: 'Arrived after the vote opened' })
    );
  });

  // The server names the member as member_name; the screen read user_name,
  // so every override was listed by its UUID.
  it('lists an override under the member name', async () => {
    mocks.getVoterOverrides.mockResolvedValue([
      {
        user_id: 'u-alex',
        member_name: 'Alex Brooks',
        reason: 'Arrived after the vote opened',
        overridden_by: 'u-sec',
        overridden_by_name: 'Sam Ortiz',
        overridden_at: '2026-09-30T07:57:03Z',
      },
    ]);
    renderWithRouter(<VoterOverrideManagement electionId="el-1" canManage />);
    expect(await screen.findByText('Alex Brooks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove override for Alex Brooks' })).toBeInTheDocument();
  });
});
