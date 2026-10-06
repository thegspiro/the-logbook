import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SkillsTestingTestRecordsTab from './SkillsTestingTestRecordsTab';
import { calendarDaysBetween } from '../utils/dateFormatting';
import type { SkillTestListParams } from '../types/skillsTesting';

const mockLoadTests = vi.fn<(params?: SkillTestListParams) => void>();
const mockLoadTemplates = vi.fn();
const mockDeleteTest = vi.fn();
const mockVoidTest = vi.fn();
const mockCancelTest = vi.fn();
const mockReleaseTest = vi.fn();
const mockValidateTest = vi.fn();
const mockBulkValidateTests = vi.fn();

const completedTest = {
  id: 'test-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Evaluation',
  candidate_id: 'user-1',
  candidate_name: 'John Smith',
  examiner_id: 'user-2',
  examiner_name: 'Captain Jones',
  status: 'completed' as const,
  result: 'pass' as const,
  is_practice: false,
  overall_score: 95,
  started_at: '2026-01-15T10:00:00Z',
  completed_at: '2026-01-15T10:30:00Z',
  created_at: '2026-01-15T10:00:00Z',
};

const unfinishedTest = {
  ...completedTest,
  id: 'test-2',
  status: 'in_progress' as const,
  result: 'incomplete' as const,
  overall_score: undefined,
  completed_at: undefined,
};

// A cancelled test has no completion date either, which is why "not completed"
// was the wrong test for "still scoreable".
const cancelledTest = {
  ...completedTest,
  id: 'test-3',
  template_name: 'Ladder Evolution',
  status: 'cancelled' as const,
  result: 'incomplete' as const,
  overall_score: undefined,
  completed_at: undefined,
};

const practiceTest = {
  ...completedTest,
  id: 'test-3',
  is_practice: true,
};

const pendingTest = {
  ...completedTest,
  id: 'test-4',
  pending_validation: true,
};

let mockTests: (typeof completedTest | typeof unfinishedTest)[] = [];
let mockTestsTotal = 0;

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: () => ({
    tests: mockTests,
    testsTotal: mockTestsTotal,
    testsLoading: false,
    loadTests: mockLoadTests,
    deleteTest: mockDeleteTest,
    voidTest: mockVoidTest,
    cancelTest: mockCancelTest,
    releaseTest: mockReleaseTest,
    validateTest: mockValidateTest,
    bulkValidateTests: (...a: unknown[]) => mockBulkValidateTests(...a) as unknown,
    templates: [{ id: 'tpl-1', name: 'SCBA Evaluation' }],
    loadTemplates: mockLoadTemplates,
  }),
}));

