/**
 * Confirming an attendance request decides the member's credited time, and the
 * form starts from the times the member claimed. Workflow review, training
 * events: a claim of 6:00-11:45 PM for a 7-9 PM drill was approved as shown and
 * credited almost six hours, with nothing on the dialog to say it ran outside
 * the event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AttendancePetition } from '../../types/event';

const mockApprove = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    approveAttendancePetition: (...args: unknown[]) => mockApprove(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { AttendancePetitionApproveDialog } from './AttendancePetitionDecisionDialogs';

// 7-9 PM in Chicago (UTC-6 in November).
const EVENT_START = '2026-11-08T01:00:00Z';
const EVENT_END = '2026-11-08T03:00:00Z';

const petition = (checkIn: string | null, checkOut: string | null): AttendancePetition => ({
  id: 'pet-1',
  event_id: 'evt-1',
  user_id: 'u-1',
  user_name: 'Jordan Avery',
  status: 'pending',
  reason: 'Phone died',
  requested_check_in_at: checkIn,
  requested_check_out_at: checkOut,
  created_at: '2026-11-08T16:07:00Z',
});

const renderDialog = (p: AttendancePetition) =>
  render(
    <AttendancePetitionApproveDialog
      eventId="evt-1"
      petition={p}
      defaultCheckIn={EVENT_START}
      defaultCheckOut={EVENT_END}
      timezone="America/Chicago"
      onClose={vi.fn()}
      onApproved={vi.fn()}
    />
  );

describe('AttendancePetitionApproveDialog', () => {
  beforeEach(() => {
    mockApprove.mockReset();
    mockApprove.mockResolvedValue(petition(null, null));
  });

  it('warns when the confirmed times run outside the event, and still approves them', async () => {
    const user = userEvent.setup();
    renderDialog(petition('2026-11-08T00:00:00Z', '2026-11-08T05:45:00Z'));

    expect(
      await screen.findByText(/These times run outside the event, which ran 7:00\s?PM to 9:00\s?PM/)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(mockApprove).toHaveBeenCalledWith('evt-1', 'pet-1', {
      check_in_at: '2026-11-08T00:00:00.000Z',
      check_out_at: '2026-11-08T05:45:00.000Z',
      review_note: undefined,
    });
  });

  it('says nothing when the times sit within the event', async () => {
    renderDialog(petition(null, null));

    expect(await screen.findByText(/Confirm when Jordan Avery was present/)).toBeInTheDocument();
    expect(screen.queryByText(/run outside the event/)).not.toBeInTheDocument();
  });
});
