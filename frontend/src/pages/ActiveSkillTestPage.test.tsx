import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ActiveSkillTestPage from './ActiveSkillTestPage';

// Mock the store
const mockLoadTest = vi.fn();
const mockUpdateTest = vi.fn();
const mockCompleteTest = vi.fn();
const mockSetActiveSectionIndex = vi.fn<(index: number) => void>();
const mockSetActiveTestTimer = vi.fn();
const mockSetActiveTestRunning = vi.fn<(running: boolean) => void>();
const mockUpdateCriterionResult = vi.fn();
const mockClearCurrentTest = vi.fn();

const mockCompletedTest = {
  id: 'test-1',
  organization_id: 'org-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Evaluation',
  candidate_id: 'user-1',
  candidate_name: 'John Smith',
  examiner_id: 'user-2',
  examiner_name: 'Captain Jones',
  status: 'completed' as const,
  result: 'pass' as const,
  is_practice: false,
  section_results: [],
  overall_score: 95,
  elapsed_seconds: 180,
  notes: '',
  started_at: '2026-01-15T10:00:00Z',
  completed_at: '2026-01-15T10:30:00Z',
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:30:00Z',
};

const mockInProgressTest = {
  ...mockCompletedTest,
  status: 'draft' as const,
  result: 'incomplete' as const,
  overall_score: undefined,
  completed_at: undefined,
};

const mockInProgressPracticeTest = {
  ...mockInProgressTest,
  is_practice: true,
};

const mockCompletedPracticeTest = {
  ...mockCompletedTest,
  is_practice: true,
};

/** Abandoned mid-session. update_test rejects every write to it with a 400. */
const mockCancelledTest = {
  ...mockCompletedTest,
  status: 'cancelled' as const,
  result: 'incomplete' as const,
  overall_score: undefined,
  completed_at: undefined,
};

const mockVoidedTest = {
  ...mockCompletedTest,
  status: 'voided' as const,
  voided_at: '2026-01-16T09:00:00Z',
  voided_by_name: 'Chief Adams',
  void_reason: 'Scored against the wrong candidate',
};

/** A two-section scorecard: a statement that marks itself, then scoreable steps. */
const mockTestWithSections = {
  ...mockInProgressPracticeTest,
  template_sections: [
    {
      name: 'Donning',
      criteria: [
        { label: 'Read this to the candidate', type: 'statement', statement_text: 'You have two minutes.' },
        { label: 'Straps tightened', type: 'pass_fail', required: true },
      ],
    },
    {
      name: 'Doffing',
      criteria: [{ label: 'Mask stowed', type: 'pass_fail' }],
    },
  ] as unknown as Record<string, unknown>[],
};

/** A scorecard whose first section is a stopwatch step. */
const mockTimedTest = {
  ...mockInProgressPracticeTest,
  template_sections: [
    {
      name: 'Hose advance',
      criteria: [{ label: 'Advance to the door', type: 'time_limit', required: true, time_limit_seconds: 60 }],
    },
    {
      name: 'Doffing',
      criteria: [{ label: 'Mask stowed', type: 'pass_fail' }],
    },
  ] as unknown as Record<string, unknown>[],
};

/** A single checklist step — the type with no obvious way to record a failure. */
const mockChecklistTest = {
  ...mockInProgressPracticeTest,
  template_sections: [
    {
      name: 'Tools',
      criteria: [
        { label: 'Carried the right tools', type: 'checklist', required: true, checklist_items: ['Halligan', 'Axe'] },
      ],
    },
  ] as unknown as Record<string, unknown>[],
};

/** A single scored step, already given full marks. */
const mockScoredStepTest = {
  ...mockInProgressPracticeTest,
  template_sections: [
    {
      name: 'Ladder',
      criteria: [{ label: 'Climb angle', type: 'score', required: true, max_score: 3, passing_score: 2 }],
    },
  ] as unknown as Record<string, unknown>[],
  section_results: [
    {
      section_id: 'section-0',
      section_name: 'Ladder',
      criteria_results: [{ criterion_id: 'criterion-0-0', passed: true, score: 3 }],
    },
  ],
};

