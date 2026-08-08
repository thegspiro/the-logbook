import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ActiveSkillTestPage from './ActiveSkillTestPage';

// Mock the store
const mockLoadTest = vi.fn();
const mockUpdateTest = vi.fn();
const mockCompleteTest = vi.fn();
const mockSetActiveSectionIndex = vi.fn();
const mockSetActiveTestTimer = vi.fn();
const mockSetActiveTestRunning = vi.fn();
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

let currentMockTest: typeof mockCompletedTest | typeof mockInProgressTest | typeof mockInProgressPracticeTest | null =
  null;

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: Object.assign(
    vi.fn((selector) => {
      const state = {
        currentTest: currentMockTest,
        testLoading: false,
        loadTest: mockLoadTest,
        updateTest: mockUpdateTest,
        completeTest: mockCompleteTest,
        activeTestTimer: 0,
        activeTestRunning: false,
        activeSectionIndex: 0,
        setActiveSectionIndex: mockSetActiveSectionIndex,
        setActiveTestTimer: mockSetActiveTestTimer,
        setActiveTestRunning: mockSetActiveTestRunning,
        updateCriterionResult: mockUpdateCriterionResult,
        clearCurrentTest: mockClearCurrentTest,
      };
      if (typeof selector === 'function') {
        return (selector as (s: typeof state) => unknown)(state);
      }
      return state;
    }),
    {
      getState: () => ({ activeTestTimer: 0 }),
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

    // Regression: the pre-submit save sends elapsed_seconds, which update_test
    // refuses on a completed test. If a previous attempt completed server-side
    // but its response never arrived (a dropped connection mid-drill), retrying
    // re-ran that save and failed permanently on a test that had gone through.
    it('should show existing results instead of re-saving an already-completed test', async () => {
      const user = userEvent.setup();
      currentMockTest = mockInProgressPracticeTest;
      mockUpdateTest.mockResolvedValue(mockInProgressPracticeTest);
      // The server completes the test but the response never reaches the client.
      mockCompleteTest.mockImplementation(() => {
        currentMockTest = mockCompletedPracticeTest;
        return Promise.reject(new Error('Network Error'));
      });

      renderWithRouter(<ActiveSkillTestPage />);
      await user.click(screen.getByRole('button', { name: /complete test/i }));
      await user.click(await screen.findByRole('button', { name: /view results/i }));
      await waitFor(() => expect(mockCompleteTest).toHaveBeenCalledWith('test-1'));

      const savesBeforeRetry = mockUpdateTest.mock.calls.length;
      await user.click(screen.getByRole('button', { name: /view results/i }));

      // The retry must not re-run the save the server would now reject; it
      // shows the results that already exist.
      expect(mockUpdateTest.mock.calls.length).toBe(savesBeforeRetry);
      expect(mockCompleteTest).toHaveBeenCalledTimes(1);
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
