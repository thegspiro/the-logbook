import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftReportsTab } from './ShiftReportsTab';

const mockGetMyReports = vi.fn();
const mockGetFiledReports = vi.fn();
const mockGetDraftReports = vi.fn();
const mockGetPendingReview = vi.fn();
const mockGetFlagged = vi.fn();
const mockGetConfig = vi.fn();
const mockGetUsers = vi.fn();
const mockGetRecentShifts = vi.fn();
let canManage = true;

vi.mock('../../services/api', () => ({
  shiftCompletionService: {
    getMyReports: (...a: unknown[]) => mockGetMyReports(...a) as unknown,
    getFiledReports: (...a: unknown[]) => mockGetFiledReports(...a) as unknown,
    getDraftReports: (...a: unknown[]) => mockGetDraftReports(...a) as unknown,
    getPendingReviewReports: (...a: unknown[]) => mockGetPendingReview(...a) as unknown,
    getFlaggedReports: (...a: unknown[]) => mockGetFlagged(...a) as unknown,
    getOfficerAnalytics: () => Promise.resolve(null),
    getMyStats: () => Promise.resolve(null),
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
    checkPermission: () => canManage,
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
  mockGetMyReports.mockResolvedValue([]);
  mockGetFiledReports.mockResolvedValue([]);
  mockGetDraftReports.mockResolvedValue([]);
  mockGetPendingReview.mockResolvedValue([]);
  mockGetFlagged.mockResolvedValue([]);
  mockGetConfig.mockResolvedValue({});
  mockGetUsers.mockResolvedValue([]);
  mockGetRecentShifts.mockResolvedValue({ shifts: [], total: 0 });
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
