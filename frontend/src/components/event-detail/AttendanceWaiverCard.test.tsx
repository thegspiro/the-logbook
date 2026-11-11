import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverEligibility, AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockEligibility = vi.fn();
const mockGet = vi.fn();
const mockSubmit = vi.fn();
const mockWithdraw = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    getEligibility: (...args: unknown[]) => mockEligibility(...args) as unknown,
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    submit: (...args: unknown[]) => mockSubmit(...args) as unknown,
    withdraw: (...args: unknown[]) => mockWithdraw(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverCard from './AttendanceWaiverCard';

const eligibility = (over: Partial<AttendanceWaiverEligibility> = {}): AttendanceWaiverEligibility => ({
  event_id: 'evt-1',
  allowed: true,
  refusal_code: null,
  refusal: null,
  deadline: '2026-11-20T23:00:00Z',
  deadline_preset: 'before_start',
  session_date: '2026-11-20',
  cap: null,
  cap_period: 'calendar_year',
  cap_used: null,
  cap_remaining: null,
  categories: [],
  category_required: false,
  reason_text: 'optional',
  existing_request_id: null,
  existing_request_status: null,
  ...over,
});

const request = (over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id: 'req-1',
  workflow: 'training_session',
  user_id: 'user-1',
  member_name: 'Pat Doe',
  event_id: 'evt-1',
  event_title: 'Ladder Drill',
  event_start: '2026-11-20T23:00:00Z',
  session_date: '2026-11-20',
  status: 'pending',
  category: null,
  reason: null,
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  can_withdraw: true,
  can_decide: false,
  can_override: false,
  actions: [],
  ...over,
});

const render = () =>
  renderWithRouter(<AttendanceWaiverCard eventId="evt-1" eventTitle="Ladder Drill" timezone="UTC" />);

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /Request to be excused/ }));
  return screen.getByRole('dialog', { name: 'Ask to be excused' });
};

