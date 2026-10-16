import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();
vi.mock('../../../services/api', () => ({
  meetingsService: { updateMeeting: (...a: unknown[]) => mockUpdate(...a) as unknown },
  documentsService: { getDocuments: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { AgendaEditorDialog } from './AgendaEditorDialog';
import type { MeetingRecord } from '../../../services/api';

const meeting = {
  id: 'm1',
  title: 'October meeting',
  agenda_items: [
    {
      key: 'a',
      title: 'Call to order',
      presenter: '',
      notes: '',
      needs_motion: false,
      motion_text: '',
      documents: [],
    },
  ],
} as unknown as MeetingRecord;

describe('AgendaEditorDialog', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    onSaved.mockReset();
  });

  const open = (hasMinutes = false) =>
    render(<AgendaEditorDialog meeting={meeting} hasMinutes={hasMinutes} onClose={onClose} onSaved={onSaved} />);

  it('shows the meeting’s items', () => {
    open();
    expect(screen.getByDisplayValue('Call to order')).toBeInTheDocument();
  });

  it('tells the clerk drafted minutes are not changed, only when there are some', () => {
    const { unmount } = open(false);
    expect(screen.queryByText(/Sync from agenda/)).not.toBeInTheDocument();
    unmount();
    open(true);
    expect(screen.getByText(/Sync from agenda/)).toBeInTheDocument();
  });

  it('saves the items on the meeting', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Item 1'), ' now');
    await user.click(screen.getByRole('button', { name: 'Save agenda' }));

    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      agenda_items: [expect.objectContaining({ key: 'a', title: 'Call to order now' })],
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('will not save an item with no title', async () => {
    const user = userEvent.setup();
    open();
    await user.clear(screen.getByLabelText('Item 1'));

    expect(screen.getByRole('button', { name: 'Save agenda' })).toBeDisabled();
    expect(screen.getByText('Every item needs a title.')).toBeInTheDocument();
  });

  it('stays open when the save fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Save agenda' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
