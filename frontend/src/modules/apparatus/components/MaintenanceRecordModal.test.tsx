/**
 * The form offers four dates and a "Mark as completed" box with nothing saying
 * which to use for work already done versus work coming up. The Next Due
 * fields also read like a reminder, but only an open record's Due Date reaches
 * the fleet page's Maintenance Due count.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApparatusMaintenance } from '../types';

const mockGetMaintenanceTypes = vi.fn();
const mockCreateRecord = vi.fn();
const mockUpdateRecord = vi.fn();

vi.mock('../services/api', () => ({
  apparatusMaintenanceService: {
    createMaintenanceRecord: (...args: unknown[]) => mockCreateRecord(...args) as unknown,
    updateMaintenanceRecord: (...args: unknown[]) => mockUpdateRecord(...args) as unknown,
  },
  apparatusMaintenanceTypeService: {
    getMaintenanceTypes: (...args: unknown[]) => mockGetMaintenanceTypes(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import { MaintenanceRecordModal } from './MaintenanceRecordModal';

// The app shell mounts ConfirmProvider; the dialog needs it to ask before discarding.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

describe('MaintenanceRecordModal guidance', () => {
  beforeEach(() => {
    mockGetMaintenanceTypes.mockReset();
    mockGetMaintenanceTypes.mockResolvedValue([]);
  });

  it('says which fields to use for done and for upcoming work', async () => {
    render(<MaintenanceRecordModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="a-1" />);
    expect(await screen.findByText(/For work already done, tick Mark as completed/)).toBeInTheDocument();
    expect(screen.getByText(/For upcoming work, leave it unticked and set a Due Date/)).toBeInTheDocument();
  });

  it('says the Next Due fields do not add anything to Maintenance Due', async () => {
    render(<MaintenanceRecordModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="a-1" />);
    expect(await screen.findByText(/They do not add the next service to Maintenance Due/)).toBeInTheDocument();
  });
});

const record = (overrides: Partial<ApparatusMaintenance> = {}): ApparatusMaintenance => ({
  id: 'm-1',
  organizationId: 'org-1',
  apparatusId: 'a-1',
  maintenanceTypeId: 'type-1',
  scheduledDate: '2026-03-01',
  dueDate: '2026-03-15',
  completedDate: '2026-03-10',
  completedBy: null,
  performedBy: 'Jo Rivera',
  isCompleted: true,
  isOverdue: false,
  description: 'Annual pump test',
  workPerformed: 'Tested at draft',
  findings: 'Packing leak',
  mileageAtService: 41200,
  hoursAtService: 1810.5,
  cost: 250.5,
  vendor: 'County Fleet',
  invoiceNumber: 'INV-9',
  nextDueDate: '2027-03-01',
  nextDueMileage: 46000,
  nextDueHours: 1900,
  notes: 'Order new packing',
  createdBy: null,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  ...overrides,
});

const renderModal = (editRecord: ApparatusMaintenance | null = null) =>
  render(
    <MaintenanceRecordModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="a-1" editRecord={editRecord} />
  );

/**
 * The update endpoint dumps its payload with `exclude_unset`, so an omitted
 * key means "leave this alone". Edit used to reuse the create payload, which
 * drops blank fields — an emptied box kept its old value behind a success
 * toast (CLAUDE.md pitfall #1).
 */
