/**
 * FAC2-8: editing a record from the cross-facility Maintenance list offered a
 * Facility picker. The update schema has no facility_id, so the server dropped
 * the change and answered "Record updated" while the record stayed where it
 * was. The picker is for choosing a facility on create; on edit the record's
 * facility is shown, not offered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { MaintenanceRecord } from '../types';

const record: MaintenanceRecord = {
  id: 'rec-1',
  facilityId: 'fac-2',
  maintenanceTypeId: 'mt-1',
  isCompleted: false,
  description: 'Replace bay door seal',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({
    facilities: [
      { id: 'fac-1', name: 'Station 1', isArchived: false },
      { id: 'fac-2', name: 'Old Station', isArchived: true },
    ],
    loadFacilities: vi.fn(),
    loadLookupData: vi.fn(),
  }),
}));
vi.mock('../hooks/useFacilitiesAccess', () => ({
  useFacilitiesAccess: () => ({ canDelete: true, canMaintenance: true }),
}));
vi.mock('../../../services/api', () => ({
  // Read by the Operations section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn(() => Promise.resolve({ configured: false, enabled_modules: [] })),
  },
  facilitiesService: {
    getMaintenancePage: vi.fn(() => Promise.resolve({ items: [record], total: 1, skip: 0, limit: 50 })),
    getMaintenanceTypes: vi.fn(() => Promise.resolve([{ id: 'mt-1', name: 'Door' }])),
    updateMaintenanceRecord: vi.fn(),
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import MaintenanceListPage from './MaintenanceListPage';

describe('MaintenanceListPage editing a record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the record’s facility instead of offering to move it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MaintenanceListPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit record' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit Maintenance Record' });
    expect(within(dialog).queryByRole('combobox', { name: /^Facility/ })).not.toBeInTheDocument();
    // An archived facility, which the create picker leaves out, still names the record.
    expect(within(dialog).getByText('Old Station')).toBeInTheDocument();
  });

  it('still offers the picker when creating', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MaintenanceListPage />);
    await user.click(await screen.findByRole('button', { name: /New Record/ }));

    const dialog = await screen.findByRole('dialog', { name: 'New Maintenance Record' });
    expect(within(dialog).getByRole('combobox', { name: /^Facility/ })).toBeInTheDocument();
  });
});
