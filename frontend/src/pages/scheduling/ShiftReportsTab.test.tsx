import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftReportsTab } from './ShiftReportsTab';
import type { OfficerShiftAnalytics, ShiftCompletionReport } from '../../types/training';

const mockGetMyReports = vi.fn();
const mockGetFiledReports = vi.fn();
const mockGetDraftReports = vi.fn();
const mockGetPendingReview = vi.fn();
const mockGetFlagged = vi.fn();
const mockGetConfig = vi.fn();
const mockGetUsers = vi.fn();
const mockGetRecentShifts = vi.fn();
const mockGetByOfficer = vi.fn();
const mockGetOfficerAnalytics = vi.fn();
const mockGetShiftCrewStatus = vi.fn();
const mockGetShift = vi.fn();
const mockBatchCreate = vi.fn();
const mockGetOrgSettings = vi.fn();
let canManage = true;
let canViewAnalytics = false;

vi.mock('../../services/api', () => ({
  shiftCompletionService: {
    getMyReports: (...a: unknown[]) => mockGetMyReports(...a) as unknown,
    getFiledReports: (...a: unknown[]) => mockGetFiledReports(...a) as unknown,
    getDraftReports: (...a: unknown[]) => mockGetDraftReports(...a) as unknown,
    getPendingReviewReports: (...a: unknown[]) => mockGetPendingReview(...a) as unknown,
    getFlaggedReports: (...a: unknown[]) => mockGetFlagged(...a) as unknown,
    getReportsByOfficer: (...a: unknown[]) => mockGetByOfficer(...a) as unknown,
    getOfficerAnalytics: (...a: unknown[]) => mockGetOfficerAnalytics(...a) as unknown,
    getMyStats: () => Promise.resolve(null),
    getShiftCrewStatus: (...a: unknown[]) => mockGetShiftCrewStatus(...a) as unknown,
    batchCreateReports: (...a: unknown[]) => mockBatchCreate(...a) as unknown,
  },
  trainingModuleConfigService: {
    getConfig: (...a: unknown[]) => mockGetConfig(...a) as unknown,
  },
  userService: {
    getUsers: (...a: unknown[]) => mockGetUsers(...a) as unknown,
  },
  organizationService: {
    getSettings: (...a: unknown[]) => mockGetOrgSettings(...a) as unknown,
  },
}));

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getRecentShiftsForReports: (...a: unknown[]) => mockGetRecentShifts(...a) as unknown,
    getShifts: (...a: unknown[]) => mockGetRecentShifts(...a) as unknown,
    getShift: (...a: unknown[]) => mockGetShift(...a) as unknown,
  },
}));

// jsdom has no IndexedDB, which the offline queue opens on mount.
vi.mock('../../utils/shiftReportOfflineQueue', () => ({
  pendingReportCount: () => Promise.resolve(0),
  enqueueShiftReport: () => Promise.resolve(),
  listPendingReports: () => Promise.resolve([]),
  dequeueShiftReport: () => Promise.resolve(),
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', first_name: 'Dana', last_name: 'Ruiz' },
    checkPermission: (p: string) => (p === 'training.view_analytics' ? canViewAnalytics : canManage),
  }),
}));

let searchParams = new URLSearchParams();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useSearchParams: () => [searchParams, vi.fn()],
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  canManage = true;
  canViewAnalytics = false;
  mockGetMyReports.mockResolvedValue([]);
  mockGetFiledReports.mockResolvedValue([]);
  mockGetDraftReports.mockResolvedValue([]);
  mockGetPendingReview.mockResolvedValue([]);
  mockGetFlagged.mockResolvedValue([]);
  mockGetConfig.mockResolvedValue({});
  mockGetUsers.mockResolvedValue([]);
  mockGetRecentShifts.mockResolvedValue({ shifts: [], total: 0 });
  mockGetByOfficer.mockReset();
  mockGetByOfficer.mockResolvedValue([]);
  mockGetOfficerAnalytics.mockReset();
  mockGetOfficerAnalytics.mockResolvedValue(null);
  mockGetOrgSettings.mockReset();
  mockGetOrgSettings.mockResolvedValue({});
});

