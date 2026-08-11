/**
 * Tests for the cross-facility inspections list.
 *
 * The inspecting organization is asked for on the form and is one of the
 * fields search matches — but no row rendered it, so a record found by typing
 * "Commonwealth Mutual" named that firm nowhere on the result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockLoadFacilities = vi.fn();
let mockInspections: Record<string, unknown>[] = [];

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({
    facilities: [{ id: 'fac-1', name: 'Station 1 - Headquarters' }],
    loadFacilities: mockLoadFacilities,
  }),
}));

vi.mock('../hooks/useInspectionForm', () => ({
  useInspectionForm: () => ({
    inspections: mockInspections,
    isLoading: false,
    loadError: null,
    reload: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    resultFilter: 'all',
    setResultFilter: vi.fn(),
    showModal: false,
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

import InspectionsListPage from './InspectionsListPage';

const inspection = (overrides: Record<string, unknown> = {}) => ({
  id: 'insp-1',
  facilityId: 'fac-1',
  title: 'Insurance Loss-Control Survey',
  inspectionType: 'insurance',
  inspectionDate: '2026-07-17T00:00:00Z',
  passed: false,
  inspectorName: 'R. Alvarez',
  inspectorOrganization: 'Commonwealth Mutual',
  ...overrides,
});

describe('InspectionsListPage', () => {
  beforeEach(() => {
    mockInspections = [inspection()];
    vi.clearAllMocks();
  });

  it('names the inspecting organization alongside the inspector', () => {
    renderWithRouter(<InspectionsListPage />);

    expect(screen.getByText(/R\. Alvarez · Commonwealth Mutual/)).toBeInTheDocument();
  });

  it('shows the organization on its own when no inspector is named', () => {
    mockInspections = [inspection({ inspectorName: undefined })];

    renderWithRouter(<InspectionsListPage />);

    expect(screen.getByText('Commonwealth Mutual')).toBeInTheDocument();
  });

  it('shows the inspector alone when no organization is recorded', () => {
    mockInspections = [inspection({ inspectorOrganization: undefined })];

    renderWithRouter(<InspectionsListPage />);

    expect(screen.getByText('R. Alvarez')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});
