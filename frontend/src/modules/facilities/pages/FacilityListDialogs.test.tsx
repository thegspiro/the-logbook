/**
 * The cross-facility Maintenance and Inspections pages (workflow review W49).
 *
 * Their record dialogs were unnamed and every field was announced by its
 * placeholder or by nothing, and the filter strip showed which filter was on
 * by colour alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({
    facilities: [{ id: 'fac-1', name: 'Station 1', isArchived: false }],
    loadFacilities: vi.fn(),
    loadLookupData: vi.fn(),
    maintenanceTypes: [{ id: 'mt-1', name: 'Annual Service' }],
  }),
}));

vi.mock('../hooks/useFacilitiesAccess', () => ({
  useFacilitiesAccess: () => ({ canEdit: true, canDelete: true, canMaintenance: true }),
}));

vi.mock('../hooks/useInspectionForm', () => ({
  useInspectionForm: () => ({
    inspections: [],
    isLoading: false,
    loadError: null,
    reload: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    resultFilter: 'failed',
    setResultFilter: vi.fn(),
    showModal: true,
    setShowModal: vi.fn(),
    editingInspection: null,
    isSaving: false,
    formData: {},
    setFormData: vi.fn(),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    handleSave: vi.fn(),
    handleDelete: vi.fn(),
  }),
}));

vi.mock('../hooks/useMaintenanceForm', () => ({
  useMaintenanceForm: () => ({
    records: [],
    maintenanceTypes: [{ id: 'mt-1', name: 'Annual Service' }],
    isLoading: false,
    loadError: null,
    reload: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    statusFilter: 'overdue',
    setStatusFilter: vi.fn(),
    showModal: true,
    setShowModal: vi.fn(),
    editingRecord: null,
    isSaving: false,
    formData: {},
    setFormData: vi.fn(),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    handleSave: vi.fn(),
    handleDelete: vi.fn(),
    handleComplete: vi.fn(),
  }),
}));

import InspectionsListPage from './InspectionsListPage';
import MaintenanceListPage from './MaintenanceListPage';

describe('the cross-facility record pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the new inspection dialog and its fields', () => {
    renderWithRouter(<InspectionsListPage />);
    const dialog = screen.getByRole('dialog', { name: 'New Inspection' });
    for (const name of [
      /^Facility/,
      /^Title/,
      /^Inspection Date/,
      'Next Inspection Date',
      'Inspector Name',
      'Findings',
    ]) {
      expect(within(dialog).getByLabelText(name)).toBeInTheDocument();
    }
  });

  it('marks the inspection result filter that is on', () => {
    renderWithRouter(<InspectionsListPage />);
    expect(screen.getByRole('button', { name: 'Failed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names the new maintenance dialog and its fields', () => {
    renderWithRouter(<MaintenanceListPage />);
    const dialog = screen.getByRole('dialog', { name: 'New Maintenance Record' });
    for (const name of [/^Facility/, /^Description/, 'Due Date', 'Vendor', 'Cost ($)', 'Notes']) {
      expect(within(dialog).getByLabelText(name)).toBeInTheDocument();
    }
  });

  it('marks the maintenance status filter that is on', () => {
    renderWithRouter(<MaintenanceListPage />);
    expect(screen.getByRole('button', { name: 'Overdue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'false');
  });
});
