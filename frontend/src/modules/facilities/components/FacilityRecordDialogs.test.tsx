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

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getMaintenanceRecords: vi.fn().mockResolvedValue([]),
    getMaintenanceTypes: vi.fn().mockResolvedValue([{ id: 'mt-1', name: 'Roof Inspection' }]),
    getInspections: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MaintenanceSection from './MaintenanceSection';
import InspectionsSection from './InspectionsSection';

describe('facility record dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the maintenance dialog and its fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MaintenanceSection facilityId="f-1" canEdit canDelete />);
    await user.click(await screen.findByRole('button', { name: /New Record/ }));

    const dialog = screen.getByRole('dialog', { name: 'New Maintenance Record' });
    expect(within(dialog).getByRole('textbox', { name: /^Description/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Maintenance Type' })).toBeInTheDocument();
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
});
