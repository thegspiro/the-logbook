import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

let currentMockTest: typeof mockCompletedTest | typeof mockInProgressTest | null = null;

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
    },
  ),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
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
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('Completed test view', () => {
    it('should show test passed result', () => {
      currentMockTest = mockCompletedTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Test Passed')).toBeInTheDocument();
      expect(screen.getByText('95%')).toBeInTheDocument();
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
    it('should show ready to begin message for draft tests', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('Ready to Begin')).toBeInTheDocument();
    });

    it('should show template name in header', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('SCBA Evaluation')).toBeInTheDocument();
    });

    it('should show candidate name in header', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    it('should have Save Progress and Complete Test buttons', () => {
      currentMockTest = mockInProgressTest;
      renderWithRouter(<ActiveSkillTestPage />);

      expect(screen.getByRole('button', { name: /save progress/i })).toBeInTheDocument();
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

      expect(mockClearCurrentTest).toHaveBeenCalled();
    });
  });
});
