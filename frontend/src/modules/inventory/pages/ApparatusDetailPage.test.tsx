import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { ApparatusDetailPage } from './ApparatusDetailPage';
import type { FleetApparatusReadiness } from '../../../modules/inventory/types/equipmentCheck';

const mockGetFleetReadiness = vi.fn();
const mockGetCheckLog = vi.fn();
const mockGetSupplyExpiringItems = vi.fn();

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getFleetReadiness: (...a: unknown[]) => mockGetFleetReadiness(...a) as unknown,
    getCheckLog: (...a: unknown[]) => mockGetCheckLog(...a) as unknown,
    getSupplyExpiringItems: (...a: unknown[]) => mockGetSupplyExpiringItems(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('./ApparatusInventoryPage', () => ({
  default: ({ apparatusId }: { apparatusId?: string }) => <div>Inventory for {apparatusId}</div>,
}));

vi.mock('./CheckLogPage', () => ({
  default: ({ apparatusId }: { apparatusId?: string }) => <div>Check log for {apparatusId}</div>,
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ apparatusId: 'a-1' }) };
});

const unit: FleetApparatusReadiness = {
  apparatusId: 'a-1',
  unitLabel: 'E-1',
  name: 'Old Reliable',
  apparatusType: 'engine',
  source: 'apparatus',
  readiness: 'attention',
  readinessReason: '1 item failed on the last check.',
  lastCheckAt: '2026-08-16T11:12:00Z',
  lastCheckByName: 'Kelly Moreno',
  failedItemCount: 1,
  outOfServiceItemCount: 0,
  expiringItemCount: 2,
  restockItemCount: 0,
  dueTodayCount: 0,
  overdueCount: 0,
  expected: 10,
  completed: 9,
  completionRate: 90,
  recent: [{ date: '2026-08-16', status: 'failed' }],
  asOf: '2026-08-16',
};

describe('ApparatusDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFleetReadiness.mockResolvedValue({
      generatedAt: '2026-08-16T11:41:00Z',
      expiringWindowDays: 30,
      stripDates: 7,
      apparatus: [unit],
      totals: {
        inService: 0,
        attention: 1,
        outOfService: 0,
        noChecks: 0,
        dueToday: 0,
        overdue: 0,
        openFindings: 1,
        expiringItems: 2,
      },
    });
    mockGetCheckLog.mockResolvedValue({
      windowDates: 14,
      dates: [],
      scope: 'fleet',
      rows: [],
      entries: [],
      summary: {
        expected: 0,
        completed: 0,
        completionRate: null,
        missed: 0,
        withFindings: 0,
        outOfServiceDays: 0,
      },
    });
    mockGetSupplyExpiringItems.mockResolvedValue({ daysAhead: 30, total: 0, items: [] });
  });

  it('heads the page with the unit and its verdict reason', async () => {
    renderWithRouter(<ApparatusDetailPage />);
    expect(await screen.findByRole('heading', { name: 'E-1' })).toBeInTheDocument();
    expect(screen.getByText(/1 item failed on the last check/)).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('takes its readiness from the same source as the fleet board', async () => {
    // Deliberately not a second readiness path — two of them would eventually
    // disagree, and the board and the detail page would contradict each other.
    renderWithRouter(<ApparatusDetailPage />);
    await screen.findByRole('heading', { name: 'E-1' });
    expect(mockGetFleetReadiness).toHaveBeenCalledTimes(1);
  });

  it('scopes the inventory tab to this apparatus', async () => {
    renderWithRouter(<ApparatusDetailPage />);
    await screen.findByRole('heading', { name: 'E-1' });
    await userEvent.click(screen.getByRole('tab', { name: 'Inventory' }));
    expect(screen.getByText('Inventory for a-1')).toBeInTheDocument();
  });

  it('scopes the check log tab to this apparatus', async () => {
    renderWithRouter(<ApparatusDetailPage />);
    await screen.findByRole('heading', { name: 'E-1' });
    await userEvent.click(screen.getByRole('tab', { name: 'Check log' }));
    expect(screen.getByText('Check log for a-1')).toBeInTheDocument();
  });

  it('loads supply only when the findings tab is opened', async () => {
    renderWithRouter(<ApparatusDetailPage />);
    await screen.findByRole('heading', { name: 'E-1' });
    expect(mockGetSupplyExpiringItems).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: /Findings/ }));
    await waitFor(() => {
      expect(mockGetSupplyExpiringItems).toHaveBeenCalledWith(30);
    });
  });

  it('badges the findings tab with what is outstanding', async () => {
    renderWithRouter(<ApparatusDetailPage />);
    await screen.findByRole('heading', { name: 'E-1' });
    // 1 failed + 0 out of service + 2 expiring
    expect(screen.getByRole('tab', { name: /Findings/ })).toHaveTextContent('3');
  });

  it('says so when the apparatus is not in the fleet', async () => {
    mockGetFleetReadiness.mockResolvedValue({
      generatedAt: '2026-08-16T11:41:00Z',
      expiringWindowDays: 30,
      stripDates: 7,
      apparatus: [],
      totals: {
        inService: 0,
        attention: 0,
        outOfService: 0,
        noChecks: 0,
        dueToday: 0,
        overdue: 0,
        openFindings: 0,
        expiringItems: 0,
      },
    });
    renderWithRouter(<ApparatusDetailPage />);
    expect(await screen.findByText('Apparatus not found')).toBeInTheDocument();
  });
});
