import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { DRIVER_NOT_QUALIFIED_CODE } from '../../constants/enums';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftDetailPanel } from './ShiftDetailPanel';
import { schedulingService } from '../../modules/scheduling/services/api';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import { formatTime } from '../../utils/dateFormatting';
import toast from 'react-hot-toast';

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
    getShiftCalls: vi.fn().mockResolvedValue([]),
    getShiftHandoff: vi.fn().mockResolvedValue(null),
    getEligiblePositions: vi.fn().mockResolvedValue({ positions: ['firefighter'], is_excluded: false }),
    getUnavailableMembers: vi.fn().mockResolvedValue([]),
    signupForShift: vi.fn().mockResolvedValue({}),
    openLateSignup: vi.fn().mockResolvedValue({}),
    closeLateSignup: vi.fn().mockResolvedValue({}),
    confirmAssignment: vi.fn().mockResolvedValue({}),
    checkIn: vi.fn().mockResolvedValue({}),
    checkOut: vi.fn().mockResolvedValue({}),
  },
}));

// Hoisted so a test can restore it after making the lookup fail. The default is
// one *incomplete* end-of-shift draft, which is what most of this file relies on.
const DEFAULT_CHECKLISTS = vi.hoisted(() => [
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
]);

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getShiftChecklists: vi.fn().mockResolvedValue(DEFAULT_CHECKLISTS),
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
  // 'incidents' is not one of the three real modes (detailed | count_only |
  // off). It passed only because the panel compared against 'count_only' and
  // nothing else, so it would have gone green under a broken gate too.
  callTrackingMode: 'detailed',
  signupClosesMinutesBefore: 0,
  lateSignupGraceMinutes: 60,
  settingsLoaded: true,
  loadSettings: vi.fn(),
}));

// Which permissions the viewer holds, settable per test. The signup window is
// actor-relative — a `scheduling.manage` holder is never bounded by it — so a
// blanket `() => true` cannot exercise the officer path at all.
const grantedPermissions = vi.hoisted(() => ({ current: null as string[] | null }));

vi.mock('../../stores/authStore', () => {
  // Callable and carrying getState, as the real store is: consumers that read
  // it outside React (the org-scoped scheduling settings cache) use the latter.
  const state = () => ({
    user: { id: 'user-1' },
    checkPermission: (permission: string) =>
      grantedPermissions.current === null || grantedPermissions.current.includes(permission),
  });
  // Selector-aware, as the real store is: DriverBlockedDialog reads a single
  // action (`useAuthStore((s) => s.checkPermission)`), and a mock that ignored
  // the selector handed it the whole state object instead.
  return {
    useAuthStore: Object.assign(
      (selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()),
      { getState: state }
    ),
  };
});

vi.mock('../../modules/apparatus/services/api', () => ({
  driverExceptionService: {
    approvers: vi.fn().mockResolvedValue([]),
    request: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../hooks/useRanks', () => ({ useRanks: () => ({ ranks: [], loading: false }) }));
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
 * The checklist lookup failing, which is not the same as no checks outstanding.
 *
 * `getShiftChecklists` wants `inventory.check_view` or `inventory.check_submit`,
 * and `scheduling.manage` implies neither — so it 403s for an ordinary
 * scheduling officer. The panel used to substitute `[]`, which reads as "nothing
 * pending": the warning disappeared, the override control disappeared with it,
 * and a department that blocks on those checks had the server refuse every
 * finalize with nothing on screen to explain why.
 */
describe('ShiftDetailPanel when the equipment check status cannot be read', () => {
  beforeEach(() => {
    vi.mocked(equipmentCheckService.getShiftChecklists).mockRejectedValue(new Error('403'));
  });

  afterEach(() => {
    vi.mocked(equipmentCheckService.getShiftChecklists).mockResolvedValue(DEFAULT_CHECKLISTS);
  });

  it('says the status is unknown rather than reporting nothing outstanding', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={shift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Close out shift' }));

    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    // Never silence: an absent answer presented as zero is the failure this
    // whole series keeps re-finding, and it is what the empty list produced.
    expect(screen.queryByText(/checklist still pending/)).not.toBeInTheDocument();
  });

  it('still offers the override, because the server may refuse', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={shift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Close out shift' }));

    expect(screen.getByLabelText(/Finalize anyway/)).toBeInTheDocument();
  });

  it('does not block close-out on a status nobody could read', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={shift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Close out shift' }));

    // Offered, not demanded. The server consults these checks only when the
    // department enables them and is the authority either way; refusing here
    // would shut an officer out of a close-out the API would have accepted —
    // a worse failure than the one being fixed, and one an earlier attempt at
    // this introduced.
    expect(screen.getByRole('button', { name: 'Close out shift' })).toBeEnabled();
  });

  it('will not send an override with no reason on it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={shift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Close out shift' }));
    await user.click(screen.getByLabelText(/Finalize anyway/));

    // `handleFinalize` drops an empty `override_reason`, so the audit event
    // would record the checks bypassed with `null` where the screen promised a
    // reason. Ticking the box is what makes the reason mandatory — not the
    // checks being known-incomplete, which is why an unknown status reaches
    // this branch at all.
    expect(screen.getByRole('button', { name: 'Close out shift' })).toBeDisabled();
  });
});