describe('ShiftReportsTab — the view named in the URL', () => {
  // The training module's "Go to Shift Reports" button links to
  // ?tab=shift-reports&view=create. Only `drafts` was honoured, so an officer
  // told to "select a shift and validate hours" landed on the filed list.
  it('opens the new-report form for view=create', async () => {
    searchParams = new URLSearchParams('view=create');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('New Shift Completion Report')).toBeInTheDocument();
  });

  it('still opens the drafts view for view=drafts', async () => {
    searchParams = new URLSearchParams('view=drafts');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText(/No draft reports/)).toBeInTheDocument();
  });

  it('falls back to the filed list when the view is not one it knows', async () => {
    searchParams = new URLSearchParams('view=nonsense');
    renderWithRouter(<ShiftReportsTab />);

    // The list's own empty state, not the toggle button: every view renders
    // the whole toggle, so finding the button proved nothing about which view
    // was selected. This string belongs to the filed list alone.
    expect(await screen.findByText('No reports filed yet')).toBeInTheDocument();
    expect(screen.queryByText('New Shift Completion Report')).not.toBeInTheDocument();
  });
});

describe('ShiftReportsTab — a member with no reports', () => {
  beforeEach(() => {
    canManage = false;
  });

  // A member has one view, and it was presented as a one-segment toggle: a
  // highlighted "About me" button that did nothing when pressed.
  it('names the view instead of rendering a one-button toggle', async () => {
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('heading', { name: 'Shift reports about you' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'About me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New/ })).not.toBeInTheDocument();
  });

  it('explains when a report will appear and what it holds', async () => {
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('heading', { name: 'No shift reports yet' })).toBeInTheDocument();
    expect(screen.getByText(/When an officer files a report for a shift you worked/)).toBeInTheDocument();
    expect(screen.getByText(/A place to acknowledge it/)).toBeInTheDocument();
    expect(screen.queryByText(/reviews each report before it is shared/)).not.toBeInTheDocument();
  });

  it('says reports are reviewed first when the department requires review', async () => {
    mockGetConfig.mockResolvedValue({ report_review_required: true });
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText(/reviews each report before it is shared/)).toBeInTheDocument();
  });
});

