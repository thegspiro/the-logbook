import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import EventAttendancePetitionsCard from './EventAttendancePetitionsCard';
import type { AttendancePetition } from '../../types/event';

const mockList = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();
vi.mock('../../services/api', () => ({
  eventService: {
    getAttendancePetitions: (...args: unknown[]) => mockList(...args) as unknown,
    approveAttendancePetition: (...args: unknown[]) => mockApprove(...args) as unknown,
    rejectAttendancePetition: (...args: unknown[]) => mockReject(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const pending = (over: Partial<AttendancePetition> = {}): AttendancePetition => ({
  id: 'pet-1',
  event_id: 'evt-1',
  user_id: 'user-1',
  user_name: 'Sam Member',
  status: 'pending',
  reason: 'Phone died at the door',
  created_at: '2026-09-29T20:00:00Z',
  ...over,
});

const onApproved = vi.fn();

const render = (attendanceFinalized = false) =>
  renderWithRouter(
    <EventAttendancePetitionsCard
      eventId="evt-1"
      defaultCheckIn="2026-09-29T18:00:00Z"
      defaultCheckOut="2026-09-29T20:00:00Z"
      attendanceFinalized={attendanceFinalized}
      timezone="UTC"
      onApproved={onApproved}
    />
  );

describe('EventAttendancePetitionsCard', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockApprove.mockReset();
    mockReject.mockReset();
    onApproved.mockReset();
    mockList.mockResolvedValue([pending()]);
  });

  it('renders nothing when nobody has asked, or the caller may not review', async () => {
    mockList.mockRejectedValue({ response: { status: 403 } });
    const { container } = render();

    await vi.waitFor(() => expect(mockList).toHaveBeenCalledWith('evt-1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('approves with the event times when the member gave none', async () => {
    mockApprove.mockResolvedValue(pending({ status: 'approved', reviewed_by_name: 'Olive Member' }));
    const user = userEvent.setup();
    render();

    expect(await screen.findByText('Phone died at the door')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Approve Sam Member's request" }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(mockApprove).toHaveBeenCalledWith('evt-1', 'pet-1', {
      check_in_at: '2026-09-29T18:00:00.000Z',
      check_out_at: '2026-09-29T20:00:00.000Z',
      review_note: undefined,
    });
    expect(onApproved).toHaveBeenCalled();
    expect(await screen.findByText(/Approved by Olive Member/)).toBeInTheDocument();
  });

  it('starts from the times the member gave', async () => {
    mockList.mockResolvedValue([
      pending({ requested_check_in_at: '2026-09-29T18:30:00Z', requested_check_out_at: '2026-09-29T19:45:00Z' }),
    ]);
    mockApprove.mockResolvedValue(pending({ status: 'approved' }));
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: "Approve Sam Member's request" }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    expect(mockApprove).toHaveBeenCalledWith(
      'evt-1',
      'pet-1',
      expect.objectContaining({
        check_in_at: '2026-09-29T18:30:00.000Z',
        check_out_at: '2026-09-29T19:45:00.000Z',
      })
    );
  });

  it('cannot approve while attendance is finalized, but can still decline', async () => {
    render(true);

    expect(await screen.findByText(/Reopen attendance to approve/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Approve Sam Member's request" })).toBeDisabled();
    expect(screen.getByRole('button', { name: "Decline Sam Member's request" })).toBeEnabled();
  });

  it('declines with the reason typed', async () => {
    mockReject.mockResolvedValue(pending({ status: 'rejected', review_note: 'Not on the sign-in sheet' }));
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: "Decline Sam Member's request" }));
    await user.type(screen.getByLabelText('Reason'), 'Not on the sign-in sheet');
    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    expect(mockReject).toHaveBeenCalledWith('evt-1', 'pet-1', 'Not on the sign-in sheet');
    expect(await screen.findByText(/Declined: Not on the sign-in sheet/)).toBeInTheDocument();
  });
});
