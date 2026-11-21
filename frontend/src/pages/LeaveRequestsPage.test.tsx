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
const askQuestion = vi.fn();
const getSummary = vi.fn();
const endLeaveEarly = vi.fn();
const getMyLeaves = vi.fn();

vi.mock('../services/leaveRequestService', () => ({
  leaveRequestService: {
    getConfig: (...a: unknown[]) => getConfig(...a) as unknown,
    listMine: (...a: unknown[]) => listMine(...a) as unknown,
    listToDecide: (...a: unknown[]) => listToDecide(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
    vote: (...a: unknown[]) => vote(...a) as unknown,
    withdraw: (...a: unknown[]) => withdraw(...a) as unknown,
    askQuestion: (...a: unknown[]) => askQuestion(...a) as unknown,
    getSummary: (...a: unknown[]) => getSummary(...a) as unknown,
    endLeaveEarly: (...a: unknown[]) => endLeaveEarly(...a) as unknown,
  },
}));
vi.mock('../services/api', () => ({
  memberStatusService: { getMyLeaves: (...a: unknown[]) => getMyLeaves(...a) as unknown },
}));
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const checkPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => checkPermission(p) as boolean }),
}));

import LeaveRequestsPage from './LeaveRequestsPage';
import { addCalendarDays, getTodayLocalDate } from '../utils/dateFormatting';

const today = getTodayLocalDate('UTC');

const leave = (overrides: Record<string, unknown>) => ({
  id: 'l1',
  organization_id: 'o1',
  user_id: 'me',
  leave_type: 'medical',
  reason: null,
  start_date: addCalendarDays(today, -30),
  end_date: addCalendarDays(today, 60),
  granted_by: null,
  granted_at: null,
  active: true,
  exempt_from_training_waiver: false,
  linked_training_waiver_id: null,
  created_at: null,
  updated_at: null,
  ...overrides,
});

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
    for (const mock of [
      getConfig,
      listMine,
      listToDecide,
      create,
      vote,
      withdraw,
      askQuestion,
      getSummary,
      endLeaveEarly,
      getMyLeaves,
      checkPermission,
      toastSuccess,
    ]) {
      mock.mockReset();
    }
    checkPermission.mockReturnValue(false);
    getConfig.mockResolvedValue({ requests_enabled: true });
    listMine.mockResolvedValue([]);
    listToDecide.mockResolvedValue([]);
    create.mockResolvedValue(request({}));
    vote.mockResolvedValue(request({ status: 'approved' }));
    getSummary.mockResolvedValue({ requests_enabled: true, to_decide: 0, waiting_on_me: 0 });
    getMyLeaves.mockResolvedValue([]);
  });

  it('a member on leave ends it early from their first day back', async () => {
    const user = userEvent.setup();
    const back = addCalendarDays(today, 3);
    getMyLeaves.mockResolvedValue([leave({})]);
    endLeaveEarly.mockResolvedValue({
      leave_id: 'l1',
      start_date: addCalendarDays(today, -30),
      end_date: addCalendarDays(today, 2),
      previous_end_date: addCalendarDays(today, 60),
      first_day_back: back,
    });
    renderWithRouter(<LeaveRequestsPage />);

    const card = await screen.findByRole('region', { name: 'Your leave' });
    await user.click(within(card).getByRole('button', { name: 'I’m back early' }));
    await user.type(within(card).getByLabelText('Your first day back'), back);
    await user.click(within(card).getByRole('button', { name: 'End my leave' }));
    expect(endLeaveEarly).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'End my leave' }));

    expect(endLeaveEarly).toHaveBeenCalledWith('l1', back);
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('The officers who manage leave were told.'));
  });

  it('offers no early end for a leave not yet begun, or where requests are off', async () => {
    getMyLeaves.mockResolvedValue([leave({ start_date: addCalendarDays(today, 10) })]);
    const { unmount } = renderWithRouter(<LeaveRequestsPage />);
    await screen.findByRole('region', { name: 'Your requests' });
    expect(screen.queryByRole('region', { name: 'Your leave' })).not.toBeInTheDocument();
    unmount();

    getConfig.mockResolvedValue({ requests_enabled: false });
    getMyLeaves.mockResolvedValue([leave({})]);
    renderWithRouter(<LeaveRequestsPage />);
    await screen.findByRole('region', { name: 'Your requests' });
    expect(screen.queryByRole('region', { name: 'Your leave' })).not.toBeInTheDocument();
  });

  it('says when a request will extend the current leave', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(request({ extends_leave: { start_date: '2026-12-01', end_date: '2027-01-31' } }));
    renderWithRouter(<LeaveRequestsPage />);

    await user.type(await screen.findByLabelText('First day'), '2027-01-15');
    await user.type(screen.getByLabelText('Last day'), '2027-03-31');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(toastSuccess).toHaveBeenCalledWith('Your request to extend your leave was sent to the approvers.');
  });

  it('an approver asks the member a question from the page', async () => {
    const user = userEvent.setup();
    listToDecide.mockResolvedValue([request({ can_vote: true, can_ask: true })]);
    askQuestion.mockResolvedValue(request({ awaiting: 'answer' }));
    renderWithRouter(<LeaveRequestsPage />);

    const section = await screen.findByRole('region', { name: 'To decide' });
    await user.click(within(section).getByRole('button', { name: 'Ask a question' }));
    await user.type(within(section).getByLabelText('Your question to the member'), 'Which shifts?');
    await user.click(within(section).getByRole('button', { name: 'Send question' }));

    expect(askQuestion).toHaveBeenCalledWith('r1', 'Which shifts?');
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