/**
 * Closing out a shift that ended earlier today.
 *
 * `isPast` is day-granular — `shift_date < today` — while the server's
 * `finalize_shift` accepts anything whose end has passed. A shift that ended at
 * 06:00 this morning therefore had no close-out button until tomorrow, and the
 * close-out queue, which judges the same instant the server does, lists it
 * today: a queue row whose destination offers no way to do the job.
 */
describe('ShiftDetailPanel close-out on a shift that ended today', () => {
  const today = new Date().toISOString().slice(0, 10);

  const endedHoursAgo = (hours: number) => ({
    ...shift,
    shift_date: today,
    start_time: new Date(Date.now() - (hours + 8) * 60 * 60_000).toISOString(),
    end_time: new Date(Date.now() - hours * 60 * 60_000).toISOString(),
  });

  it('offers close-out once the shift has ended, not once the day has', async () => {
    renderWithRouter(<ShiftDetailPanel shift={endedHoursAgo(3) as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Close out shift' })).toBeInTheDocument();
  });

  it('still withholds it while the crew is out', async () => {
    renderWithRouter(<ShiftDetailPanel shift={endedHoursAgo(-2) as never} onClose={vi.fn()} />);

    // Something has rendered, so the absence below is the gate and not a
    // panel that simply has not painted yet.
    await screen.findByRole('button', { name: 'Close panel' });
    expect(screen.queryByRole('button', { name: 'Close out shift' })).not.toBeInTheDocument();
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

  const mockGetShift = vi.mocked(schedulingService.getShift);
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
    // An officer, deliberately without scheduling.manage. The blanket-true
    // default makes the viewer a manager, and a manager is never bounded by
    // the window, so the reopen banner is not offered to them at all — these
    // cases would have been exercising the one actor the feature is not for.
    grantedPermissions.current = ['scheduling.assign'];
    // Stated here so the one test below that installs a shift has a default to
    // return to. `vi.clearAllMocks()` would not undo it (pitfall #28), and
    // this block's reopened shift leaked into every describe after it.
    mockGetShift.mockReset();
    mockGetShift.mockResolvedValue(null as never);
  });

  afterEach(() => {
    grantedPermissions.current = null;
    mockGetShift.mockReset();
    mockGetShift.mockResolvedValue(null as never);
  });

  it('does not offer a scheduling admin a window to reopen', async () => {
    // `rosterLocked` exempts a manager and `signupClosedReason` returns null
    // for one, so the banner's own conditions cannot withhold it — leaving
    // `memberSignupClosed` to render it, and the bounded endpoint to refuse
    // the click. `!canManage` has to be its own gate, as the endpoint's
    // contract ("not offered to scheduling.manage") already said.
    grantedPermissions.current = ['scheduling.assign', 'scheduling.manage'];
    renderWithRouter(<ShiftDetailPanel shift={startedShift() as never} onClose={vi.fn()} />);

    await screen.findByText('Crew Roster');
    expect(screen.queryByText('Signup is closed for this shift')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reopen for/ })).not.toBeInTheDocument();
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

  it('refreshes its own shift state after reopening, not just the board', async () => {
    // `onRefresh` bumps the board's key; the panel renders its own `shift`
    // state, so without a refetch the toast said reopened and the banner
    // carried on saying closed until the drawer was reopened.
    const user = userEvent.setup();
    mockGetShift.mockResolvedValue({
      ...startedShift(),
      late_signup_until: new Date(Date.now() + 30 * 60_000).toISOString(),
    } as never);

    renderWithRouter(<ShiftDetailPanel shift={startedShift() as never} onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Reopen for 30 min' }));

    expect(await screen.findByText(/Late signup is open until/)).toBeInTheDocument();
  });

  it('shows the capped deadline, not a stale window that outruns it', async () => {
    // A reopening stored before the roster deadline existed can sit far past
    // it. The server honours it only up to the deadline, so displaying the raw
    // column told the officer members could claim until tomorrow while the API
    // stopped accepting them in an hour. The roster deadline has NOT passed
    // here — that is the case the banner still renders, and the only thing
    // that distinguishes the two is the time it prints.
    const stale = {
      ...startedShift(),
      late_signup_until: new Date(Date.now() + 30 * 60 * 60_000).toISOString(),
    };
    // end_time is +11h and the default grace is 60 minutes.
    const capped = formatTime(new Date(Date.now() + 12 * 60 * 60_000).toISOString(), 'UTC');
    const raw = formatTime(stale.late_signup_until, 'UTC');
    expect(capped).not.toBe(raw);

    renderWithRouter(<ShiftDetailPanel shift={stale as never} onClose={vi.fn()} />);

    expect(await screen.findByText(new RegExp(`Late signup is open until\\s*${capped}`))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(raw))).not.toBeInTheDocument();
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

describe('ShiftDetailPanel assign controls past the grace', () => {
  const mockEligibility = vi.mocked(schedulingService.getEligiblePositions);

  beforeEach(() => {
    mockEligibility.mockReset();
    mockEligibility.mockResolvedValue({ positions: ['firefighter'], is_excluded: false });
    // An officer, deliberately without scheduling.manage: a manager is never
    // bounded, so they would keep the controls in both cases below.
    grantedPermissions.current = ['scheduling.assign'];
  });

  afterEach(() => {
    grantedPermissions.current = null;
  });

  const shiftStartedAgo = (minutes: number) => ({
    ...shift,
    shift_date: new Date().toISOString().slice(0, 10),
    start_time: new Date(Date.now() - minutes * 60_000).toISOString(),
    end_time: new Date(Date.now() + 60 * 60_000).toISOString(),
  });

  it('keeps "Assign someone" inside the officer grace period', async () => {
    renderWithRouter(<ShiftDetailPanel shift={shiftStartedAgo(30) as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Assign someone/ })).toBeInTheDocument();
  });

  it('withdraws it past the grace, where create_assignment refuses too', async () => {
    // Leaving the form enabled only makes the officer fill it in to earn an
    // error the server was always going to return.
    renderWithRouter(<ShiftDetailPanel shift={shiftStartedAgo(180) as never} onClose={vi.fn()} />);

    await screen.findByText('Signup is closed for this shift');
    expect(screen.queryByRole('button', { name: /Assign someone/ })).not.toBeInTheDocument();
  });
});

describe('ShiftDetailPanel once the roster locks', () => {
  const mockEligibility = vi.mocked(schedulingService.getEligiblePositions);
  const mockAssignments = vi.mocked(schedulingService.getShiftAssignments);

  beforeEach(() => {
    mockEligibility.mockReset();
    mockEligibility.mockResolvedValue({ positions: ['firefighter'], is_excluded: false });
    mockAssignments.mockResolvedValue([
      { id: 'a-1', user_id: 'user-1', user_name: 'A Member', position: 'officer', status: 'assigned' },
    ] as never);
    // The shift's own officer, deliberately without scheduling.manage: a
    // manager is exempt from the lock, so they would keep every control below.
    grantedPermissions.current = ['scheduling.assign'];
  });

  afterEach(() => {
    grantedPermissions.current = null;
    mockAssignments.mockResolvedValue([]);
  });

  // Ended this many hours ago, and still today. `isPast` stays false until
  // midnight, which is exactly why each of these controls survived its own
  // gate and had to be found one at a time.
  const endedHoursAgo = (hours: number) => ({
    ...shift,
    shift_date: new Date().toISOString().slice(0, 10),
    start_time: new Date(Date.now() - (hours + 12) * 60 * 60_000).toISOString(),
    end_time: new Date(Date.now() - hours * 60 * 60_000).toISOString(),
  });

  it('withdraws every live control but leaves the record readable', async () => {
    renderWithRouter(<ShiftDetailPanel shift={endedHoursAgo(3) as never} onClose={vi.fn()} />);

    // The roster itself stays — what it says is still the answer to who was
    // on this shift. It is only the buttons that stopped meaning anything.
    expect(await screen.findByText('You are assigned to this shift')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Withdraw from this shift/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm assignment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Decline assignment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove assignment/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Signup is closed for this shift')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reopen for/ })).not.toBeInTheDocument();
  });

  it('keeps them while the crew is still out', async () => {
    // The same shift an hour before it ends: nothing here is a record yet.
    renderWithRouter(<ShiftDetailPanel shift={endedHoursAgo(-1) as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Withdraw from this shift/ })).toBeInTheDocument();
  });
});

/**
 * The dialog shell.
 *
 * This surface was a right-edge `drawer-panel` until it became a centred
 * modal, and the conversion moved three behaviours it had hand-rolled (or
 * lacked) onto the shared dialog stack via `DialogPanel`. Each is asserted
 * here because none of them is visible in the markup of the sections above.
 */
const VIEWPORT_WIDTHS = { phone: 390, laptop: 1440 } as const;

/**
 * `src/test/setup.ts` answers every media query `false` — phone — before any
 * test runs, so a case asserting the wide-header arrangement has to say so
 * (pitfall #28a). Resolved against a real pixel width rather than one
 * hard-coded query, so it keeps working if the header gains another breakpoint.
 */
let currentWidth: number = VIEWPORT_WIDTHS.phone;
let mediaListeners: ((event: MediaQueryListEvent) => void)[] = [];

const matches = (query: string) => {
  const minWidth = /min-width:\s*(\d+)px/.exec(query);
  return minWidth ? currentWidth >= Number(minWidth[1]) : false;
};

const mockViewport = (width: keyof typeof VIEWPORT_WIDTHS) => {
  currentWidth = VIEWPORT_WIDTHS[width];
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    // Real listeners, so a test can cross the breakpoint rather than only
    // choose one side of it: useMediaQuery re-reads on `change`, so a
    // re-render alone would leave its state where it started.
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners = mediaListeners.filter((registered) => registered !== listener);
    },
    dispatchEvent: vi.fn(),
  }));
};

/** Cross the breakpoint the way a rotation does, and let React settle. */
const resizeTo = async (width: keyof typeof VIEWPORT_WIDTHS) => {
  mockViewport(width);
  await act(async () => {
    for (const listener of [...mediaListeners]) {
      listener({ matches: matches('(min-width: 640px)') } as MediaQueryListEvent);
    }
  });
};

describe('ShiftDetailPanel dialog shell', () => {
  const mockEligibility = vi.mocked(schedulingService.getEligiblePositions);
  const mockAssignments = vi.mocked(schedulingService.getShiftAssignments);
  const mockSignup = vi.mocked(schedulingService.signupForShift);

  // Not past: the notes control, and every other live affordance, is withdrawn
  // once the roster locks.
  const openShift = {
    ...shift,
    shift_date: '2099-01-01',
    start_time: '2099-01-01T08:00:00Z',
    end_time: '2099-01-01T16:00:00Z',
  };

  // Apparatus seats, so the crew board offers a self-signup button to click.
  const crewSignupShift = {
    ...openShift,
    apparatus_positions: [{ position: 'driver', required: true }],
  };

  beforeEach(() => {
    // Reset and re-install this block's own defaults rather than inheriting
    // whatever a neighbouring block left behind (pitfall #28).
    mockEligibility.mockReset();
    mockEligibility.mockResolvedValue({ positions: ['firefighter'], is_excluded: false });
    mockAssignments.mockReset();
    mockAssignments.mockResolvedValue([]);
    // Reset too: one case below queues a mockRejectedValueOnce, and an
    // unconsumed one-shot survives vi.clearAllMocks() to be handed to whichever
    // test calls signup next (pitfall #28).
    mockSignup.mockReset();
    mockSignup.mockResolvedValue({} as never);
    mediaListeners = [];
    mockViewport('phone');
  });

  afterEach(() => {
    mockAssignments.mockResolvedValue([]);
  });

  it('exposes itself as a modal dialog named by its heading', async () => {
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Shift Details' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={onClose} />);

    await screen.findByRole('dialog', { name: 'Shift Details' });
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancels an open notes editor on Escape instead of closing the dialog', async () => {
    // The whole reason the close handler is not just `onClose`: a half-typed
    // note must not take the dialog down with it.
    mockAssignments.mockResolvedValue([
      { id: 'a-1', user_id: 'user-2', user_name: 'A Member', position: 'firefighter', status: 'assigned' },
    ] as never);

    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: 'Edit notes' }));
    expect(screen.getByRole('textbox', { name: 'Assignment notes' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('textbox', { name: 'Assignment notes' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when a selection drag starts inside the panel and ends on the backdrop', async () => {
    // The browser resolves such a click to the common ancestor — the backdrop
    // container — so `target === currentTarget` is true and the click alone
    // cannot tell it from a deliberate backdrop click. Losing the dialog here
    // would discard a half-typed cancellation reason or close-out hours.
    const onClose = vi.fn();
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={onClose} />);

    const dialog = await screen.findByRole('dialog', { name: 'Shift Details' });
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Shift Details' }));
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when a press starts on the backdrop and is released inside the panel', async () => {
    // The mirror of the case above, and it reaches the handler identically:
    // the click still resolves to the container. mouseup is what distinguishes
    // them, so it has to be able to invalidate a press that already qualified.
    const onClose = vi.fn();
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={onClose} />);

    const dialog = await screen.findByRole('dialog', { name: 'Shift Details' });
    const heading = screen.getByRole('heading', { name: 'Shift Details' });

    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(heading);
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('goes inert while the driver-qualification dialog is on top of it', async () => {
    // Both dialogs portal to the body, so they are siblings rather than nested:
    // two aria-modal surfaces at once leave assistive technology to guess which
    // one is live.
    mockSignup.mockRejectedValueOnce({
      response: {
        status: 409,
        statusText: 'Conflict',
        data: { code: DRIVER_NOT_QUALIFIED_CODE, detail: 'Not signed off to drive' },
      },
    });
    mockEligibility.mockResolvedValue({ positions: ['driver'], is_excluded: false });

    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={crewSignupShift as never} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Shift Details' });
    expect(dialog).not.toHaveAttribute('inert');

    await user.click(await screen.findByRole('button', { name: 'Sign myself up as Driver/Operator' }));

    await waitFor(() => expect(dialog).toHaveAttribute('inert'));
  });

  /**
   * DOM order is focus order, and the header reads differently at each width:
   * below 640px the close sits above the action row, above it the close comes
   * last. Reordering with CSS would move it visually and leave it where it was
   * in the tab sequence, which is what these pin.
   */
  /** Accessible names of every button, in the DOM order the Tab key follows. */
  const buttonOrder = () =>
    screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim());

  it('focuses the close before the actions on a phone, matching how they read', async () => {
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Shift Details' });

    const order = buttonOrder();
    expect(order).toContain('Close panel');
    expect(order.indexOf('Close panel')).toBeLessThan(order.indexOf('Edit'));
  });

  it('focuses the close last on a laptop, where the header is one row', async () => {
    mockViewport('laptop');
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Shift Details' });

    const order = buttonOrder();
    expect(order).toContain('Close panel');
    expect(order.indexOf('Close panel')).toBeGreaterThan(order.indexOf('Cancel shift'));
  });

  it('renders exactly one close control at either width', async () => {
    // A `hidden`-variant duplicate would put two in the accessibility tree, and
    // jsdom applies no stylesheet to hide either.
    mockViewport('laptop');
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Shift Details' });

    expect(screen.getAllByRole('button', { name: 'Close panel' })).toHaveLength(1);
  });

  it('keeps focus on the close button when the viewport crosses the breakpoint', async () => {
    // The two placements are different positions in the tree, so the flip
    // mounts a new button rather than moving the old one. Losing focus to the
    // body would take the focus trap with it: it only intercepts Tab while
    // focus is on its first or last element, so the next Tab would leave the
    // dialog for the page behind it. Rotating a phone crosses this.
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={vi.fn()} />);

    const closeOnPhone = await screen.findByRole('button', { name: 'Close panel' });
    await user.click(closeOnPhone);
    closeOnPhone.focus();
    expect(closeOnPhone).toHaveFocus();

    await resizeTo('laptop');

    const closeOnLaptop = screen.getByRole('button', { name: 'Close panel' });
    expect(closeOnLaptop).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<ShiftDetailPanel shift={openShift as never} onClose={onClose} />);

    // Inside the panel first: the container's handler sees a click whose target
    // is a descendant, not the backdrop itself.
    await user.click(await screen.findByRole('heading', { name: 'Shift Details' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('dialog', { name: 'Shift Details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * A member's own attendance and roster answers, from inside this panel.
 *
 * Every one of these is a *member* action on a shift they are seated on, and
 * they share two failure modes that were invisible from the officer's side of
 * the panel — which is the side the rest of this file exercises.
 */
const futureShift = {
  ...shift,
  shift_date: '2099-06-01',
  start_time: '2099-06-01T08:00:00Z',
  end_time: '2099-06-01T16:00:00Z',
  // Not the viewer: `isShiftOfficer` grants `canAssign` outright and would
  // hide the permission half of what these tests are about.
  shift_officer_id: 'officer-2',
};

const myAssignment = {
  id: 'assign-1',
  user_id: 'user-1',
  user_name: 'Test Member',
  status: 'assigned',
  assignment_status: 'assigned',
  position: 'firefighter',
};

// What a line member actually holds — `scheduling.assign` is an officer grant.
const MEMBER_PERMISSIONS = ['scheduling.view', 'scheduling.swap'];

describe('ShiftDetailPanel member check-in', () => {
  beforeEach(() => {
    vi.mocked(schedulingService.getShiftAssignments).mockReset();
    vi.mocked(schedulingService.getShiftAssignments).mockResolvedValue([myAssignment as never]);
    vi.mocked(schedulingService.getMyAttendance).mockReset();
    vi.mocked(schedulingService.getMyAttendance).mockResolvedValue(null);
    vi.mocked(schedulingService.getShift).mockReset();
    vi.mocked(schedulingService.getShift).mockResolvedValue(null as never);
    vi.mocked(schedulingService.checkIn).mockReset();
    vi.mocked(schedulingService.checkIn).mockResolvedValue({} as never);
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    vi.mocked(schedulingService.getShiftAssignments).mockResolvedValue([]);
    vi.mocked(schedulingService.getMyAttendance).mockResolvedValue(null);
    vi.mocked(schedulingService.getShift).mockResolvedValue(null as never);
    grantedPermissions.current = null;
  });

  it('reports the reason the server gave for refusing an early check-in', async () => {
    const user = userEvent.setup();
    const reason = 'This shift has not started yet. Check-in opens 2 hours before the shift starts.';
    vi.mocked(schedulingService.checkIn).mockRejectedValue({
      response: { status: 400, data: { detail: reason } },
    });

    renderWithRouter(<ShiftDetailPanel shift={futureShift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Check In/ }));

    // The whole point: a bare "Failed to check in" threw this sentence away,
    // and the member had no way to learn when check-in opens.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
  });

  it('does not offer check-in the server has already said is closed', async () => {
    const closed = {
      ...futureShift,
      checkin_open: false,
      checkin_closed_reason: 'This shift has not started yet. Check-in opens 2 hours before the shift starts.',
    };
    vi.mocked(schedulingService.getShift).mockResolvedValue(closed as never);

    renderWithRouter(<ShiftDetailPanel shift={closed as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Check In/ })).toBeDisabled();
    expect(screen.getByText(/Check-in opens 2 hours before/)).toBeInTheDocument();
    expect(schedulingService.checkIn).not.toHaveBeenCalled();
  });

  it('leaves check-in offered on a shift whose verdict it has not been told', async () => {
    // A shift handed in from a list response carries no `checkin_open`. The
    // server refuses either way, so unknown must not block a check-in it
    // would have accepted.
    renderWithRouter(<ShiftDetailPanel shift={futureShift as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Check In/ })).toBeEnabled();
  });
});

describe('ShiftDetailPanel member confirming their own assignment', () => {
  beforeEach(() => {
    grantedPermissions.current = MEMBER_PERMISSIONS;
    vi.mocked(schedulingService.getShiftAssignments).mockReset();
    vi.mocked(schedulingService.getShiftAssignments).mockResolvedValue([myAssignment as never]);
    vi.mocked(schedulingService.getShift).mockReset();
    vi.mocked(schedulingService.getShift).mockResolvedValue(futureShift as never);
    vi.mocked(schedulingService.getUnavailableMembers).mockReset();
    vi.mocked(schedulingService.getUnavailableMembers).mockRejectedValue({
      response: { status: 403, data: { detail: 'Insufficient permissions', code: 'LB-PERM-001' } },
    });
    vi.mocked(schedulingService.confirmAssignment).mockReset();
    vi.mocked(schedulingService.confirmAssignment).mockResolvedValue({} as never);
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  afterEach(() => {
    grantedPermissions.current = null;
    vi.mocked(schedulingService.getShiftAssignments).mockResolvedValue([]);
    vi.mocked(schedulingService.getShift).mockResolvedValue(null as never);
    vi.mocked(schedulingService.getUnavailableMembers).mockResolvedValue([]);
  });

  it('never asks for the staffing read that needs scheduling.assign', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={futureShift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Confirm assignment' }));

    await waitFor(() => expect(schedulingService.confirmAssignment).toHaveBeenCalledWith('assign-1'));
    // `unavailable-members` is gated on `scheduling.assign`, and only the
    // assign form reads it. Asking for it from the refresh that follows a
    // member's own write is what turned a successful confirm into a 403.
    expect(schedulingService.getUnavailableMembers).not.toHaveBeenCalled();
  });

  it('does not report an error on a confirmation the server accepted', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={futureShift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Confirm assignment' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Assignment confirmed'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps the row confirmed rather than reverting it to Assigned', async () => {
    const user = userEvent.setup();
    // Two distinct responses so the refresh is observable: the first call is
    // the panel's own load and must still show a row to confirm, every call
    // after it is the refresh. The refreshed name is what proves the refresh
    // landed — without it, a status of "confirmed" could be the optimistic
    // update alone, which is exactly what the revert used to undo.
    vi.mocked(schedulingService.getShiftAssignments).mockResolvedValue([
      {
        ...myAssignment,
        user_name: 'Test Member Refreshed',
        status: 'confirmed',
        assignment_status: 'confirmed',
      } as never,
    ]);
    vi.mocked(schedulingService.getShiftAssignments).mockResolvedValueOnce([myAssignment as never]);

    renderWithRouter(<ShiftDetailPanel shift={futureShift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Confirm assignment' }));

    expect(await screen.findByText(/Test Member Refreshed/)).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.queryByText('assigned')).not.toBeInTheDocument();
  });
});
