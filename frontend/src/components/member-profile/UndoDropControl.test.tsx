import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { UndoDropAvailability } from '../../services/undoDropService';
import { UndoDropControl } from './UndoDropControl';

const getAvailability = vi.fn<(userId: string) => Promise<UndoDropAvailability>>();
const undoDrop = vi.fn<(userId: string, data: Record<string, unknown>) => Promise<unknown>>();

vi.mock('../../services/undoDropService', () => ({
  undoDropService: {
    getAvailability: (userId: string) => getAvailability(userId),
    undoDrop: (userId: string, data: Record<string, unknown>) => undoDrop(userId, data),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('UndoDropControl', () => {
  const onUndone = vi.fn();

  beforeEach(() => {
    getAvailability.mockReset();
    getAvailability.mockResolvedValue({ available: true, available_until: '2026-10-12T15:00:00Z' });
    undoDrop.mockReset();
    undoDrop.mockResolvedValue({ user_id: 'u1', previous_status: 'dropped_voluntary', new_status: 'active' });
    onUndone.mockReset();
  });

  it('is not shown once the server says the drop can no longer be undone', async () => {
    getAvailability.mockResolvedValue({ available: false, detail: 'A drop can be undone for 7 days.' });
    renderWithRouter(<UndoDropControl userId="u1" memberName="Sam Smith" tz="UTC" onUndone={onUndone} />);

    await waitFor(() => expect(getAvailability).toHaveBeenCalledWith('u1'));
    expect(screen.queryByRole('button', { name: /undo drop/i })).not.toBeInTheDocument();
  });

  it('undoes the drop with the chosen status after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<UndoDropControl userId="u1" memberName="Sam Smith" tz="UTC" onUndone={onUndone} />);

    await user.selectOptions(await screen.findByLabelText('Restore as'), 'leave');
    await user.type(screen.getByLabelText('Reason (optional)'), 'Wrong Smith');
    await user.click(screen.getByRole('button', { name: /undo drop/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Undo this drop?' });
    expect(dialog).toHaveTextContent('Sam Smith goes back to On Leave');
    await user.click(within(dialog).getByRole('button', { name: 'Undo drop' }));

    await waitFor(() =>
      expect(undoDrop).toHaveBeenCalledWith('u1', { restore_status: 'leave', reason: 'Wrong Smith' })
    );
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it('keeps the drop when the officer backs out', async () => {
    const user = userEvent.setup();
    renderWithRouter(<UndoDropControl userId="u1" memberName="Sam Smith" tz="UTC" onUndone={onUndone} />);

    await user.click(await screen.findByRole('button', { name: /undo drop/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Undo this drop?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep the drop' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Undo this drop?' })).not.toBeInTheDocument());
    expect(undoDrop).not.toHaveBeenCalled();
  });
});