describe('ShiftReportsTab — an officer who has filed nothing', () => {
  it('keeps the view toggle and offers to write the first report', async () => {
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('No reports filed yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About me' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Write a report' }));

    expect(await screen.findByText('New Shift Completion Report')).toBeInTheDocument();
  });
});

describe('ShiftReportsTab — Written by me', () => {
  const report = (over: Partial<ShiftCompletionReport>): ShiftCompletionReport => ({
    id: 'r-1',
    organization_id: 'org-1',
    shift_date: '2026-09-20',
    trainee_id: 'user-2',
    officer_id: 'user-1',
    trainee_name: 'Sam Lee',
    officer_name: 'Dana Ruiz',
    hours_on_shift: 12,
    calls_responded: 3,
    review_status: 'approved',
    trainee_acknowledged: false,
    created_at: '2026-09-20T20:00:00Z',
    updated_at: '2026-09-20T20:00:00Z',
    ...over,
  });

  const analytics = (statusCounts: Record<string, number>): OfficerShiftAnalytics => ({
    total_reports: 2,
    total_hours: 24,
    total_calls: 6,
    avg_rating: null,
    status_counts: statusCounts,
    trainees: [],
    monthly: [],
  });

  it('lists the reports under a heading, without naming the viewer as author on each', async () => {
    mockGetByOfficer.mockResolvedValue([report({ id: 'r-1' }), report({ id: 'r-2', trainee_name: 'Alex Kim' })]);
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('heading', { name: /Reports you've written \(2\)/ })).toBeInTheDocument();
    expect(screen.queryByText('Dana Ruiz')).not.toBeInTheDocument();
  });

  it('says when an approved report has not been acknowledged by the member', async () => {
    mockGetByOfficer.mockResolvedValue([
      report({ id: 'r-1' }),
      report({ id: 'r-2', trainee_name: 'Alex Kim', trainee_acknowledged: true }),
    ]);
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findAllByText('Not acknowledged yet')).toHaveLength(1);
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
  });

  it('labels how long a pending report has waited instead of a bare day count', async () => {
    mockGetByOfficer.mockResolvedValue([
      report({ review_status: 'pending_review', created_at: new Date(Date.now() - 3 * 86400000).toISOString() }),
    ]);
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('Waiting 3 days')).toBeInTheDocument();
  });

  it('makes the drafts tile a button that opens the drafts view', async () => {
    mockGetByOfficer.mockResolvedValue([report({})]);
    mockGetOfficerAnalytics.mockResolvedValue(analytics({ draft: 2 }));
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('heading', { name: 'Your reporting summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Awaiting review/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /2 Drafts to finish/ }));

    expect(await screen.findByText('No draft reports')).toBeInTheDocument();
  });
  it('shows the reviewer comment on a flagged report once, not twice', async () => {
    mockGetByOfficer.mockResolvedValue([
      report({
        review_status: 'flagged',
        reviewer_notes: 'Rating does not match narrative.',
        reviewer_name: 'Chief Moss',
      }),
    ]);
    renderWithRouter(<ShiftReportsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /Sam Lee/ }));

    expect(screen.getByText('Rating does not match narrative.')).toBeInTheDocument();
    expect(screen.queryByText(/Flagged for Review/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Re-Review Report/ })).toBeInTheDocument();
  });

  it('charts reports per month under month names, sized by the figure it shows', async () => {
    mockGetByOfficer.mockResolvedValue([report({})]);
    mockGetOfficerAnalytics.mockResolvedValue({
      ...analytics({}),
      monthly: [
        { month: '2026-07', reports: 4, hours: 10 },
        { month: '2026-08', reports: 1, hours: 40 },
      ],
    });
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('Reports written per month')).toBeInTheDocument();
    expect(screen.getByText('Jul')).toBeInTheDocument();
    expect(screen.getByText('Aug')).toBeInTheDocument();
    // August has more hours but fewer reports: its bar is the shorter one.
    expect(screen.getByTitle('Jul: 4 reports').style.height).toBe('100%');
    expect(screen.getByTitle('Aug: 1 report').style.height).toBe('25%');
  });
});

describe('ShiftReportsTab — acknowledging a report about me', () => {
  it('names the comment box by its label', async () => {
    canManage = false;
    searchParams = new URLSearchParams('view=my-reports');
    mockGetMyReports.mockResolvedValue([
      {
        id: 'r-9',
        organization_id: 'org-1',
        shift_date: '2026-09-28',
        trainee_id: 'user-1',
        officer_id: 'user-2',
        officer_name: 'Tariq Nolan',
        hours_on_shift: 12,
        calls_responded: 2,
        review_status: 'approved',
        trainee_acknowledged: false,
        created_at: '2026-09-28T20:00:00Z',
        updated_at: '2026-09-28T20:00:00Z',
      },
    ]);
    renderWithRouter(<ShiftReportsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /Tariq Nolan/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge Report' }));

    expect(screen.getByLabelText('Comments (optional)')).toBeInTheDocument();
  });
});

describe('ShiftReportsTab — the author is not on their own crew list', () => {
  beforeEach(() => {
    mockGetShift.mockReset();
    mockGetShiftCrewStatus.mockReset();
    mockGetShift.mockResolvedValue({
      id: 'sh1',
      shift_date: '2026-10-03',
      start_time: '2026-10-03T11:00:00Z',
      end_time: '2026-10-03T23:00:00Z',
      apparatus_name: 'Engine 5',
      call_count: 0,
    });
    mockGetShiftCrewStatus.mockResolvedValue([
      { user_id: 'user-1', user_name: 'Dana Ruiz', has_active_enrollment: false, has_existing_report: false },
      { user_id: 'u2', user_name: 'Sam Ortiz', has_active_enrollment: false, has_existing_report: false },
    ]);
  });

  // A report about yourself is refused server-side; offering the checkbox
  // would only produce a silently skipped row.
  it('lists the rest of the crew but not the viewer', async () => {
    searchParams = new URLSearchParams('view=create&shift=sh1');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('Sam Ortiz')).toBeInTheDocument();
    expect(screen.queryByText('Dana Ruiz')).not.toBeInTheDocument();
    expect(screen.getByText('(1 of 1 selected)')).toBeInTheDocument();
  });
});

