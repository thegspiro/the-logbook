/**
 * The dashboard's "Compliance deadlines" tile links here as ?compliance=due
 * and says "View filtered results", but the page ignored the parameter, so the
 * click landed on the facilities overview with nothing that matched the count.
 * The broader page behaviour is covered in src/pages/FacilitiesPage.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

const mockGetFacilities = vi.fn();
const mockGetFacilitiesPage = vi.fn();
const mockGetDashboard = vi.fn();
const mockGetComplianceChecklists = vi.fn();

vi.mock('../../../services/api', () => ({
  // Read by the Operations section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  facilitiesService: {
    getFacilities: (...args: unknown[]) => mockGetFacilities(...args) as unknown,
    getFacilitiesPage: (...args: unknown[]) => mockGetFacilitiesPage(...args) as unknown,
    getDashboard: (...args: unknown[]) => mockGetDashboard(...args) as unknown,
    getComplianceChecklists: (...args: unknown[]) => mockGetComplianceChecklists(...args) as unknown,
    getTypes: vi.fn().mockResolvedValue([]),
    getStatuses: vi.fn().mockResolvedValue([]),
    getMaintenanceTypes: vi.fn().mockResolvedValue([]),
  },
}));

import FacilitiesDashboard from './FacilitiesDashboard';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { useAuthStore } from '../../../stores/authStore';

const station = { id: 'fac-1', name: 'Station 1', isArchived: false };
const annex = { id: 'fac-2', name: 'Training Annex', isArchived: false };

const checklist = (overrides: Record<string, unknown>) => ({
  id: 'chk-1',
  facilityId: 'fac-1',
  complianceType: 'fire_code',
  checklistName: 'Annual fire code walk-through',
  dueDate: '2026-11-20',
  isCompleted: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <BrowserRouter>
      <FacilitiesDashboard />
    </BrowserRouter>
  );
}

describe('FacilitiesDashboard ?compliance=due', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFacilities.mockReset();
    mockGetFacilitiesPage.mockReset();
    mockGetDashboard.mockReset();
    mockGetComplianceChecklists.mockReset();
    useFacilitiesStore.setState({ facilities: [], facilitiesTotal: 0, dashboardStats: null, error: null });
    useAuthStore.setState({
      user: { permissions: ['facilities.view', 'facilities.manage'] } as never,
      isAuthenticated: true,
    });
    mockGetFacilities.mockResolvedValue([station, annex]);
    mockGetFacilitiesPage.mockResolvedValue({ items: [station, annex], total: 2, skip: 0, limit: 24 });
    mockGetDashboard.mockResolvedValue({
      totalFacilities: 2,
      operationalFacilities: 2,
      overdueMaintenance: 0,
      upcomingInspections: 0,
      overdueMaintenanceRecords: [],
      upcomingInspectionRecords: [],
      recentMaintenanceCompletions: [],
    });
    mockGetComplianceChecklists.mockResolvedValue([
      checklist({
        id: 'chk-late',
        checklistName: 'ADA ramp survey',
        facilityId: 'fac-2',
        complianceType: 'ada',
        dueDate: '2026-11-28',
      }),
      checklist({ id: 'chk-soon', checklistName: 'Annual fire code walk-through', dueDate: '2026-11-03' }),
    ]);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('asks the server for the open checklists in the tile window', async () => {
    renderAt('/facilities?compliance=due');

    await waitFor(() =>
      expect(mockGetComplianceChecklists).toHaveBeenCalledExactlyOnceWith({
        is_completed: false,
        due_within_days: 30,
        limit: 500,
      })
    );
  });

  it('lists the deadlines the tile counted, soonest first, with their facility', async () => {
    renderAt('/facilities?compliance=due');

    const section = await screen.findByRole('region', { name: /Compliance deadlines in the next 30 days \(2\)/ });
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Annual fire code walk-through');
    expect(rows[0]).toHaveTextContent('Station 1');
    expect(rows[1]).toHaveTextContent('ADA ramp survey');
    expect(rows[1]).toHaveTextContent('Training Annex');
  });

  it('clears the filter from the URL', async () => {
    renderAt('/facilities?compliance=due');

    await userEvent.click(await screen.findByRole('button', { name: 'Hide compliance deadlines' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: /Compliance deadlines/ })).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('says so when nothing is due', async () => {
    mockGetComplianceChecklists.mockResolvedValue([]);
    renderAt('/facilities?compliance=due');

    expect(await screen.findByText('No open compliance checklists are due in the next 30 days.')).toBeInTheDocument();
  });

  it.each(['/facilities', '/facilities?compliance=overdue'])('behaves as before at %s', async (path) => {
    renderAt(path);

    expect(await screen.findByText('Station 1')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Compliance deadlines/ })).not.toBeInTheDocument();
    expect(mockGetComplianceChecklists).not.toHaveBeenCalled();
  });
});
