import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { MyExternalShifts } from './MyExternalShifts';
import type { ExternalShiftEntry } from '../../modules/scheduling/services/api';

const mockGetMine = vi.fn();
const mockLog = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyExternalShifts: (...args: unknown[]) => mockGetMine(...args) as unknown,
    logExternalShift: (...args: unknown[]) => mockLog(...args) as unknown,
    updateExternalShift: (...args: unknown[]) => mockUpdate(...args) as unknown,
    deleteExternalShift: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const entry = (over: Partial<ExternalShiftEntry> = {}): ExternalShiftEntry => ({
  id: 'e1',
  user_id: 'u1',
  member_name: 'Casey Reed',
  shift_date: '2026-03-04',
  hours: 12,
  agency_name: 'Township Fire Company',
  apparatus: 'Engine 42',
  role: null,
  notes: 'Covered a sick call',
  status: 'counted',
  reviewed_by: null,
  reviewer_name: null,
  reviewed_at: null,
  rejection_reason: null,
  created_at: '2026-03-05T12:00:00Z',
  updated_at: '2026-03-05T12:00:00Z',
  ...over,
});

describe('MyExternalShifts', () => {
  const onChanged = vi.fn();

  beforeEach(() => {
    mockGetMine.mockReset();
    mockLog.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    onChanged.mockReset();
    mockGetMine.mockResolvedValue({ items: [entry()], total: 1 });
    mockLog.mockResolvedValue(entry({ id: 'e2' }));
    mockUpdate.mockResolvedValue(entry());
    mockDelete.mockResolvedValue(undefined);
  });

  it('lists the member’s entries', async () => {
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    expect(await screen.findByText('Township Fire Company')).toBeInTheDocument();
    expect(screen.getByText(/Mar 4, 2026 · 12 hrs · Engine 42/)).toBeInTheDocument();
    expect(mockGetMine).toHaveBeenCalledWith({ limit: 100 });
  });

  it('logs a shift, leaving blank optional fields out of the payload', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    const dateInput = screen.getByLabelText('Date');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-01-10');
    await user.type(screen.getByLabelText('Hours'), '10.5');
    await user.type(screen.getByLabelText('Department or agency'), '  County Rescue  ');
    await user.click(screen.getByRole('button', { name: 'Log shift' }));

    await waitFor(() => expect(mockLog).toHaveBeenCalledTimes(1));
    expect(mockLog).toHaveBeenCalledWith({
      shift_date: '2026-01-10',
      hours: 10.5,
      agency_name: 'County Rescue',
      apparatus: undefined,
      role: undefined,
      notes: undefined,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('sends null for an optional field the member cleared on edit', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    await user.clear(screen.getByLabelText(/Notes/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('e1', {
      shift_date: '2026-03-04',
      hours: 12,
      agency_name: 'Township Fire Company',
      apparatus: 'Engine 42',
      role: null,
      notes: null,
    });
  });

  it('deletes only after the member confirms', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: /Delete shift with Township Fire Company/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this shift?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete shift' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('e1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a rejected entry as not counted, with the reason and no actions', async () => {
    mockGetMine.mockResolvedValue({
      items: [entry({ status: 'rejected', rejection_reason: 'Not on the mutual aid roster' })],
      total: 1,
    });
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    expect(await screen.findByText('Not counted')).toBeInTheDocument();
    expect(screen.getByText('Not on the mutual aid roster')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete shift/ })).not.toBeInTheDocument();
  });
});