describe('AttendanceWaiverCard', () => {
  beforeEach(() => {
    mockEligibility.mockReset();
    mockGet.mockReset();
    mockSubmit.mockReset();
    mockWithdraw.mockReset();
    mockEligibility.mockResolvedValue(eligibility());
  });

  it.each([['disabled'], ['not_counted'], ['exempt'], ['cancelled']])(
    'renders nothing when the server refuses with %s',
    async (code) => {
      mockEligibility.mockResolvedValue(eligibility({ allowed: false, refusal_code: code, refusal: 'No.' }));
      const { container } = render();
      await vi.waitFor(() => expect(mockEligibility).toHaveBeenCalledWith('evt-1'));
      expect(container).toBeEmptyDOMElement();
    }
  );

  it('tells a member who checked in why they cannot ask, in the server’s words', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({
        allowed: false,
        refusal_code: 'checked_in',
        refusal: 'You checked in to this session, so it already counts as attended.',
      })
    );
    render();
    expect(
      await screen.findByText('You checked in to this session, so it already counts as attended.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request to be excused/ })).not.toBeInTheDocument();
  });

  it('shows the calendar-year cap from eligibility', async () => {
    mockEligibility.mockResolvedValue(eligibility({ cap: 3, cap_used: 1, cap_remaining: 2 }));
    render();
    expect(await screen.findByText('You have used 1 of 3 waivers for 2026 (2 left).')).toBeInTheDocument();
  });

  it('words a rolling cap as a 12-month span', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({ cap: 1, cap_used: 0, cap_remaining: 1, cap_period: 'rolling_12_months' })
    );
    render();
    expect(
      await screen.findByText('You have used 0 of 1 waiver in any 12 months that include this session (1 left).')
    ).toBeInTheDocument();
  });

  it('asks for neither field when the policy takes no category and no text', async () => {
    mockEligibility.mockResolvedValue(eligibility({ reason_text: 'off' }));
    mockSubmit.mockResolvedValue(request());
    const user = userEvent.setup();
    render();
    const dialog = await openDialog(user);
    expect(within(dialog).queryByLabelText(/Reason category/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Explanation/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(mockSubmit).toHaveBeenCalledWith({ event_id: 'evt-1', category: undefined, reason: undefined });
  });

  it('refuses locally when a required category and required text are missing', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({ categories: ['Work', 'Illness'], category_required: true, reason_text: 'required' })
    );
    const user = userEvent.setup();
    render();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Choose a category.', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).getByText('Say briefly why you cannot attend.', { selector: 'p' })).toBeInTheDocument();
  });

  it('sends the chosen category and trimmed text', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({ categories: ['Work', 'Illness'], category_required: true, reason_text: 'required' })
    );
    mockSubmit.mockResolvedValue(request());
    const user = userEvent.setup();
    render();
    const dialog = await openDialog(user);
    await user.selectOptions(within(dialog).getByLabelText(/Reason category/), 'Illness');
    await user.type(within(dialog).getByLabelText(/Explanation/), '  Flu  ');
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(mockSubmit).toHaveBeenCalledWith({ event_id: 'evt-1', category: 'Illness', reason: 'Flu' });
  });

  it('omits an optional category and text left blank', async () => {
    mockEligibility.mockResolvedValue(eligibility({ categories: ['Work'], category_required: false }));
    mockSubmit.mockResolvedValue(request());
    const user = userEvent.setup();
    render();
    const dialog = await openDialog(user);
    expect(within(dialog).getByLabelText(/Reason category/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(mockSubmit).toHaveBeenCalledWith({ event_id: 'evt-1', category: undefined, reason: undefined });
  });

  it('shows the server’s refusal and keeps the dialog open', async () => {
    mockSubmit.mockRejectedValue({
      response: { status: 400, data: { detail: 'The deadline to ask about this session has passed.' } },
      isAxiosError: true,
    });
    const user = userEvent.setup();
    render();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await within(dialog).findByText('The deadline to ask about this session has passed.')).toBeInTheDocument();
  });

  it('shows the pending request after submitting, with Withdraw', async () => {
    mockSubmit.mockResolvedValue(request());
    const user = userEvent.setup();
    render();
    const dialog = await openDialog(user);
    mockEligibility.mockResolvedValue(
      eligibility({ allowed: false, refusal_code: 'already_requested', existing_request_id: 'req-1' })
    );
    mockGet.mockResolvedValue(request());
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/It is waiting for a decision/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument();
  });

  it('withdraws only after the member confirms', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({ allowed: false, refusal_code: 'already_requested', existing_request_id: 'req-1' })
    );
    mockGet.mockResolvedValue(request());
    mockWithdraw.mockResolvedValue(request({ status: 'withdrawn' }));
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mockWithdraw).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Withdraw your request?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Withdraw request' }));
    expect(mockWithdraw).toHaveBeenCalledWith('req-1');
  });

  it('shows an approval with its decider and note', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({ allowed: false, refusal_code: 'already_requested', existing_request_id: 'req-1' })
    );
    mockGet.mockResolvedValue(
      request({
        status: 'approved',
        decided_by_name: 'Lt. Smith',
        can_withdraw: false,
        actions: [
          { id: 'a1', action: 'submitted', actor_id: 'user-1', actor_name: 'Pat Doe', note: null, created_at: 'x' },
          { id: 'a2', action: 'approved', actor_id: 'u2', actor_name: 'Lt. Smith', note: 'Get well', created_at: 'y' },
        ],
      })
    );
    render();
    expect(await screen.findByText(/You are excused from this session, approved by Lt\. Smith/)).toBeInTheDocument();
    expect(screen.getByText('Note: Get well')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).not.toBeInTheDocument();
  });

  it('shows a denial with its reason', async () => {
    mockEligibility.mockResolvedValue(
      eligibility({ allowed: false, refusal_code: 'already_requested', existing_request_id: 'req-1' })
    );
    mockGet.mockResolvedValue(
      request({
        status: 'denied',
        decided_by_name: 'Lt. Smith',
        can_withdraw: false,
        actions: [
          {
            id: 'a2',
            action: 'denied',
            actor_id: 'u2',
            actor_name: 'Lt. Smith',
            note: 'Mandatory drill',
            created_at: 'y',
          },
        ],
      })
    );
    render();
    expect(await screen.findByText(/was not approved by Lt\. Smith/)).toBeInTheDocument();
    expect(screen.getByText('Reason: Mandatory drill')).toBeInTheDocument();
  });
});
