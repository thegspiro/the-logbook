/**
 * The facility maintenance and inspection dialogs name themselves and their
 * fields (workflow review W49-4).
 *
 * Both dialogs were announced as a bare "dialog", and every label sat beside
 * its field without naming it: the description was known by its placeholder,
 * the type and result selects, the dates and the cost by nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetMaintenanceRecords = vi.fn();
const mockCreateMaintenanceRecord = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getMaintenanceRecords: (...args: unknown[]) => mockGetMaintenanceRecords(...args) as unknown,
    getMaintenanceTypes: vi.fn().mockResolvedValue([{ id: 'mt-1', name: 'Roof Inspection' }]),
    createMaintenanceRecord: (...args: unknown[]) => mockCreateMaintenanceRecord(...args) as unknown,
    getInspections: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

import MaintenanceSection from './MaintenanceSection';
import InspectionsSection from './InspectionsSection';

describe('facility record dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMaintenanceRecords.mockReset();
    mockGetMaintenanceRecords.mockResolvedValue([]);
    mockCreateMaintenanceRecord.mockReset();
    mockCreateMaintenanceRecord.mockResolvedValue({});
  });

  it('names the maintenance dialog and its fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MaintenanceSection facilityId="f-1" canEdit canDelete />);
    await user.click(await screen.findByRole('button', { name: /New Record/ }));

    const dialog = screen.getByRole('dialog', { name: 'New Maintenance Record' });
    expect(within(dialog).getByRole('textbox', { name: /^Description/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: /^Maintenance Type/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Due Date')).toHaveAttribute('type', 'date');
    expect(within(dialog).getByRole('spinbutton', { name: 'Cost ($)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Work Order #' })).toBeInTheDocument();
  });

  it('names the inspection dialog and its fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InspectionsSection facilityId="f-1" canEdit canDelete />);
    await user.click(await screen.findByRole('button', { name: /New Inspection/ }));

    const dialog = screen.getByRole('dialog', { name: 'New Inspection' });
    expect(within(dialog).getByRole('textbox', { name: /^Title/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Result' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Inspection Date/)).toHaveAttribute('type', 'date');
    expect(within(dialog).getByRole('textbox', { name: 'Findings' })).toBeInTheDocument();
  });

  // The section sits inside a `card`, whose backdrop blur captured the fixed
  // overlay: the dialog laid out inside the card and its title hung above the
  // top of the screen. Portalled, it is a child of the body like every other.
  it.each([
    ['maintenance', () => <MaintenanceSection facilityId="f-1" canEdit canDelete />, /New Record/],
    ['inspection', () => <InspectionsSection facilityId="f-1" canEdit canDelete />, /New Inspection/],
  ])('renders the %s dialog outside the section', async (_, ui, button) => {
    const user = userEvent.setup();
    const { container } = renderWithRouter(ui());
    await user.click(await screen.findByRole('button', { name: button }));

    const dialog = screen.getByRole('dialog');
    expect(container).not.toContainElement(dialog);
  });

  it('marks the maintenance type required and asks for it before saving', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MaintenanceSection facilityId="f-1" canEdit canDelete />);
    await user.click(await screen.findByRole('button', { name: /New Record/ }));
    const dialog = screen.getByRole('dialog', { name: 'New Maintenance Record' });

    expect(within(dialog).getByRole('combobox', { name: 'Maintenance Type *' })).toBeRequired();
    await user.type(within(dialog).getByRole('textbox', { name: /^Description/ }), 'Replace bay door seal');
    await user.click(within(dialog).getByRole('button', { name: 'Create Record' }));

    expect(mockToastError).toHaveBeenCalledWith('Choose a maintenance type');
    expect(mockCreateMaintenanceRecord).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a save is refused", async () => {
    mockCreateMaintenanceRecord.mockRejectedValue(new Error('Due date cannot be before the scheduled date'));
    const user = userEvent.setup();
    renderWithRouter(<MaintenanceSection facilityId="f-1" canEdit canDelete />);
    await user.click(await screen.findByRole('button', { name: /New Record/ }));
    const dialog = screen.getByRole('dialog', { name: 'New Maintenance Record' });

    await user.type(within(dialog).getByRole('textbox', { name: /^Description/ }), 'Replace bay door seal');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Maintenance Type/ }), 'mt-1');
    await user.click(within(dialog).getByRole('button', { name: 'Create Record' }));

    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Due date cannot be before the scheduled date'));
  });

  it('says on the row when a record is overdue, and when it was due', async () => {
    mockGetMaintenanceRecords.mockResolvedValue([
      {
        id: 'm-1',
        facilityId: 'f-1',
        description: 'Replace bay door seal',
        dueDate: '2026-10-06',
        isCompleted: false,
        isOverdue: true,
      },
      {
        id: 'm-2',
        facilityId: 'f-1',
        description: 'Change HVAC filters',
        dueDate: '2026-11-02',
        isCompleted: false,
        isOverdue: false,
      },
      {
        id: 'm-3',
        facilityId: 'f-1',
        description: 'Generator load test',
        completedDate: '2026-10-01',
        isCompleted: true,
        isOverdue: false,
      },
    ]);
    renderWithRouter(<MaintenanceSection facilityId="f-1" canEdit canDelete />);

    expect(await screen.findByText('Overdue · due 10/6/2026')).toBeInTheDocument();
    expect(screen.getByText('Due 11/2/2026')).toBeInTheDocument();
    expect(screen.getByText('Completed 10/1/2026')).toBeInTheDocument();
  });
});