const mockToastSuccess = vi.fn<(message: string) => void>();
const mockToastError = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (message: string) => mockToastSuccess(message),
    error: (message: string) => mockToastError(message),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('SkillsTestingTestRecordsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTests = [];
    mockTestsTotal = 0;
    mockCancelTest.mockResolvedValue(undefined);
    mockDeleteTest.mockResolvedValue(undefined);
    mockValidateTest.mockResolvedValue(undefined);
  });

  // An unfinished test is the one row with work waiting on it, and it read as
  // muted grey status text that said nothing about being the way back in.
  describe('Resuming an unfinished test', () => {
    it('invites the officer back into a test that was left part-done', () => {
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      expect(screen.getByText('Tap to resume')).toBeInTheDocument();
    });

    // A cancelled test is closed. It has no completion date, so gating the
    // affordance on `completed_at` offered it as resumable and routed it to the
    // scoring screen — the one row the guide calls read-only.
    it('offers no way back into a cancelled test', () => {
      mockTests = [cancelledTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      expect(screen.queryByText('Tap to resume')).not.toBeInTheDocument();
      expect(screen.queryByText('Tap to start')).not.toBeInTheDocument();
    });

    it('opens a cancelled test on its scorecard, not the scoring screen', async () => {
      const user = userEvent.setup();
      mockTests = [cancelledTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByText('Ladder Evolution'));

      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-3');
    });

    it('opens an unfinished test on the scoring screen', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByText('SCBA Evaluation'));

      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-2/active');
    });

    it('opens a finished test on its scorecard', async () => {
      const user = userEvent.setup();
      mockTests = [completedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByText('SCBA Evaluation'));

      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-1');
    });
  });

  // These were window.confirm / window.prompt. A browser may suppress a prompt,
  // and a suppressed one returns null — indistinguishable from "cancelled" — so
  // cancelling a test could silently do nothing.
  describe('Closing out a test', () => {
    it('asks in-app before cancelling, and keeps the reason optional', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /cancel unfinished test for John Smith/i }));
      expect(await screen.findByText('Cancel unfinished test')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^cancel test$/i }));

      expect(mockCancelTest).toHaveBeenCalledWith('test-2', undefined);
    });

    it('passes a typed reason through to the cancel call', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /cancel unfinished test for John Smith/i }));
      await user.type(await screen.findByLabelText(/reason/i), 'Drill called off for a run');
      await user.click(screen.getByRole('button', { name: /^cancel test$/i }));

      expect(mockCancelTest).toHaveBeenCalledWith('test-2', 'Drill called off for a run');
    });

    it('does not cancel when the officer backs out', async () => {
      const user = userEvent.setup();
      mockTests = [unfinishedTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /cancel unfinished test for John Smith/i }));
      await user.click(await screen.findByRole('button', { name: /keep it open/i }));

      expect(mockCancelTest).not.toHaveBeenCalled();
    });

    it('confirms in-app before deleting a practice attempt', async () => {
      const user = userEvent.setup();
      mockTests = [practiceTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /delete practice attempt for John Smith/i }));
      expect(await screen.findByText('Delete practice attempt?')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      expect(mockDeleteTest).toHaveBeenCalledWith('test-3');
    });
  });

  describe('Validating a member-run result', () => {
    it('spells out what accepting the result does before doing it', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /validate result for John Smith/i }));

      expect(await screen.findByText('Validate this result?')).toBeInTheDocument();
      expect(screen.getByText(/uses one of their attempts/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^validate$/i }));

      expect(mockValidateTest).toHaveBeenCalledWith('test-4');
    });
  });

  // After a drill night the queue is a list of peer-run results to sign off.
  // Selection is confined to that view: elsewhere the list mixes drafts,
  // practice runs and closed records, and no single action spans them.
  describe('The review queue', () => {
    const secondPending = { ...pendingTest, id: 'test-5', candidate_name: 'Dana Ruiz' };

    async function openQueue(user: ReturnType<typeof userEvent.setup>) {
      await user.selectOptions(screen.getByLabelText(/filter by status/i), 'pending_validation');
    }

    it('offers no selection outside the queue', () => {
      mockTests = [completedTest, pendingTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      expect(screen.queryByLabelText(/select every result/i)).not.toBeInTheDocument();
    });

    it('selects and accepts the chosen results', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest, secondPending];
      mockBulkValidateTests.mockResolvedValue({ validated: ['test-4'], skipped: [] });
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await openQueue(user);

      await user.click(await screen.findByLabelText(/select john smith's scba evaluation result/i));
      await user.click(screen.getByRole('button', { name: /accept 1/i }));

      expect(mockBulkValidateTests).toHaveBeenCalledWith(['test-4']);
    });

    it('select-all covers exactly what is on screen', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest, secondPending];
      mockBulkValidateTests.mockResolvedValue({ validated: ['test-4', 'test-5'], skipped: [] });
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await openQueue(user);

      await user.click(await screen.findByLabelText(/select every result/i));
      await user.click(screen.getByRole('button', { name: /accept 2/i }));

      expect(mockBulkValidateTests).toHaveBeenCalledWith(['test-4', 'test-5']);
    });

    // The list is paged, so a search in the browser would only ever search
    // the page on screen. It goes to the server with the queue's own filter.
    it('searches the queue on the server', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest, secondPending];
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await openQueue(user);
      await user.type(screen.getByPlaceholderText(/search tests/i), 'Dana');

      await waitFor(() =>
        expect(mockLoadTests).toHaveBeenLastCalledWith(
          expect.objectContaining({ pending_validation: true, search: 'Dana', offset: 0 })
        )
      );
    });

    it('cannot accept with nothing selected', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await openQueue(user);

      expect(await screen.findByRole('button', { name: /^accept$/i })).toBeDisabled();
    });

    // Partial success is the normal outcome — a colleague may have acted on one
    // of the selection since the queue loaded. Reported, or the officer walks
    // away believing the queue is clear.
    it('reports what could not be accepted', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest, secondPending];
      mockBulkValidateTests.mockResolvedValue({
        validated: ['test-4'],
        skipped: [{ test_id: 'test-5', reason: 'No attempts remaining' }],
      });
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await openQueue(user);

      await user.click(await screen.findByLabelText(/select every result/i));
      await user.click(screen.getByRole('button', { name: /accept 2/i }));

      expect(mockToastSuccess).toHaveBeenCalledWith('Accepted 1');
      expect(mockToastError).toHaveBeenCalledWith('1 could not be accepted: No attempts remaining');
    });

    it('clears the selection when the filter changes', async () => {
      const user = userEvent.setup();
      mockTests = [pendingTest];
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await openQueue(user);
      await user.click(await screen.findByLabelText(/select every result/i));
      expect(screen.getByRole('button', { name: /accept 1/i })).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText(/filter by status/i), 'completed');
      await openQueue(user);

      expect(await screen.findByRole('button', { name: /^accept$/i })).toBeDisabled();
    });
  });

  // SKT3-2: the tab used to fetch the department's whole history on every
  // load, and export it the same way.
  describe('Paging and the export window', () => {
    const lastLoad = (): SkillTestListParams => {
      const calls = mockLoadTests.mock.calls;
      return calls[calls.length - 1]?.[0] ?? {};
    };

    afterEach(() => {
      window.history.pushState({}, '', '/');
    });

    it('loads the first page of the last twelve months', () => {
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      const params = lastLoad();
      expect(params.limit).toBe(25);
      expect(params.offset).toBe(0);
      expect(calendarDaysBetween(params.date_to, params.date_from)).toBe(365);
    });

    it('pages through the server rather than the browser', async () => {
      const user = userEvent.setup();
      mockTests = [completedTest];
      mockTestsTotal = 60;
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      expect(screen.getByText('60')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /next page/i }));

      expect(lastLoad()).toEqual(expect.objectContaining({ limit: 25, offset: 25 }));
    });

    it('offers no pager when everything fits on one page', () => {
      mockTests = [completedTest];
      mockTestsTotal = 1;
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
    });

    it('exports exactly the range and filters on screen', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillsTestingTestRecordsTab />);
      await user.selectOptions(screen.getByLabelText(/filter by status/i), 'completed');

      const params = lastLoad();
      const link = screen.getByRole('link', { name: /export/i });
      const query = new URL(link.getAttribute('href') ?? '', 'http://x').searchParams;
      expect(query.get('detail')).toBe('criteria');
      expect(query.get('status')).toBe('completed');
      expect(query.get('date_from')).toBe(params.date_from);
      expect(query.get('date_to')).toBe(params.date_to);
      // Paging is the list's business; the file is the whole filtered set.
      expect(query.has('limit')).toBe(false);
      expect(query.has('offset')).toBe(false);
    });

    it('cannot export once the range is cleared, and says why', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      await user.click(screen.getByRole('button', { name: /clear date range/i }));

      expect(screen.queryByRole('link', { name: /export/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /export unavailable/i })).toBeDisabled();
      expect(screen.getByText(/choose a date range to export/i)).toBeInTheDocument();
      expect(lastLoad().date_from).toBeUndefined();
    });

    // The Needs Validation tile counts every result awaiting sign-off; a
    // default window would hide the oldest ones behind it.
    it('opens the review queue from its deep link undated', () => {
      window.history.pushState({}, '', '/?status=pending_validation');
      renderWithRouter(<SkillsTestingTestRecordsTab />);

      const params = lastLoad();
      expect(params.pending_validation).toBe(true);
      expect(params.date_from).toBeUndefined();
      expect(params.date_to).toBeUndefined();
    });
  });
});
