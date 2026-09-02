import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';

// Only useParams: the page's Breadcrumbs and back link want the real router.
const useParamsMock = vi.fn<() => { id?: string }>();
vi.mock('react-router', async () => ({
  ...(await vi.importActual<typeof import('react-router')>('react-router')),
  useParams: () => useParamsMock(),
}));

const storeState = {
  selectedFacility: null as Record<string, unknown> | null,
  isLoadingDetail: false,
  facilityTypes: [],
  facilityStatuses: [],
  loadFacilityDetail: vi.fn(),
  loadLookupData: vi.fn(),
  archiveFacility: vi.fn(),
  restoreFacility: vi.fn(),
  clearSelectedFacility: vi.fn(),
};

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => storeState,
}));
vi.mock('../hooks/useFacilitiesAccess', () => ({
  useFacilitiesAccess: () => ({
    canManage: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canMaintenance: true,
    canViewSensitive: true,
  }),
}));

const facilityFixture = {
  id: 'f1',
  organizationId: 'org-1',
  name: 'Station 1',
  facilityNumber: 'STN-001',
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

import FacilityDetailPage from './FacilityDetailPage';

describe('FacilityDetailPage — renders only the routed facility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.selectedFacility = null;
    storeState.isLoadingDetail = false;
  });

  it('does not render a facility the route did not ask for', () => {
    // The store is shared and can still hold the previous facility on the
    // first render, before the effect swaps it. Rendering it would put
    // another station's name, address and a working Archive button under
    // this URL.
    useParamsMock.mockReturnValue({ id: 'f2' });
    storeState.selectedFacility = facilityFixture;

    renderWithRouter(<FacilityDetailPage />);

    expect(screen.queryByText('Station 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archive/ })).not.toBeInTheDocument();
  });

  it('renders the facility the route asked for', () => {
    useParamsMock.mockReturnValue({ id: 'f1' });
    storeState.selectedFacility = facilityFixture;

    renderWithRouter(<FacilityDetailPage />);

    expect(screen.getByText('Station 1')).toBeInTheDocument();
  });
});
