import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
  },
  trainingModuleConfigService: {
    getConfig: (...a: unknown[]) => mockGetConfig(...a) as unknown,
  },
  userService: {
    getUsers: (...a: unknown[]) => mockGetUsers(...a) as unknown,
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