describe('ShiftReportsTab — department totals are a leadership view', () => {
  const totals: OfficerShiftAnalytics = {
    total_reports: 9,
    total_hours: 108,
    total_calls: 30,
    avg_rating: null,
    status_counts: {},
    trainees: [],
    monthly: [],
  };

  // The defect: "Written by me" rendered the whole department's totals
  // under "Your reporting summary", to every officer who files reports.
  it("asks only for the viewer's own figures under Written by me", async () => {
    renderWithRouter(<ShiftReportsTab />);

    await screen.findByRole('button', { name: 'Written by me' });
    expect(mockGetOfficerAnalytics).toHaveBeenCalledWith('mine');
    expect(mockGetOfficerAnalytics).not.toHaveBeenCalledWith('department');
  });

  it('offers no Department view to an officer without the analytics permission', async () => {
    renderWithRouter(<ShiftReportsTab />);

    await screen.findByRole('button', { name: 'Written by me' });
    expect(screen.queryByRole('button', { name: /Department/ })).not.toBeInTheDocument();
  });

  it('ignores ?view=department for an officer without the permission', async () => {
    searchParams = new URLSearchParams('view=department');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('No reports filed yet')).toBeInTheDocument();
    expect(mockGetOfficerAnalytics).not.toHaveBeenCalledWith('department');
  });

  it('shows leadership the department totals under their own heading, with no list', async () => {
    canViewAnalytics = true;
    mockGetOfficerAnalytics.mockImplementation((scope: string) =>
      Promise.resolve(scope === 'department' ? totals : null)
    );
    renderWithRouter(<ShiftReportsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /Department/ }));

    expect(await screen.findByRole('heading', { name: 'Department reporting summary' })).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Reports filed')).toBeInTheDocument();
    expect(mockGetOfficerAnalytics).toHaveBeenCalledWith('department');
    expect(screen.queryByRole('heading', { name: /Reports you've written/ })).not.toBeInTheDocument();
  });
});

