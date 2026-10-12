import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { EditLeaveDialog, type EditableLeave } from './EditLeaveDialog';

const updateLeaveOfAbsence = vi.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>();

vi.mock('../../services/api', () => ({
  memberStatusService: {
    updateLeaveOfAbsence: (id: string, data: Record<string, unknown>) => updateLeaveOfAbsence(id, data),
  },
}));

const leave: EditableLeave = {
  id: 'leave-1',
  member_name: 'Ian Two',
  start_date: '2026-10-01',
  end_date: '2026-12-31',
  reason: 'Surgery recovery',
};

describe('EditLeaveDialog', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    updateLeaveOfAbsence.mockReset();
    updateLeaveOfAbsence.mockResolvedValue({});
    onClose.mockReset();
    onSaved.mockReset();
  });

  it('opens on the leave it was given', () => {
    renderWithRouter(<EditLeaveDialog leave={leave} onClose={onClose} onSaved={onSaved} />);

    expect(screen.getByRole('dialog', { name: 'Edit leave — Ian Two' })).toBeInTheDocument();
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-12-31');
    expect(screen.getByLabelText('Reason (optional)')).toHaveValue('Surgery recovery');
  });

  it('sends every field it owns, with explicit nulls for a cleared end and reason', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditLeaveDialog leave={leave} onClose={onClose} onSaved={onSaved} />);

    await user.click(screen.getByLabelText('Permanent (no end date)'));
    await user.clear(screen.getByLabelText('Reason (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save leave' }));

    await waitFor(() =>
      expect(updateLeaveOfAbsence).toHaveBeenCalledWith('leave-1', {
        start_date: '2026-10-01',
        end_date: null,
        reason: null,
      })
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses an end before the start without calling the server', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditLeaveDialog leave={leave} onClose={onClose} onSaved={onSaved} />);

    const end = screen.getByLabelText('End date');
    await user.clear(end);
    await user.type(end, '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Save leave' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The end date must be on or after the start date.');
    expect(updateLeaveOfAbsence).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    const user = userEvent.setup();
    updateLeaveOfAbsence.mockRejectedValueOnce(new Error('end_date must be on or after start_date'));
    renderWithRouter(<EditLeaveDialog leave={leave} onClose={onClose} onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Save leave' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('end_date must be on or after start_date');
    expect(onClose).not.toHaveBeenCalled();
  });
});
