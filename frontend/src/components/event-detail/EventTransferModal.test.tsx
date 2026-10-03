import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import EventTransferModal from './EventTransferModal';

const mockGetUsers = vi.fn();
const mockTransfer = vi.fn();
vi.mock('../../services/api', () => ({
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
  eventService: {
    transferEvent: (...args: unknown[]) => mockTransfer(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const roster = [
  { id: 'u-olive', first_name: 'Olive', last_name: 'Organizer', username: 'olive', status: 'active' },
  { id: 'u-alex', first_name: 'Alex', last_name: 'Alternate', username: 'alex', status: 'active' },
  { id: 'u-nia', first_name: 'Nia', last_name: 'Newcomer', username: 'nia', status: 'active' },
];

const onClose = vi.fn();
const onTransferred = vi.fn();

const render = (isRecurring: boolean) =>
  renderWithRouter(
    <EventTransferModal
      eventId="evt-1"
      isRecurring={isRecurring}
      currentOrganizerId="u-olive"
      currentAlternateId="u-alex"
      onClose={onClose}
      onTransferred={onTransferred}
    />
  );

const loaded = () => waitFor(() => expect(screen.getAllByRole('option', { name: 'Nia Newcomer' }).length).toBe(2));

describe('EventTransferModal', () => {
  beforeEach(() => {
    mockGetUsers.mockReset();
    mockTransfer.mockReset();
    onClose.mockReset();
    onTransferred.mockReset();
    mockGetUsers.mockResolvedValue(roster);
    mockTransfer.mockResolvedValue({ updated_count: 3, organizer_id: 'u-nia', alternate_organizer_id: 'u-alex' });
  });

  it('opens on the current pair and will not submit it unchanged for one event', async () => {
    render(false);
    await loaded();

    expect(screen.getByLabelText(/^organizer/i)).toHaveValue('u-olive');
    expect(screen.getByLabelText(/^alternate/i)).toHaveValue('u-alex');
    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeDisabled();
    // A one-off event has nothing to choose about scope.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('transfers this and future occurrences by default on a recurring event', async () => {
    const user = userEvent.setup();
    render(true);
    await loaded();

    expect(screen.getByRole('radio', { name: /this and all future events/i })).toBeChecked();
    await user.selectOptions(screen.getByLabelText(/^organizer/i), 'u-nia');
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));

    await waitFor(() =>
      expect(mockTransfer).toHaveBeenCalledWith('evt-1', {
        organizer_id: 'u-nia',
        alternate_organizer_id: 'u-alex',
        scope: 'future',
      })
    );
    expect(onTransferred).toHaveBeenCalled();
  });

  it('sends this event only and a cleared alternate as null', async () => {
    const user = userEvent.setup();
    render(true);
    await loaded();

    await user.click(screen.getByRole('radio', { name: /this event only/i }));
    await user.selectOptions(screen.getByLabelText(/^alternate/i), '');
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));

    await waitFor(() =>
      expect(mockTransfer).toHaveBeenCalledWith('evt-1', {
        organizer_id: 'u-olive',
        alternate_organizer_id: null,
        scope: 'this',
      })
    );
  });

  it('shows the refusal and stays open', async () => {
    const user = userEvent.setup();
    mockTransfer.mockRejectedValue(new Error('The selected member is not an active member'));
    render(false);
    await loaded();

    await user.selectOptions(screen.getByLabelText(/^organizer/i), 'u-nia');
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not an active member');
    expect(onTransferred).not.toHaveBeenCalled();
  });
});
