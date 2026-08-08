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

let currentMockTest:
  | typeof mockCompletedTest
  | typeof mockInProgressTest
  | typeof mockInProgressPracticeTest
  | typeof mockTestWithSections
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

  describe('Draft test view', () => {
    it('should show section indicator for draft tests', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText(/Section 1 of/)).toBeInTheDocument();
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

    it('should have Save and Complete Test buttons', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /complete test/i })).toBeInTheDocument();
    });

    it('should show timer controls', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      // Timer display should show 00:00
      expect(screen.getByText('00:00')).toBeInTheDocument();
      // Should have play/pause button
      expect(screen.getByRole('button', { name: /start timer/i })).toBeInTheDocument();
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

      await user.click(screen.getByRole('button', { name: /complete test/i }));

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
      await user.click(screen.getByRole('button', { name: /complete test/i }));
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
      await user.click(screen.getByRole('button', { name: /complete test/i }));
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
      await user.click(screen.getByRole('button', { name: /complete test/i }));

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
      await user.click(screen.getByRole('button', { name: /complete test/i }));
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
      await user.click(screen.getByRole('button', { name: /complete test/i }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to save progress'));
    });
  });
});
