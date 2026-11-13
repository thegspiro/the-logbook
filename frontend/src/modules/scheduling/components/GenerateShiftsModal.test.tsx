import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ShiftPattern } from './shiftTemplateTypes';

const generateShiftsFromPattern = vi.fn();
vi.mock('../services/api', () => ({
  schedulingService: {
    generateShiftsFromPattern: (...args: unknown[]) => generateShiftsFromPattern(...args) as unknown,
  },
}));

import GenerateShiftsModal from './GenerateShiftsModal';

const pattern = { id: 'pat-1', name: '24/48 Rotation', pattern_type: 'platoon' } as ShiftPattern;

describe('GenerateShiftsModal', () => {
  beforeEach(() => {
    generateShiftsFromPattern.mockReset();
    generateShiftsFromPattern.mockResolvedValue({ shifts_created: 0 });
  });

  it('puts a server refusal on the date it names, not the API key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    generateShiftsFromPattern.mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'end_date', message: 'Invalid date format.' }] } },
    });
    renderWithRouter(<GenerateShiftsModal isOpen onClose={onClose} pattern={pattern} />);

    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: '2027-01-01' } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: '2027-01-31' } });
    await user.click(screen.getByRole('button', { name: 'Generate Shifts' }));

    const end = screen.getByLabelText(/^End Date/);
    await waitFor(() => expect(end).toHaveAccessibleDescription('End date needs a valid date.'));
    expect(end).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/end_date/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before Cancel discards a chosen range', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<GenerateShiftsModal isOpen onClose={onClose} pattern={pattern} />);

    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: '2027-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Start Date/)).toHaveValue('2027-01-01');
  });

  it('closes at once when nothing was entered', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<GenerateShiftsModal isOpen onClose={onClose} pattern={pattern} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
