import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { StatusChangeRecord } from '../../types/user';
import { StatusChangeReason } from './StatusChangeReason';

const getStatusChange = vi.fn<(userId: string) => Promise<StatusChangeRecord>>();
const updateStatusChangeReason = vi.fn<(userId: string, reason: string | null) => Promise<StatusChangeRecord>>();

vi.mock('../../services/api', () => ({
  memberStatusService: {
    getStatusChange: (userId: string) => getStatusChange(userId),
    updateStatusChangeReason: (userId: string, reason: string | null) => updateStatusChangeReason(userId, reason),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const RECORD: StatusChangeRecord = {
  user_id: 'u1',
  status: 'retired',
  status_changed_at: '2026-10-01T15:00:00Z',
  status_change_reason: 'Moved out of distrcit',
};

describe('StatusChangeReason', () => {
  beforeEach(() => {
    getStatusChange.mockReset();
    getStatusChange.mockResolvedValue(RECORD);
    updateStatusChangeReason.mockReset();
    updateStatusChangeReason.mockImplementation((_id, reason) =>
      Promise.resolve({ ...RECORD, status_change_reason: reason })
    );
  });

  it('shows the recorded reason', async () => {
    renderWithRouter(<StatusChangeReason userId="u1" tz="UTC" />);

    expect(await screen.findByText('Moved out of distrcit')).toBeInTheDocument();
    expect(getStatusChange).toHaveBeenCalledWith('u1');
  });

  it('shows nothing when no status change is on record', async () => {
    getStatusChange.mockResolvedValue({ ...RECORD, status_changed_at: null, status_change_reason: null });
    renderWithRouter(<StatusChangeReason userId="u1" tz="UTC" />);

    await waitFor(() => expect(getStatusChange).toHaveBeenCalledWith('u1'));
    expect(screen.queryByTestId('status-change-reason')).not.toBeInTheDocument();
  });

  it('saves a corrected reason', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StatusChangeReason userId="u1" tz="UTC" />);

    await user.click(await screen.findByRole('button', { name: 'Edit status change reason' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit status change reason' });
    const field = within(dialog).getByLabelText('Reason (optional)');
    expect(field).toHaveValue('Moved out of distrcit');
    await user.clear(field);
    await user.type(field, 'Moved out of district');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateStatusChangeReason).toHaveBeenCalledWith('u1', 'Moved out of district'));
    expect(await screen.findByText('Moved out of district')).toBeInTheDocument();
  });

  it('clears the reason when the field is emptied', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StatusChangeReason userId="u1" tz="UTC" />);

    await user.click(await screen.findByRole('button', { name: 'Edit status change reason' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit status change reason' });
    await user.clear(within(dialog).getByLabelText('Reason (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateStatusChangeReason).toHaveBeenCalledWith('u1', null));
    expect(await screen.findByText('No reason recorded')).toBeInTheDocument();
  });

  it('re-reads the record when the status changes', async () => {
    const { rerender } = renderWithRouter(<StatusChangeReason userId="u1" tz="UTC" refreshKey="active" />);
    await screen.findByText('Moved out of distrcit');

    rerender(<StatusChangeReason userId="u1" tz="UTC" refreshKey="retired" />);

    await waitFor(() => expect(getStatusChange).toHaveBeenCalledTimes(2));
  });
});
