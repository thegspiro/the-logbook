import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { FleetBoardPage } from './FleetBoardPage';
import type { FleetApparatusReadiness, FleetReadinessResponse } from '../../modules/scheduling/types/equipmentCheck';

const mockGetFleetReadiness = vi.fn();
const mockGetMyChecklists = vi.fn();

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getFleetReadiness: (...a: unknown[]) => mockGetFleetReadiness(...a) as unknown,
    getMyChecklists: (...a: unknown[]) => mockGetMyChecklists(...a) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../../hooks/useRegisterPullToRefresh', () => ({
  useRegisterPullToRefresh: () => undefined,
}));

const mockCheckPermission = vi.fn(() => true);
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: mockCheckPermission }),
}));

function makeUnit(overrides: Partial<FleetApparatusReadiness> = {}): FleetApparatusReadiness {
  return {
    apparatusId: 'a-1',
    unitLabel: 'E-1',
    apparatusType: 'engine',
    source: 'apparatus',
    readiness: 'in_service',
    readinessReason: 'Checks current, nothing outstanding.',
    failedItemCount: 0,
    outOfServiceItemCount: 0,
    expiringItemCount: 0,
    restockItemCount: 0,
    dueTodayCount: 0,
    overdueCount: 0,
    expected: 7,
    completed: 7,
    completionRate: 100,
    recent: [
      { date: '2026-08-15', status: 'passed' },
      { date: '2026-08-16', status: 'passed' },
    ],
    asOf: '2026-08-16',
    ...overrides,
  };
}

function makeResponse(apparatus: FleetApparatusReadiness[]): FleetReadinessResponse {
  return {
    generatedAt: '2026-08-16T11:41:00Z',
    expiringWindowDays: 30,
    stripDates: 7,
    apparatus,
    totals: {
      inService: apparatus.filter((a) => a.readiness === 'in_service').length,
      attention: apparatus.filter((a) => a.readiness === 'attention').length,
      outOfService: apparatus.filter((a) => a.readiness === 'out_of_service').length,
      noChecks: apparatus.filter((a) => a.readiness === 'no_checks').length,
      dueToday: 0,
      overdue: 0,
      openFindings: 0,
      expiringItems: 0,
    },
  };
}

describe('FleetBoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(true);
    mockGetFleetReadiness.mockResolvedValue(makeResponse([makeUnit()]));
    mockGetMyChecklists.mockResolvedValue([]);
  });

  it('renders an apparatus card keyed by its unit number', async () => {
    renderWithRouter(<FleetBoardPage />);
    // Scoped to the card: "In service" is also a summary-tile label above it.
    const card = await screen.findByRole('link', { name: /E-1/ });
    expect(within(card).getByText('E-1')).toBeInTheDocument();
    expect(within(card).getByText('In service')).toBeInTheDocument();
  });

  it('always shows the reason behind the readiness verdict', async () => {
    // The pill is a claim the app makes on the department's behalf; an officer
    // who disagrees has to be able to see what drove it.
    mockGetFleetReadiness.mockResolvedValue(
      makeResponse([
        makeUnit({
          readiness: 'out_of_service',
          readinessReason: '1 item marked out of service on the last check.',
          outOfServiceItemCount: 1,
        }),
      ])
    );
    renderWithRouter(<FleetBoardPage />);
    const card = await screen.findByRole('link', { name: /E-1/ });
    expect(within(card).getByText('1 item marked out of service on the last check.')).toBeInTheDocument();
    expect(within(card).getByText('Out of service')).toBeInTheDocument();
  });

  it('links each card to that apparatus', async () => {
    renderWithRouter(<FleetBoardPage />);
    const link = await screen.findByRole('link', { name: /E-1/ });
    expect(link).toHaveAttribute('href', '/scheduling/equipment/a-1');
  });

  it('shows an em dash rather than 0% when nothing was owed', async () => {
    // Every occasion was out of service or not yet due. "0%" would accuse a
    // crew of missing checks that were never theirs to do.
    mockGetFleetReadiness.mockResolvedValue(
      makeResponse([makeUnit({ completionRate: null, expected: 0, completed: 0 })])
    );
    renderWithRouter(<FleetBoardPage />);
    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('surfaces overdue checks in the member strip', async () => {
    mockGetMyChecklists.mockResolvedValue([
      {
        shiftId: 's-1',
        shiftDate: '2026-08-11',
        apparatusName: 'E-2',
        templateId: 't-1',
        templateName: 'Engine Daily Check',
        checkTiming: 'start_of_shift',
        status: 'not_started',
      },
    ]);
    renderWithRouter(<FleetBoardPage />);
    expect(await screen.findByText('You have 1 check waiting')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
  });

  it('leaves future checks out of the member strip', async () => {
    // A check due next week is not waiting on anyone yet — putting it in the
    // strip is exactly the noise the old card grid had.
    mockGetMyChecklists.mockResolvedValue([
      {
        shiftId: 's-9',
        shiftDate: '2099-01-01',
        apparatusName: 'E-1',
        templateId: 't-1',
        templateName: 'Engine Daily Check',
        checkTiming: 'start_of_shift',
        status: 'not_started',
      },
    ]);
    renderWithRouter(<FleetBoardPage />);
    await screen.findByText('E-1');
    expect(screen.queryByText(/check waiting/)).not.toBeInTheDocument();
  });

  it('opens the member checklist view when the strip is pressed', async () => {
    const onOpenMyChecks = vi.fn();
    mockGetMyChecklists.mockResolvedValue([
      {
        shiftId: 's-1',
        shiftDate: '2026-08-11',
        apparatusName: 'E-2',
        templateId: 't-1',
        templateName: 'Engine Daily Check',
        checkTiming: 'start_of_shift',
        status: 'not_started',
      },
    ]);
    renderWithRouter(<FleetBoardPage onOpenMyChecks={onOpenMyChecks} />);
    await userEvent.click(await screen.findByText('You have 1 check waiting'));
    expect(onOpenMyChecks).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when the department has no apparatus', async () => {
    mockGetFleetReadiness.mockResolvedValue(makeResponse([]));
    renderWithRouter(<FleetBoardPage />);
    expect(await screen.findByText(/No apparatus found/)).toBeInTheDocument();
  });

  it('requests readiness and the member checklists once each', async () => {
    renderWithRouter(<FleetBoardPage />);
    await waitFor(() => {
      expect(mockGetFleetReadiness).toHaveBeenCalledTimes(1);
    });
    expect(mockGetMyChecklists).toHaveBeenCalledTimes(1);
  });

  it('hides the template link from someone who cannot manage them', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<FleetBoardPage />);
    await screen.findByText('E-1');
    expect(screen.queryByRole('link', { name: /Templates/ })).not.toBeInTheDocument();
  });
});
