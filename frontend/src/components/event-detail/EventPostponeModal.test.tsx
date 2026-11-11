/**
 * The Postpone dialog (workflow review W80-11): what it warns about, and the
 * payload it hands up. Times are entered in the department's timezone and
 * leave as UTC.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventPostponeModal from './EventPostponeModal';

// 10:00-12:00 in Chicago (UTC-6 in November).
const START = '2026-11-08T16:00:00Z';
const END = '2026-11-08T18:00:00Z';

const openDialog = (checkedInCount = 0) => {
  const onSubmit = vi.fn();
  render(
    <EventPostponeModal
      currentStart={START}
      currentEnd={END}
      timezone="America/Chicago"
      checkedInCount={checkedInCount}
      submitting={false}
      submitError={null}
      onSubmit={onSubmit}
      onClose={vi.fn()}
    />
  );
  return onSubmit;
};

describe('EventPostponeModal', () => {
  it('says RSVPs stay and check-ins go, naming how many are checked in', () => {
    openDialog(3);

    expect(
      screen.getByText(/RSVPs are kept\. Check-ins and corrected times recorded so far are cleared/)
    ).toBeInTheDocument();
    expect(screen.getByText('3 members are checked in now and will need to check in again.')).toBeInTheDocument();
  });

  it('hands up the new times in UTC, the reason, and the notice choice', async () => {
    const user = userEvent.setup();
    const onSubmit = openDialog();

    // Picking a new date in the picker keeps the time already chosen.
    fireEvent.change(screen.getByLabelText(/^New start \*$/), { target: { value: '2026-11-15' } });
    fireEvent.change(screen.getByLabelText(/^New end \*$/), { target: { value: '2026-11-15' } });
    await user.type(screen.getByLabelText(/Reason/), 'Ladder truck out of service');
    await user.click(screen.getByRole('button', { name: 'Postpone Event' }));

    expect(onSubmit).toHaveBeenCalledWith({
      newStart: '2026-11-15T16:00:00.000Z',
      newEnd: '2026-11-15T18:00:00.000Z',
      reason: 'Ladder truck out of service',
      sendNotifications: true,
    });
  });

  it('refuses to postpone to the time the event already has', async () => {
    const user = userEvent.setup();
    const onSubmit = openDialog();

    await user.type(screen.getByLabelText(/Reason/), 'Ladder truck out of service');
    await user.click(screen.getByRole('button', { name: 'Postpone Event' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a new time to postpone the event to.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Postpone disabled until the reason has ten characters', async () => {
    const user = userEvent.setup();
    openDialog();

    await user.type(screen.getByLabelText(/Reason/), 'Too short');

    expect(screen.getByRole('button', { name: 'Postpone Event' })).toBeDisabled();
  });
});
