/**
 * The dashboard's facility "Maintenance due" tile links here as ?status=due
 * (DASH-39). The page used to accept only all/pending/completed/overdue, so the
 * tile's number had no list that agreed with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockUseMaintenanceForm = vi.fn();
let mockStatusFilter = 'all';

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({
    facilities: [{ id: 'fac-1', name: 'Station 1' }],
    loadFacilities: vi.fn(),
    loadLookupData: vi.fn(),
  }),
}));

vi.mock('../hooks/useFacilitiesAccess', () => ({
  useFacilitiesAccess: () => ({ canDelete: false, canMaintenance: false }),
}));

vi.mock('../hooks/useMaintenanceForm', () => ({
  useMaintenanceForm: (options: unknown) => {
    mockUseMaintenanceForm(options);
    return {
      records: [],
      page: 1,
      setPage: vi.fn(),
      total: 0,
      pageSize: 50,
      maintenanceTypes: [],
      isLoading: false,
      loadError: false,
      reload: vi.fn(),
      searchQuery: '',
      setSearchQuery: vi.fn(),
      statusFilter: mockStatusFilter,
      setStatusFilter: vi.fn(),
      showModal: false,
      setShowModal: vi.fn(),
      editingRecord: null,
      isSaving: false,
      formData: {},
      setFormData: vi.fn(),
      openCreate: vi.fn(),
      openEdit: vi.fn(),
      handleSave: vi.fn(),
      handleComplete: vi.fn(),
      handleDelete: vi.fn(),
    };
  },
}));

import MaintenanceListPage from './MaintenanceListPage';

describe('MaintenanceListPage status from the URL', () => {
  beforeEach(() => {
    mockUseMaintenanceForm.mockReset();
    mockStatusFilter = 'all';
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('opens on the due-soon filter the dashboard tile links to, and says what it holds', () => {
    window.history.pushState({}, '', '/facilities/maintenance?status=due');
    mockStatusFilter = 'due';

    renderWithRouter(<MaintenanceListPage />);

    expect(mockUseMaintenanceForm).toHaveBeenLastCalledWith({ initialStatusFilter: 'due' });
    expect(screen.getByRole('button', { name: 'Due soon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Open work due in the next 30 days/)).toBeInTheDocument();
  });

  it('still opens on the overdue filter', () => {
    window.history.pushState({}, '', '/facilities/maintenance?status=overdue');

    renderWithRouter(<MaintenanceListPage />);

    expect(mockUseMaintenanceForm).toHaveBeenLastCalledWith({ initialStatusFilter: 'overdue' });
  });

  it('ignores a status it does not know', () => {
    window.history.pushState({}, '', '/facilities/maintenance?status=soonish');

    renderWithRouter(<MaintenanceListPage />);

    expect(mockUseMaintenanceForm).toHaveBeenLastCalledWith({ initialStatusFilter: 'all' });
    expect(screen.queryByText(/Open work due in the next 30 days/)).not.toBeInTheDocument();
  });
});