describe('ShiftReportsTab — calls are counted per member', () => {
  beforeEach(() => {
    mockGetShift.mockReset();
    mockGetShiftCrewStatus.mockReset();
    mockBatchCreate.mockReset();
    mockGetShift.mockResolvedValue({
      id: 'sh1',
      shift_date: '2026-10-03',
      start_time: '2026-10-03T11:00:00Z',
      end_time: '2026-10-03T23:00:00Z',
      apparatus_name: 'Engine 5',
      call_count: 4,
    });
    mockGetShiftCrewStatus.mockResolvedValue([
      {
        user_id: 'u2',
        user_name: 'Sam Ortiz',
        has_active_enrollment: false,
        has_existing_report: false,
        calls_responded: 4,
        calls_source: 'closeout',
      },
      {
        user_id: 'u3',
        user_name: 'Lee Park',
        has_active_enrollment: false,
        has_existing_report: false,
        calls_responded: 2,
        calls_source: 'closeout',
      },
    ]);
    mockBatchCreate.mockResolvedValue({ created: 2, skipped: 0, report_ids: ['r1', 'r2'] });
  });

  it("shows each member's calls from the close-out, not one shift-wide box", async () => {
    searchParams = new URLSearchParams('view=create&shift=sh1');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByLabelText('Calls for Sam Ortiz')).toHaveValue(4);
    expect(screen.getByLabelText('Calls for Lee Park')).toHaveValue(2);
    expect(screen.getAllByText('from close-out')).toHaveLength(2);
    // The shift-level box was discarded server-side for every linked shift.
    expect(screen.queryByText('Calls Responded')).not.toBeInTheDocument();
  });

  it('sends only the corrections, so unchanged members keep the derived count', async () => {
    searchParams = new URLSearchParams('view=create&shift=sh1');
    renderWithRouter(<ShiftReportsTab />);

    const lee = await screen.findByLabelText('Calls for Lee Park');
    await userEvent.clear(lee);
    await userEvent.type(lee, '1');
    await userEvent.click(screen.getByRole('button', { name: /Submit Reports \(2\)/ }));

    expect(mockBatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: 'sh1', member_call_counts: { u3: 1 } })
    );
  });

  it('sends no corrections when nothing was changed', async () => {
    searchParams = new URLSearchParams('view=create&shift=sh1');
    renderWithRouter(<ShiftReportsTab />);

    await screen.findByLabelText('Calls for Sam Ortiz');
    await userEvent.click(screen.getByRole('button', { name: /Submit Reports \(2\)/ }));

    expect(mockBatchCreate).toHaveBeenCalledTimes(1);
    const [payload] = mockBatchCreate.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('member_call_counts');
  });
});

describe('ShiftReportsTab — reports filed by the officer on the rig', () => {
  const shift = (id: string, officer: string) => ({
    id,
    shift_date: '2026-10-03',
    apparatus_name: `Engine ${id}`,
    shift_officer_id: officer,
    attendee_count: 3,
    call_count: 0,
  });

  beforeEach(() => {
    mockGetRecentShifts.mockResolvedValue({ shifts: [shift('1', 'user-1'), shift('2', 'someone-else')], total: 2 });
  });

  it('offers every recent shift when the department has no such rule', async () => {
    searchParams = new URLSearchParams('view=create');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText(/Engine 1/)).toBeInTheDocument();
    expect(screen.getByText(/Engine 2/)).toBeInTheDocument();
  });

  it('offers only shifts the viewer was Shift Officer on when the rule is on', async () => {
    mockGetOrgSettings.mockResolvedValue({ shift_reports: { authorship: 'shift_officer' } });
    searchParams = new URLSearchParams('view=create');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText(/Engine 1/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Engine 2/)).not.toBeInTheDocument());
  });

  it('says why the list is empty when the viewer officered none of them', async () => {
    mockGetOrgSettings.mockResolvedValue({ shift_reports: { authorship: 'shift_officer' } });
    mockGetRecentShifts.mockResolvedValue({ shifts: [shift('2', 'someone-else')], total: 1 });
    searchParams = new URLSearchParams('view=create');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText(/No recent shifts where you were the Shift Officer/)).toBeInTheDocument();
  });
});