/** The same scorecard with every scoreable step already marked. */
const mockFullyScoredTest = {
  ...mockTestWithSections,
  section_results: [
    {
      section_id: 'section-0',
      section_name: 'Donning',
      criteria_results: [
        { criterion_id: 'criterion-0-0', passed: true },
        { criterion_id: 'criterion-0-1', passed: true },
      ],
    },
    {
      section_id: 'section-1',
      section_name: 'Doffing',
      criteria_results: [{ criterion_id: 'criterion-1-0', passed: false }],
    },
  ],
};

let currentMockTest:
  | typeof mockCompletedTest
  | typeof mockInProgressTest
  | typeof mockInProgressPracticeTest
  | typeof mockTestWithSections
  | typeof mockTimedTest
  | typeof mockChecklistTest
  | typeof mockScoredStepTest
  | typeof mockFullyScoredTest
  | typeof mockVoidedTest
  | typeof mockCancelledTest
  | null = null;
// The page reads the running flag through getState() as well as through the
// hook, so the mock has to hold it like the real store does.
let mockTimerRunning = false;
let mockSectionIndex = 0;

function buildStoreState() {
  return {
    currentTest: currentMockTest,
    testLoading: false,
    loadTest: mockLoadTest,
    updateTest: mockUpdateTest,
    completeTest: mockCompleteTest,
    activeTestTimer: 0,
    activeTestRunning: mockTimerRunning,
    activeSectionIndex: mockSectionIndex,
    setActiveSectionIndex: mockSetActiveSectionIndex,
    setActiveTestTimer: mockSetActiveTestTimer,
    setActiveTestRunning: mockSetActiveTestRunning,
    updateCriterionResult: mockUpdateCriterionResult,
    clearCurrentTest: mockClearCurrentTest,
  };
}

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: Object.assign(
    vi.fn((selector) => {
      const state = buildStoreState();
      if (typeof selector === 'function') {
        return (selector as (s: typeof state) => unknown)(state);
      }
      return state;
    }),
    {
      getState: () => buildStoreState(),
    }
  ),
}));

const mockToastError = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: (message: string) => mockToastError(message),
  },
}));

// Mock react-router
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ testId: 'test-1' }),
  };
});

