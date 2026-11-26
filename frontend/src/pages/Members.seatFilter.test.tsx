/**
 * Members roster — the Time in seat filter (owner decisions, 2026-11-26).
 *
 * Officers holding scheduling.report can narrow the roster to members with
 * credited time in one seat over a period, and see each one's hours there.
 * Nobody else sees the control or asks for anyone's hours.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { User } from '../types/user';
import { UserStatus } from '../constants/enums';

const mockRoster = vi.fn();
const mockSeatHours = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    getUsers: (...args: unknown[]) => mockRoster(...args) as unknown,
    checkContactInfoEnabled: () => Promise.resolve({ enabled: false }),
    deleteUserWithMode: vi.fn(),
  },
  memberStatusService: {
    reactivateMember: vi.fn(),
    getServiceHistory: vi.fn(),
    getTierConfig: () => Promise.resolve({ auto_advance: true, tiers: [] }),
    getTierNames: () => Promise.resolve([]),
  },
}));

vi.mock('../services/memberDirectoryService', () => ({
  memberDirectoryService: {
    getDirectory: (...args: unknown[]) => mockRoster(...args) as unknown,
  },
}));

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getSeatHours: (...args: unknown[]) => mockSeatHours(...args) as unknown,
  },
}));

// The department's seats, as the template form's picker offers them.
vi.mock('../modules/scheduling/components/shiftTemplateTypes', () => ({
  getPositionOptions: () => [
    { value: 'officer', label: 'Officer' },
    { value: 'driver', label: 'Driver/Operator' },
  ],
}));

const mockAuthState: Record<string, unknown> = {
  user: { id: 'me' },
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as unknown,
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'UTC',
}));

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({ formatRank: (code: string | null | undefined) => code ?? '' }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import Members from './Members';

const member = (id: string, first: string, last: string): User => ({
  id,
  organization_id: 'org-1',
  username: id,
  email: undefined,
  first_name: first,
  last_name: last,
  status: UserStatus.ACTIVE,
});

const ROSTER: User[] = [member('u1', 'Laura', 'Adams'), member('u2', 'Brian', 'Anderson')];

const grant = (held: string[]) =>
  mockCheckPermission.mockImplementation((permission: unknown) => held.includes(permission as string));

describe('Members roster — Time in seat', () => {
  beforeEach(() => {
    mockRoster.mockReset();
    mockRoster.mockResolvedValue(ROSTER);
    mockSeatHours.mockReset();
    mockSeatHours.mockResolvedValue({
      position: 'driver',
      members: [{ user_id: 'u2', shifts: 3, hours: 36, calls: 7 }],
    });
    mockCheckPermission.mockReset();
  });

  it('narrows to members with time in the seat and shows their hours', async () => {
    grant(['scheduling.report']);
    const user = userEvent.setup();
    renderWithRouter(<Members />);
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Time in seat'), 'driver');

    const year = new Date().getUTCFullYear();
    expect(mockSeatHours).toHaveBeenCalledWith({
      position: 'driver',
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    });
    const table = screen.getByRole('table');
    await waitFor(() => expect(within(table).queryByText('Laura Adams')).not.toBeInTheDocument());
    expect(within(table).getByText('Brian Anderson')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Hours in seat/ })).toBeInTheDocument();
    expect(within(table).getByText('36 hrs · 3 shifts')).toBeInTheDocument();
  });

  it('asks for all time with open dates', async () => {
    grant(['scheduling.report']);
    const user = userEvent.setup();
    renderWithRouter(<Members />);
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Time in seat'), 'driver');
    await user.selectOptions(screen.getByLabelText('Period'), 'all_time');

    await waitFor(() => expect(mockSeatHours).toHaveBeenLastCalledWith({ position: 'driver' }));
  });

  it('is not offered to a member without scheduling.report', async () => {
    grant([]);
    renderWithRouter(<Members />);
    await screen.findByRole('table');

    expect(screen.queryByLabelText('Time in seat')).not.toBeInTheDocument();
    expect(mockSeatHours).not.toHaveBeenCalled();
  });
});