describe('ShiftReportsTab — an acting Shift Officer without training.manage', () => {
  beforeEach(() => {
    canManage = false;
    mockGetShift.mockReset();
    mockGetShiftCrewStatus.mockReset();
    mockGetShift.mockResolvedValue({
      id: 'sh1',
      shift_date: '2026-10-03',
      start_time: '2026-10-03T11:00:00Z',
      end_time: '2026-10-03T23:00:00Z',
      apparatus_name: 'Engine 5',
      shift_officer_id: 'user-1',
      call_count: 0,
    });
    mockGetShiftCrewStatus.mockResolvedValue([
      { user_id: 'u2', user_name: 'Sam Ortiz', has_active_enrollment: false, has_existing_report: false },
    ]);
  });

  it("opens the report form from their own shift's File Shift Report button", async () => {
    searchParams = new URLSearchParams('shift=sh1');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByText('New Shift Completion Report')).toBeInTheDocument();
    expect(await screen.findByText('Sam Ortiz')).toBeInTheDocument();
  });

  it('keeps a member who was not the Shift Officer on their own view', async () => {
    mockGetShift.mockResolvedValue({ id: 'sh1', shift_date: '2026-10-03', shift_officer_id: 'someone-else' });
    searchParams = new URLSearchParams('shift=sh1');
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('heading', { name: 'Shift reports about you' })).toBeInTheDocument();
    await waitFor(() => expect(mockGetShift).toHaveBeenCalled());
    expect(screen.queryByText('New Shift Completion Report')).not.toBeInTheDocument();
  });

  it('offers their own drafts and lets them complete one', async () => {
    mockGetDraftReports.mockResolvedValue([
      {
        id: 'd1',
        organization_id: 'org-1',
        shift_date: '2026-10-03',
        trainee_id: 'u2',
        officer_id: 'user-1',
        trainee_name: 'Sam Ortiz',
        hours_on_shift: 12,
        calls_responded: 2,
        review_status: 'draft',
        trainee_acknowledged: false,
        created_at: '2026-10-03T23:00:00Z',
        updated_at: '2026-10-03T23:00:00Z',
      },
    ]);
    renderWithRouter(<ShiftReportsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /Drafts/ }));
    expect(await screen.findByRole('heading', { name: 'Reports to finish' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Sam Ortiz/ }));
    expect(screen.getByRole('button', { name: /Complete Draft/ })).toBeInTheDocument();
  });

  it('shows no officer switch to a member with nothing to file', async () => {
    renderWithRouter(<ShiftReportsTab />);

    await screen.findByRole('heading', { name: 'Shift reports about you' });
    await waitFor(() => expect(mockGetDraftReports).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Drafts/ })).not.toBeInTheDocument();
  });
});

describe('ShiftReportsTab — flagged reports with review switched off', () => {
  // A flag survives an administrator turning review off, because the review
  // endpoint does not consult the setting. The Flagged view must follow the
  // reports, not the setting, or they sit in no list anyone can act from.
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue({ report_review_required: false });
    mockGetFlagged.mockReset();
    mockGetFlagged.mockResolvedValue([]);
  });

  it('offers the Flagged view while a flagged report exists', async () => {
    mockGetFlagged.mockResolvedValue([{ id: 'r-1', review_status: 'flagged' }]);
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('button', { name: /Flagged/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review Queue/ })).not.toBeInTheDocument();
  });

  it('shows nothing new to a department with no flagged reports', async () => {
    renderWithRouter(<ShiftReportsTab />);

    await waitFor(() => expect(mockGetFlagged).toHaveBeenCalled());
    await screen.findByText('No reports filed yet');
    expect(screen.queryByRole('button', { name: /Flagged/ })).not.toBeInTheDocument();
  });

  it('does not probe when review is on, where the view is always offered', async () => {
    mockGetConfig.mockResolvedValue({ report_review_required: true });
    renderWithRouter(<ShiftReportsTab />);

    expect(await screen.findByRole('button', { name: /Flagged/ })).toBeInTheDocument();
    expect(mockGetFlagged).not.toHaveBeenCalled();
  });

  it('does not probe for a member who cannot review', async () => {
    canManage = false;
    mockGetFlagged.mockResolvedValue([{ id: 'r-1', review_status: 'flagged' }]);
    renderWithRouter(<ShiftReportsTab />);

    await screen.findByRole('heading', { name: 'No shift reports yet' });
    expect(mockGetFlagged).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Flagged/ })).not.toBeInTheDocument();
  });
});
