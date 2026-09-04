import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftDetailPanel } from './ShiftDetailPanel';
import { schedulingService } from '../../modules/scheduling/services/api';

const shift = {
  id: 'shift-1',
  organization_id: 'org-1',
  shift_date: '2020-01-01',
  start_time: '2020-01-01T08:00:00Z',
  end_time: '2020-01-01T16:00:00Z',
  status: 'scheduled',
  is_finalized: false,
  shift_officer_id: 'user-1',
  positions: [],
};

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShiftAssignments: vi.fn().mockResolvedValue([]),
    getMyAttendance: vi.fn().mockResolvedValue(null),
    getShiftAttendance: vi.fn().mockResolvedValue([]),
    getShift: vi.fn().mockResolvedValue(null),
    getShiftHandoff: vi.fn().mockResolvedValue(null),
    getEligiblePositions: vi.fn().mockResolvedValue({ positions: ['firefighter'], is_excluded: false }),
    openLateSignup: vi.fn().mockResolvedValue({}),
    closeLateSignup: vi.fn().mockResolvedValue({}),
  },
}));

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getShiftChecklists: vi.fn().mockResolvedValue([
      {
        templateId: 'end-check',
        templateName: 'End check',
        checkTiming: 'end_of_shift',
        // Exercise defensive frontend handling of stale/mismatched API data:
        // an incomplete draft can never become complete just because this flag
        // was true.
        isCompleted: true,
        overallStatus: 'incomplete',
        totalItems: 2,
        completedItems: 1,
        failedItems: 0,
      },
    ]),
  },
}));

vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  // Callable with or without a selector, as the real store is: components
  // that read a single action (useSignupWindow reads `loadSettings`) pass one,
  // and a mock that ignored it handed them the whole state object instead.
  useSchedulingStore: (selector?: (s: typeof schedulingStoreState) => unknown) =>
    selector ? selector(schedulingStoreState) : schedulingStoreState,
}));

const schedulingStoreState = vi.hoisted(() => ({
  apparatus: [],
  loadApparatus: vi.fn(),
  members: [],
  loadMembers: vi.fn(),
  platoonsEnabled: false,
  requireEndOfShiftChecks: true,
  callTrackingMode: 'incidents',
  signupClosesMinutesBefore: 0,
  lateSignupGraceMinutes: 60,
  settingsLoaded: true,
  loadSettings: vi.fn(),
}));

vi.mock('../../stores/authStore', () => {
  // Callable and carrying getState, as the real store is: consumers that read
  // it outside React (the org-scoped scheduling settings cache) use the latter.
  const state = () => ({ user: { id: 'user-1' }, checkPermission: () => true });
  return { useAuthStore: Object.assign(() => state(), { getState: state }) };
});

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOverlaySurface', () => ({ useOverlaySurface: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('ShiftDetailPanel close-out equipment checks', () => {
  it('keeps an incomplete end-of-shift draft outstanding and close-out disabled', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={shift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Close out shift' }));

    expect(screen.getByText(/1 end-of-shift checklist still pending/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close out shift' })).toBeDisabled();
  });
});

/**
 * The crew board offers a seat only when the member can actually take it.
 *
 * Before this, every open seat carried a "Sign myself up" button and the
 * signup endpoint answered 403 — the button was an invitation the server
 * could only refuse.
 */
describe('ShiftDetailPanel crew board signup gating', () => {
  const crewShift = {
    ...shift,
    // Far future so the panel does not treat this as a past shift, which
    // suppresses every signup button on its own and would hide the defect.
    shift_date: '2099-01-01',
    start_time: '2099-01-01T08:00:00Z',
    end_time: '2099-01-01T16:00:00Z',
    apparatus_positions: [
      { position: 'driver', required: true },
      { position: 'ems', required: true },
    ],
  };

  const mockEligibility = vi.mocked(schedulingService.getEligiblePositions);

  beforeEach(() => {
    mockEligibility.mockReset();
  });

  it('offers only the seat the member is cleared for', async () => {
    mockEligibility.mockResolvedValue({ positions: ['ems'], is_excluded: false });

    renderWithRouter(<ShiftDetailPanel shift={crewShift as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Sign myself up as EMT' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign myself up as Driver/Operator' })).not.toBeInTheDocument();
  });

  it('says why when no open seat is theirs to take', async () => {
    mockEligibility.mockResolvedValue({ positions: [], is_excluded: false });

    renderWithRouter(<ShiftDetailPanel shift={crewShift as never} onClose={vi.fn()} />);

    expect(await screen.findByText(/None of the open seats on this shift match/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign myself up/ })).not.toBeInTheDocument();
  });

  it('still offers the seats when the eligibility lookup fails', async () => {
    // Fail open on the affordance: the endpoint is the real gate, and taking
    // self-signup away from everyone over a network blip is the worse outcome.
    mockEligibility.mockRejectedValue(new Error('network down'));

    renderWithRouter(<ShiftDetailPanel shift={crewShift as never} onClose={vi.fn()} />);

    expect(await screen.findAllByRole('button', { name: /Sign myself up/ })).toHaveLength(2);
    expect(screen.queryByText(/None of the open seats on this shift match/)).not.toBeInTheDocument();
  });
});

/**
 * Signup closes when the shift starts, and leadership can reopen one shift.
 *
 * Nothing compared a shift's start against the clock before this: a member
 * could put themselves on a 06:00 shift at 16:00 the same day, and the roster
 * accepted it.
 */
describe('ShiftDetailPanel signup window', () => {
  const startedShift = () => ({
    ...shift,
    shift_date: new Date().toISOString().slice(0, 10),
    start_time: new Date(Date.now() - 60 * 60_000).toISOString(),
    end_time: new Date(Date.now() + 11 * 60 * 60_000).toISOString(),
  });

  const mockEligibility = vi.mocked(schedulingService.getEligiblePositions);
  const mockOpen = vi.mocked(schedulingService.openLateSignup);
  const mockClose = vi.mocked(schedulingService.closeLateSignup);

  beforeEach(() => {
    // Reset and re-install the defaults this block depends on rather than
    // inheriting whatever a neighbouring block left behind (pitfall #28).
    mockEligibility.mockReset();
    mockEligibility.mockResolvedValue({ positions: ['firefighter'], is_excluded: false });
    mockOpen.mockReset();
    mockOpen.mockResolvedValue({} as never);
    mockClose.mockReset();
    mockClose.mockResolvedValue({} as never);
  });

  it('offers leadership a way to reopen a shift that has started', async () => {
    renderWithRouter(<ShiftDetailPanel shift={startedShift() as never} onClose={vi.fn()} />);

    expect(await screen.findByText('Signup is closed for this shift')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen for 30 min' })).toBeInTheDocument();
  });

  it('reopens for the number of minutes the officer picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={startedShift() as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Reopen for 30 min' }));

    expect(mockOpen).toHaveBeenCalledWith('shift-1', 30);
  });

  it('shows the live window and closes it on request', async () => {
    const user = userEvent.setup();
    const reopened = {
      ...startedShift(),
      late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    renderWithRouter(<ShiftDetailPanel shift={reopened as never} onClose={vi.fn()} />);

    expect(await screen.findByText(/Late signup is open until/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close it now' }));

    expect(mockClose).toHaveBeenCalledWith('shift-1');
  });
});