describe('ActiveSkillTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockTest = null;
    mockTimerRunning = false;
    mockSectionIndex = 0;
    mockSetActiveTestRunning.mockImplementation((running: boolean) => {
      mockTimerRunning = running;
    });
    mockSetActiveSectionIndex.mockImplementation((index: number) => {
      mockSectionIndex = index;
    });
    mockUpdateTest.mockResolvedValue(currentMockTest);
    mockLoadTest.mockResolvedValue(undefined);
  });

  describe('Loading state', () => {
    it('should show loading spinner when test is loading', () => {
      currentMockTest = null;
      renderWithRouter(<ActiveSkillTestPage />);

      // Should show the loading spinner (test is null so it shows loading)
      expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Completed test view', () => {
    it('should show test passed result', () => {
      currentMockTest = mockCompletedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Passed')).toBeInTheDocument();
      expect(screen.getByText('Overall Score: 95%')).toBeInTheDocument();
    });

    it('should show candidate name', () => {
      currentMockTest = mockCompletedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    it('should show elapsed time', () => {
      currentMockTest = mockCompletedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('3:00')).toBeInTheDocument();
    });

    it('should show back to tests button', () => {
      currentMockTest = mockCompletedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByRole('button', { name: /back to tests/i })).toBeInTheDocument();
    });
  });

  describe('Voided test view', () => {
    // A voided test used to fall through to the live evaluation screen, which
    // offered editable criteria and a Complete Test button for a record the
    // API refuses every write on.
    it('should show the read-only result view, not the live evaluation screen', () => {
      currentMockTest = mockVoidedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.queryByRole('button', { name: /finish/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back to tests/i })).toBeInTheDocument();
    });

    it('should state the result was withdrawn rather than showing it as a standing pass', () => {
      currentMockTest = mockVoidedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Voided')).toBeInTheDocument();
      expect(screen.getByText(/withdrawn and counts toward nothing/)).toBeInTheDocument();
      expect(screen.queryByText('Passed')).not.toBeInTheDocument();
    });
  });

  // A cancelled test used to fall through to the live evaluation screen, for
  // the same reason a voided one did — but that fix only covered voided. The
  // API refuses every write to a cancelled test with a 400.
  describe('Cancelled test view', () => {
    it('should show the read-only result view, not the live evaluation screen', () => {
      currentMockTest = mockCancelledTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.queryByRole('button', { name: /finish/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back to tests/i })).toBeInTheDocument();
    });

    it('should state that nothing was decided rather than showing a pass or fail', () => {
      currentMockTest = mockCancelledTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Cancelled')).toBeInTheDocument();
      expect(screen.getByText(/closed out before it finished/)).toBeInTheDocument();
      expect(screen.queryByText('Passed')).not.toBeInTheDocument();
      expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    });
  });

  describe('Draft test view', () => {
    it('should show section indicator for draft tests', () => {
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Section 1 of 2')).toBeInTheDocument();
    });

    // A blank body under a running clock tells the examiner nothing. This is
    // reachable whenever a template was published with no steps in it.
    it('should explain itself when the template has no steps', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Nothing to score on this test')).toBeInTheDocument();
    });

    it('should show template name in header', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('SCBA Evaluation')).toBeInTheDocument();
    });

    it('should show template name in header for draft test', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('SCBA Evaluation')).toBeInTheDocument();
    });

    it('should have Save and Finish buttons', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /finish & review/i })).toBeInTheDocument();
    });

    it('should show timer controls', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      // Timer display should show 00:00
      expect(screen.getByText('00:00')).toBeInTheDocument();
      // Should have play/pause button
      expect(screen.getByRole('button', { name: /^start timer$/i })).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should load test on mount', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(mockLoadTest).toHaveBeenCalledWith('test-1');
    });

    it('should clear test on unmount', () => {
      currentMockTest = mockInProgressTest;
      const { unmount } = renderWithRouter(<ActiveSkillTestPage />);

      unmount();

      expect(mockClearCurrentTest).toHaveBeenCalledWith();
    });
  });

  // The examiner is watching the candidate, not the phone. A clock that only
  // runs when someone remembers to press play records 00:00 against skills whose
  // time limit is itself a pass/fail criterion.
  describe('Timer auto-start', () => {
    it('should start the clock when a criterion is scored', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: 'PASS' }));

      expect(mockSetActiveTestRunning).toHaveBeenCalledWith(true);
    });

    it('should stamp the test as under way without discarding what is already scored', async () => {
      const user = userEvent.setup();
      currentMockTest = { ...mockTestWithSections, section_results: [] };
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: 'PASS' }));

      // update_test returns the whole record and the store adopts the response,
      // so the status write has to carry the scoring with it.
      expect(mockUpdateTest).toHaveBeenCalledWith('test-1', {
        status: 'in_progress',
        section_results: [],
        elapsed_seconds: 0,
      });
    });

    it('should start the clock when moving to the next section', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(mockSetActiveSectionIndex).toHaveBeenCalledWith(1);
      expect(mockSetActiveTestRunning).toHaveBeenCalledWith(true);
    });

    // Statements mark themselves passed as the section renders. Treating that
    // as an examiner action would start timing the moment the test is opened,
    // before the candidate is anywhere near the equipment.
    it('should not start the clock for a statement marking itself on render', () => {
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      // The statement did mark itself — the point is that it did so silently.
      expect(mockUpdateCriterionResult).toHaveBeenCalledWith(
        'section-0',
        'criterion-0-0',
        { passed: true },
        'Donning',
        'Read this to the candidate'
      );
      expect(mockSetActiveTestRunning).not.toHaveBeenCalledWith(true);
    });

    // A pause is a decision — equipment reset, an interruption — and scoring
    // the step that follows must not silently restart the clock.
    it('should leave a deliberately paused clock alone', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      mockTimerRunning = true;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /pause timer/i }));
      expect(mockSetActiveTestRunning).toHaveBeenCalledWith(false);

      await user.click(screen.getByRole('button', { name: 'PASS' }));

      expect(mockSetActiveTestRunning).not.toHaveBeenCalledWith(true);
    });
  });

  // Regression: "View Results" navigates from /test/:id/active to /test/:id,
  // and both routes render THIS component, so react-router swaps the URL
  // without remounting. The review screen is shown whenever `reviewing` is set
  // and the results view is gated on `!reviewing`, so unless completing clears
  // the flag the page re-renders the identical review screen and the button
  // appears to do nothing at all.
  describe('Practice: View Results', () => {
    it('should show the results view after View Results is clicked', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;

      // Completing swaps the store's test for the scored one, as the real
      // completeTest action does.
      mockCompleteTest.mockImplementation(() => {
        currentMockTest = mockCompletedPracticeTest;
        return Promise.resolve(mockCompletedPracticeTest);
      });
      mockUpdateTest.mockResolvedValue(mockInProgressPracticeTest);

      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /finish/i }));

      const viewResults = await screen.findByRole('button', { name: /view results/i });
      await user.click(viewResults);

      // The results view — not the review screen — must now be on screen.
      expect(await screen.findByText('Practice Results')).toBeInTheDocument();
      expect(screen.getByText('Passed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /view results/i })).not.toBeInTheDocument();
    });

    it('should complete the test when View Results is clicked', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;
      mockCompleteTest.mockImplementation(() => {
        currentMockTest = mockCompletedPracticeTest;
        return Promise.resolve(mockCompletedPracticeTest);
      });
      mockUpdateTest.mockResolvedValue(mockInProgressPracticeTest);

      renderWithRouter(<ActiveSkillTestPage />);
      await user.click(screen.getByRole('button', { name: /finish/i }));
      await user.click(await screen.findByRole('button', { name: /view results/i }));

      await waitFor(() => expect(mockCompleteTest).toHaveBeenCalledWith('test-1'));
    });

    // The scoring commits server-side before its response reaches the phone, so
    // a timeout or a dropped cell connection surfaces as a failure on a test
    // that is in fact finished. The examiner used to be shown an error and had
    // to refresh the page to discover the results were already there.
    it('should show the filed results when the completion landed but its response did not', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;
      mockUpdateTest.mockResolvedValue(mockInProgressPracticeTest);
      mockCompleteTest.mockImplementation(() => {
        currentMockTest = mockCompletedPracticeTest;
        return Promise.reject(new Error('Network Error'));
      });

      renderWithRouter(<ActiveSkillTestPage />);
      await user.click(screen.getByRole('button', { name: /finish/i }));
      await user.click(await screen.findByRole('button', { name: /view results/i }));

      // Re-read from the server rather than trust the failed call.
      await waitFor(() => expect(mockLoadTest).toHaveBeenCalledWith('test-1'));
      expect(await screen.findByText('Practice Results')).toBeInTheDocument();
      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-1');
      expect(mockToastError).not.toHaveBeenCalled();
    });

    // The pre-submit save sends elapsed_seconds, which update_test refuses on a
    // completed test — so a screen still showing the review of a test that has
    // since been finalized must not re-run it.
    it('should show existing results instead of re-saving an already-completed test', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;
      // The save that opens the review screen comes back with the test already
      // finalized (an officer completed it from the admin screen meanwhile).
      mockUpdateTest.mockImplementation(() => {
        currentMockTest = mockCompletedPracticeTest;
        return Promise.resolve(mockCompletedPracticeTest);
      });

      renderWithRouter(<ActiveSkillTestPage />);
      await user.click(screen.getByRole('button', { name: /finish/i }));

      const savesBeforeViewResults = mockUpdateTest.mock.calls.length;
      await user.click(await screen.findByRole('button', { name: /view results/i }));

      expect(mockUpdateTest.mock.calls.length).toBe(savesBeforeViewResults);
      expect(mockCompleteTest).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing/test/test-1');
    });

    it('should report the server error rather than a fixed string', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;
      mockUpdateTest.mockResolvedValue(mockInProgressPracticeTest);
      mockCompleteTest.mockRejectedValue(
        Object.assign(new Error('Maximum attempts (2) reached for this requirement.'), {
          status: 400,
        })
      );

      renderWithRouter(<ActiveSkillTestPage />);
      await user.click(screen.getByRole('button', { name: /finish/i }));
      await user.click(await screen.findByRole('button', { name: /view results/i }));

      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith('Maximum attempts (2) reached for this requirement.')
      );
    });

    it('should name a concurrent edit when the server reports a conflict', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;
      mockUpdateTest.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));

      renderWithRouter(<ActiveSkillTestPage />);
      await user.click(screen.getByRole('button', { name: /finish/i }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to save progress'));
    });
  });

  // An examiner scoring a candidate in the field needs to know, without
  // hunting, who they are scoring, how much is left, and which sections still
  // have blanks in them.
  describe('Orientation while scoring', () => {
    it('should name the candidate on the scoring screen', () => {
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    it('should count the steps still to be scored', () => {
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      // Two scoreable steps across the two sections; the statement is not one.
      expect(screen.getByText('0/2')).toBeInTheDocument();
    });

    // The dots this replaced were 10px squares that said nothing about what was
    // done — the only way to find an unscored step was to walk every section.
    it('should label each section chip with what it still needs', () => {
      currentMockTest = mockFullyScoredTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByRole('button', { name: /Section 2, Doffing: 1 of 1 steps scored/ })).toBeInTheDocument();
      expect(screen.getByText('2/2')).toBeInTheDocument();
    });

    it('should jump to the section whose chip is tapped', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /Section 2, Doffing/ }));

      expect(mockSetActiveSectionIndex).toHaveBeenCalledWith(1);
    });
  });

  // The primary button used to be "Complete Test" on every section — the
  // biggest, reddest control on screen ended the evaluation, while moving on
  // was a small grey button beside it.
  describe('Bottom bar emphasis', () => {
    it('should offer Next, not Finish, as the main action mid-test', () => {
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^finish$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /finish & review/i })).not.toBeInTheDocument();
    });

    it('should promote Finish once the last section is showing', () => {
      currentMockTest = mockTestWithSections;
      mockSectionIndex = 1;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /finish & review/i })).toBeInTheDocument();
    });
  });

  // Finishing with blanks left is the failure mode with real consequences: the
  // scorer treats an unscored critical step exactly like a failed one.
  describe('Finishing with steps unscored', () => {
    it('should say how many steps are blank and what the critical ones cost', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /^finish$/i }));

      expect(await screen.findByText('Some steps have no score')).toBeInTheDocument();
      expect(screen.getByText(/2 steps still have no Pass or Fail/)).toBeInTheDocument();
      expect(screen.getByText(/1 of them is marked Critical, which scores the same as a fail/)).toBeInTheDocument();
    });

    it('should leave the examiner on the scoring screen when they choose to keep scoring', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /^finish$/i }));
      await user.click(await screen.findByRole('button', { name: /keep scoring/i }));

      expect(screen.queryByText('Some steps have no score')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^finish$/i })).toBeInTheDocument();
      expect(mockUpdateTest).not.toHaveBeenCalled();
    });

    it('should go straight to review when every step has been scored', async () => {
      const user = userEvent.setup();
      currentMockTest = mockFullyScoredTest;
      mockSectionIndex = 1;
      mockUpdateTest.mockResolvedValue(mockFullyScoredTest);
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /finish & review/i }));

      expect(await screen.findByText('Check the scorecard')).toBeInTheDocument();
      expect(screen.queryByText('Some steps have no score')).not.toBeInTheDocument();
    });
  });

  describe('Correcting a mark', () => {
    // A checklist only counted as scored once a box was ticked, so the case an
    // examiner most needs to record — the candidate did none of it — could only
    // be entered by ticking a box and unticking it again.
    it('should let a checklist be recorded as not done at all', async () => {
      const user = userEvent.setup();
      currentMockTest = mockChecklistTest;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /candidate did none of these/i }));

      expect(mockUpdateCriterionResult).toHaveBeenCalledWith(
        'section-0',
        'criterion-0-0',
        { checklist_completed: [false, false], passed: false },
        'Tools',
        'Carried the right tools'
      );
    });

    it('should clear a score when the same number is tapped again', async () => {
      const user = userEvent.setup();
      currentMockTest = mockScoredStepTest;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: '3' }));

      expect(mockUpdateCriterionResult).toHaveBeenCalledWith(
        'section-0',
        'criterion-0-0',
        { score: undefined, passed: null },
        'Ladder',
        'Climb angle'
      );
    });

    // Without this the only way out of a mis-tap is to record the opposite
    // verdict on a candidate — there is no other route back to "not scored".
    it('should clear a pass when the same button is tapped again', async () => {
      const user = userEvent.setup();
      currentMockTest = mockFullyScoredTest;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: 'PASS' }));

      expect(mockUpdateCriterionResult).toHaveBeenCalledWith(
        'section-0',
        'criterion-0-1',
        { passed: null },
        'Donning',
        'Straps tightened'
      );
    });
  });

  // The stopwatch on a timed step lives in that criterion's own component, and
  // the whole section is torn down on Prev/Next. Only Stop used to write a
  // value, so an examiner who timed an evolution and moved on lost the reading
  // on the very step whose time limit is the pass/fail criterion.
  describe('Timed steps', () => {
    it('should record a running stopwatch when the step is torn down', async () => {
      const user = userEvent.setup();
      // A stopwatch part-way through an evolution: 42s on the clock, no verdict
      // written yet, which is exactly the state Stop would have resolved.
      currentMockTest = {
        ...mockTimedTest,
        section_results: [
          {
            section_id: 'section-0',
            section_name: 'Hose advance',
            criteria_results: [{ criterion_id: 'criterion-0-0', passed: null, time_seconds: 42 }],
          },
        ],
      };
      const { unmount } = renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /start timer for advance to the door/i }));
      // Whatever removes the criterion — moving section, leaving the screen —
      // runs the same cleanup, and until now none of them wrote the reading.
      unmount();

      expect(mockUpdateCriterionResult).toHaveBeenCalledWith(
        'section-0',
        'criterion-0-0',
        { time_seconds: 42, passed: true },
        'Hose advance',
        'Advance to the door'
      );
    });

    // Until Stop is pressed the parent hears nothing, and that can be minutes
    // into an evolution that is already under way.
    it('should start the test clock when the stopwatch starts', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTimedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /start timer for advance to the door/i }));

      expect(mockSetActiveTestRunning).toHaveBeenCalledWith(true);
    });
  });

  // loadTest resets the section index, so returning to an interrupted
  // evaluation dropped the examiner at section 1 to hunt for where they got to.
  describe('Resuming an interrupted test', () => {
    it('should open at the first section that still has blank steps', () => {
      currentMockTest = {
        ...mockFullyScoredTest,
        status: 'in_progress' as const,
        section_results: [
          {
            section_id: 'section-0',
            section_name: 'Donning',
            criteria_results: [
              { criterion_id: 'criterion-0-0', passed: true },
              { criterion_id: 'criterion-0-1', passed: true },
            ],
          },
        ],
      };
      renderWithRouter(<ActiveSkillTestPage />);

      expect(mockSetActiveSectionIndex).toHaveBeenCalledWith(1);
    });

    // A draft has not been started, so there is nothing to resume — and being
    // dropped past section 1 on a fresh test would be baffling.
    it('should leave a test that has not been started at the top', () => {
      currentMockTest = { ...mockTestWithSections, status: 'draft' as const };
      renderWithRouter(<ActiveSkillTestPage />);

      expect(mockSetActiveSectionIndex).not.toHaveBeenCalled();
    });
  });

  describe('Leaving the test', () => {
    // Training Admin is officer-only. A member examiner, or anyone on a
    // practice run, came from the member-facing list and has to be sent back
    // to it — the header used to send everyone to the admin page.
    it('should return a practice run to the member-facing list', async () => {
      const user = userEvent.setup();
      currentMockTest = mockTestWithSections;
      renderWithRouter(<ActiveSkillTestPage />);

      await user.click(screen.getByRole('button', { name: /leave this test/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/training/skills-testing');
    });
  });
});
