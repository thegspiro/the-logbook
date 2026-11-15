/**
 * Leave Requests: a member asks for leave, and an approver decides.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getConfig = vi.fn();
const listMine = vi.fn();
const listToDecide = vi.fn();
const create = vi.fn();
const vote = vi.fn();
const withdraw = vi.fn();

vi.mock('../services/leaveRequestService', () => ({
  leaveRequestService: {
    getConfig: (...a: unknown[]) => getConfig(...a) as unknown,
    listMine: (...a: unknown[]) => listMine(...a) as unknown,
    listToDecide: (...a: unknown[]) => listToDecide(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
    vote: (...a: unknown[]) => vote(...a) as unknown,
    withdraw: (...a: unknown[]) => withdraw(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const checkPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => checkPermission(p) as boolean }),
}));

import LeaveRequestsPage from './LeaveRequestsPage';

const request = (overrides: Record<string, unknown>) => ({
  id: 'r1',
  user_id: 'u1',
  member_name: 'Alex Johnson',
  leave_type: 'medical',
  start_date: '2026-12-01',
  end_date: '2027-02-28',
  reason: 'Surgery and recovery',
  status: 'pending',
  decision_rule: 'majority',
  created_at: '2026-11-14T12:00:00Z',
  decided_at: null,
  decided_by_name: null,
  leave_id: null,
  votes: [],
  approvals: 1,
  denials: 0,
  approver_count: 3,
  approvals_needed: 2,
  can_vote: false,
  my_vote: null,
  ...overrides,
});

describe('LeaveRequestsPage', () => {
  beforeEach(() => {
    for (const mock of [getConfig, listMine, listToDecide, create, vote, withdraw, checkPermission]) {
      mock.mockReset();
    }
    checkPermission.mockReturnValue(false);
    getConfig.mockResolvedValue({ requests_enabled: true });
    listMine.mockResolvedValue([]);
    listToDecide.mockResolvedValue([]);
    create.mockResolvedValue(request({}));
    vote.mockResolvedValue(request({ status: 'approved' }));
  });

  it('sends a request with no end date when the member does not know it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LeaveRequestsPage />);

    await user.type(await screen.findByLabelText('First day'), '2026-12-01');
    await user.click(screen.getByRole('checkbox', { name: /don.t know the last day/ }));
    await user.type(screen.getByLabelText('Reason (optional)'), '  Surgery  ');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(create).toHaveBeenCalledWith({
      leave_type: 'leave_of_absence',
      start_date: '2026-12-01',
      end_date: undefined,
      reason: 'Surgery',
    });
  });

  it('says the department takes no requests when it has them off', async () => {
    getConfig.mockResolvedValue({ requests_enabled: false });
    renderWithRouter(<LeaveRequestsPage />);

    expect(await screen.findByText(/records leave through its officers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
  });

  it('an approver reads the reason and the tally, and approves with a note', async () => {
    const user = userEvent.setup();
    listToDecide.mockResolvedValue([request({ can_vote: true })]);
    renderWithRouter(<LeaveRequestsPage />);

    const section = await screen.findByRole('region', { name: 'To decide' });
    expect(within(section).getByText('Surgery and recovery')).toBeInTheDocument();
    expect(within(section).getByText(/1 of 2 approvals needed \(3 approvers\)/)).toBeInTheDocument();

    await user.type(within(section).getByLabelText('Note to the member (optional)'), 'Get well');
    await user.click(within(section).getByRole('button', { name: 'Approve' }));

    expect(vote).toHaveBeenCalledWith('r1', 'approve', 'Get well');
  });

  it('a denial is confirmed before it is sent', async () => {
    const user = userEvent.setup();
    listToDecide.mockResolvedValue([request({ can_vote: true })]);
    renderWithRouter(<LeaveRequestsPage />);

    const section = await screen.findByRole('region', { name: 'To decide' });
    await user.click(within(section).getByRole('button', { name: 'Deny' }));
    expect(vote).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deny' }));

    expect(vote).toHaveBeenCalledWith('r1', 'deny', undefined);
  });

  it('a member withdraws a request still waiting', async () => {
    const user = userEvent.setup();
    listMine.mockResolvedValue([request({ member_name: 'Me' })]);
    withdraw.mockResolvedValue(request({ status: 'withdrawn' }));
    renderWithRouter(<LeaveRequestsPage />);

    const mine = await screen.findByRole('region', { name: 'Your requests' });
    await user.click(await within(mine).findByRole('button', { name: 'Withdraw' }));
    await user.click(await screen.findByRole('button', { name: 'Withdraw it' }));

    expect(withdraw).toHaveBeenCalledWith('r1');
  });

  it('a failed load is said, not shown as no requests', async () => {
    listMine.mockRejectedValue(new TypeError('The leave requests response was not an array'));
    renderWithRouter(<LeaveRequestsPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
