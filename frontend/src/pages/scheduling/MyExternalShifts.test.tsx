import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { MyExternalShifts } from './MyExternalShifts';
import type { ExternalAgency, ExternalShiftEntry } from '../../modules/scheduling/services/api';

const mockGetMine = vi.fn();
const mockLog = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockOptions = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyExternalShifts: (...args: unknown[]) => mockGetMine(...args) as unknown,
    logExternalShift: (...args: unknown[]) => mockLog(...args) as unknown,
    updateExternalShift: (...args: unknown[]) => mockUpdate(...args) as unknown,
    deleteExternalShift: (...args: unknown[]) => mockDelete(...args) as unknown,
    getExternalApparatusOptions: (...args: unknown[]) => mockOptions(...args) as unknown,
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
  external_apparatus_id: 'u-42',
  agency_name: 'Township Fire Company',
  apparatus_name: 'Engine 42',
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

const agencies: ExternalAgency[] = [
  {
    id: 'a-township',
    name: 'Township Fire Company',
    is_active: true,
    apparatus: [
      { id: 'u-42', agency_id: 'a-township', name: 'Engine 42', apparatus_type: 'engine', is_active: true },
      { id: 'u-7', agency_id: 'a-township', name: 'Tower 7', apparatus_type: null, is_active: true },
    ],
  },
  {
    id: 'a-county',
    name: 'County Rescue',
    is_active: true,
    apparatus: [{ id: 'u-9', agency_id: 'a-county', name: 'Rescue 9', apparatus_type: null, is_active: true }],
  },
];

describe('MyExternalShifts', () => {
  const onChanged = vi.fn();

  beforeEach(() => {
    mockGetMine.mockReset();
    mockLog.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockOptions.mockReset();
    onChanged.mockReset();
    mockOptions.mockResolvedValue({ agencies });
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

  it('logs a shift on a unit picked from the list, leaving blank optional fields out', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    const dateInput = screen.getByLabelText('Date');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-01-10');
    await user.type(screen.getByLabelText('Hours'), '10.5');
    await user.selectOptions(await screen.findByLabelText('Department'), 'a-county');
    await user.selectOptions(screen.getByLabelText('Apparatus'), 'u-9');
    await user.click(screen.getByRole('button', { name: 'Log shift' }));

    await waitFor(() => expect(mockLog).toHaveBeenCalledTimes(1));
    expect(mockLog).toHaveBeenCalledWith({
      shift_date: '2026-01-10',
      hours: 10.5,
      external_apparatus_id: 'u-9',
      role: undefined,
      notes: undefined,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers only the chosen department’s apparatus, and cannot save without one', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));
    await user.type(screen.getByLabelText('Hours'), '8');
    await user.selectOptions(await screen.findByLabelText('Department'), 'a-township');

    const unitSelect = screen.getByLabelText('Apparatus');
    expect(within(unitSelect).getByRole('option', { name: 'Engine 42 (engine)' })).toBeInTheDocument();
    expect(within(unitSelect).getByRole('option', { name: 'Tower 7' })).toBeInTheDocument();
    expect(within(unitSelect).queryByRole('option', { name: 'Rescue 9' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log shift' })).toBeDisabled();
  });

  it('tells the member who can add a missing unit when the list is empty', async () => {
    mockGetMine.mockResolvedValue({ items: [], total: 0 });
    mockOptions.mockResolvedValue({ agencies: [] });
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Log outside shift' }));

    expect(
      await screen.findByText(/No outside apparatus has been set up yet\. Don't see it\? Ask a scheduling officer/)
    ).toBeInTheDocument();
  });

  it('sends null for an optional field the member cleared on edit', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    await waitFor(() => expect(screen.getByLabelText('Apparatus')).toHaveValue('u-42'));
    await user.clear(screen.getByLabelText(/Notes/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    // The unit is unchanged, so it stays off the wire.
    expect(mockUpdate).toHaveBeenCalledWith('e1', {
      shift_date: '2026-03-04',
      hours: 12,
      role: null,
      notes: null,
    });
  });

  it('sends the new unit when the member moves an entry to another one', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    await waitFor(() => expect(screen.getByLabelText('Apparatus')).toHaveValue('u-42'));
    await user.selectOptions(screen.getByLabelText('Apparatus'), 'u-7');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ external_apparatus_id: 'u-7' }));
  });

  it('keeps a unit that has left the list as the entry’s current value', async () => {
    mockGetMine.mockResolvedValue({
      items: [entry({ external_apparatus_id: null, apparatus_name: 'Engine 1' })],
      total: 1,
    });
    const user = userEvent.setup();
    renderWithRouter(<MyExternalShifts onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: /Edit shift with Township Fire Company/ }));
    expect(await screen.findByRole('option', { name: 'Engine 1 (no longer listed)' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Hours'));
    await user.type(screen.getByLabelText('Hours'), '9');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('e1', {
      shift_date: '2026-03-04',
      hours: 9,
      role: null,
      notes: 'Covered a sick call',
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
