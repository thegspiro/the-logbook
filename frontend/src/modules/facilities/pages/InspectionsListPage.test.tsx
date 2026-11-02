/**
 * Tests for the cross-facility inspections list.
 *
 * The inspecting organization is asked for on the form and is one of the
 * fields search matches — but no row rendered it, so a record found by typing
 * "Commonwealth Mutual" named that firm nowhere on the result.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockLoadFacilities = vi.fn();
const mockUseInspectionForm = vi.fn();
const mockSetPage = vi.fn();
let mockInspections: Record<string, unknown>[] = [];

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({
    facilities: [{ id: 'fac-1', name: 'Station 1 - Headquarters' }],
    loadFacilities: mockLoadFacilities,
  }),
}));

vi.mock('../hooks/useInspectionForm', () => ({
  useInspectionForm: (options: unknown) => {
    mockUseInspectionForm(options);
    return {
      inspections: mockInspections,
      setPage: mockSetPage,
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
    };
  },
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

// The dashboard's "Upcoming inspections" tile links here as ?dueWithin=30 and
// says "View filtered results"; the list used to ignore it.
describe('InspectionsListPage dueWithin filter', () => {
  beforeEach(() => {
    mockInspections = [inspection({ title: 'Annual sprinkler test', nextInspectionDate: '2026-11-15' })];
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('asks for the window the tile counted and says so', () => {
    window.history.pushState({}, '', '/facilities/inspections?dueWithin=30');

    renderWithRouter(<InspectionsListPage />);

    expect(mockUseInspectionForm).toHaveBeenLastCalledWith({ dueWithinDays: 30 });
    expect(screen.getByText(/Showing only inspections next due in the next 30 days/)).toBeInTheDocument();
    expect(screen.getByText('Annual sprinkler test')).toBeInTheDocument();
  });

  it('clears the window from the URL and returns to the first page', async () => {
    window.history.pushState({}, '', '/facilities/inspections?dueWithin=30');
    renderWithRouter(<InspectionsListPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Show all inspections' }));

    await waitFor(() => expect(mockUseInspectionForm).toHaveBeenLastCalledWith({ dueWithinDays: undefined }));
    expect(mockSetPage).toHaveBeenCalledExactlyOnceWith(1);
    expect(window.location.search).toBe('');
    expect(screen.queryByText(/Showing only inspections/)).not.toBeInTheDocument();
  });

  it.each(['', 'soon', '-5', '400'])('ignores dueWithin=%s', (value) => {
    window.history.pushState({}, '', `/facilities/inspections?dueWithin=${value}`);

    renderWithRouter(<InspectionsListPage />);

    expect(mockUseInspectionForm).toHaveBeenLastCalledWith({ dueWithinDays: undefined });
    expect(screen.queryByText(/Showing only inspections/)).not.toBeInTheDocument();
  });

  it('behaves as before with no parameter', () => {
    renderWithRouter(<InspectionsListPage />);

    expect(mockUseInspectionForm).toHaveBeenLastCalledWith({ dueWithinDays: undefined });
    expect(screen.queryByRole('button', { name: 'Show all inspections' })).not.toBeInTheDocument();
  });
});