describe('MaintenanceRecordModal payloads', () => {
  beforeEach(() => {
    mockGetMaintenanceTypes.mockReset();
    mockGetMaintenanceTypes.mockResolvedValue([{ id: 'type-1', name: 'Pump test' }]);
    mockCreateRecord.mockReset();
    mockCreateRecord.mockResolvedValue({});
    mockUpdateRecord.mockReset();
    mockUpdateRecord.mockResolvedValue({});
  });

  it('sends an explicit null for every field emptied on edit, and the rest unchanged', async () => {
    const user = userEvent.setup();
    renderModal(record());

    await screen.findByRole('option', { name: 'Pump test' });
    await user.clear(screen.getByDisplayValue('Jo Rivera'));
    await user.clear(screen.getByDisplayValue('250.5'));
    await user.clear(screen.getByDisplayValue('2026-03-15'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mockUpdateRecord).toHaveBeenCalledWith('m-1', {
      maintenanceTypeId: 'type-1',
      isCompleted: true,
      scheduledDate: '2026-03-01',
      dueDate: null,
      completedDate: '2026-03-10',
      performedBy: null,
      description: 'Annual pump test',
      workPerformed: 'Tested at draft',
      findings: 'Packing leak',
      mileageAtService: 41200,
      hoursAtService: 1810.5,
      cost: null,
      vendor: 'County Fleet',
      invoiceNumber: 'INV-9',
      nextDueDate: '2027-03-01',
      nextDueMileage: 46000,
      nextDueHours: 1900,
      notes: 'Order new packing',
    });
  });

  it('leaves a blank completed date to the server when an open record is marked completed', async () => {
    // The backend stamps the department's today on the open -> completed
    // transition, and a null in the same payload would overwrite that stamp.
    const user = userEvent.setup();
    renderModal(record({ isCompleted: false, completedDate: null }));

    await screen.findByRole('option', { name: 'Pump test' });
    await user.click(screen.getByRole('checkbox', { name: 'Mark as completed' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const payload: unknown = mockUpdateRecord.mock.calls[0]?.[1];
    expect(payload).toMatchObject({ isCompleted: true });
    expect(payload).not.toHaveProperty('completedDate');
  });

  it('still omits blank fields on create', async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole('option', { name: 'Pump test' });
    await user.selectOptions(screen.getByRole('combobox'), 'type-1');
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    expect(mockCreateRecord).toHaveBeenCalledWith({
      apparatusId: 'a-1',
      maintenanceTypeId: 'type-1',
      isCompleted: false,
    });
  });
});

describe('MaintenanceRecordModal errors and discarding', () => {
  beforeEach(() => {
    mockGetMaintenanceTypes.mockReset();
    mockGetMaintenanceTypes.mockResolvedValue([{ id: 'type-1', name: 'Pump test' }]);
    mockCreateRecord.mockReset();
    mockCreateRecord.mockResolvedValue({});
    mockUpdateRecord.mockReset();
    mockUpdateRecord.mockResolvedValue({});
    vi.mocked(toast.error).mockClear();
  });

  const tooLong = (field: string) => ({
    response: { status: 422, data: { detail: [{ field, message: 'Value is too long.' }] } },
  });

  it('puts a refusal of a new record on its field, announced, and creates nothing', async () => {
    mockCreateRecord.mockRejectedValueOnce(tooLong('invoice_number'));
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole('option', { name: 'Pump test' });
    await user.selectOptions(screen.getByRole('combobox'), 'type-1');
    await user.type(screen.getByLabelText('Invoice Number'), 'INV-1');
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    const invoice = screen.getByLabelText('Invoice Number');
    await waitFor(() =>
      expect(invoice).toHaveAccessibleDescription('Invoice number is too long — keep it to 100 characters.')
    );
    expect(invoice).toHaveAttribute('aria-invalid', 'true');
    expect(mockCreateRecord).toHaveBeenCalledTimes(1);
  });

  it('saves the rest of an edit, keeps the stored value of a refused field and flags it', async () => {
    mockUpdateRecord.mockRejectedValueOnce(tooLong('vendor'));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <MaintenanceRecordModal isOpen onClose={vi.fn()} onSaved={onSaved} apparatusId="a-1" editRecord={record()} />
    );

    await screen.findByRole('option', { name: 'Pump test' });
    await user.clear(screen.getByDisplayValue('County Fleet'));
    await user.type(screen.getByLabelText('Vendor'), 'Too long vendor');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateRecord).toHaveBeenCalledTimes(2));
    const retry = mockUpdateRecord.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(retry).not.toHaveProperty('vendor');
    expect(retry).toMatchObject({ performedBy: 'Jo Rivera', notes: 'Order new packing' });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Vendor')).toHaveAccessibleDescription(
      'Vendor is too long — keep it to 200 characters.'
    );
  });

  it('asks before Escape or Cancel discards what was typed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MaintenanceRecordModal isOpen onClose={onClose} onSaved={vi.fn()} apparatusId="a-1" />);
    await screen.findByRole('option', { name: 'Pump test' });
    await user.type(screen.getByLabelText('Notes'), 'Leak');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
