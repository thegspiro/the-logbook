import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const mockLoadTest = vi.fn();
const mockClearCurrentTest = vi.fn();
const mockDiscardPracticeTest = vi.fn();

const baseTest = {
  id: 'test-1',
  organization_id: 'org-1',
  template_id: 'tpl-1',
  template_name: 'SCBA Evaluation',
  candidate_id: 'user-1',
  candidate_name: 'John Smith',
  examiner_id: 'user-2',
  examiner_name: 'Captain Jones',
  status: 'completed' as string,
  result: 'pass' as string,
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

let currentMockTest: Record<string, unknown> | null = null;

vi.mock('../stores/skillsTestingStore', () => ({
  useSkillsTestingStore: Object.assign(
    vi.fn(() => ({
      currentTest: currentMockTest,
      testLoading: false,
      loadTest: mockLoadTest,
      clearCurrentTest: mockClearCurrentTest,
      discardPracticeTest: mockDiscardPracticeTest,
    })),
    { getState: () => ({}) }
  ),
}));

// Selector-aware: useTimezone calls useAuthStore((s) => s.user?.timezone), so a
// mock that ignores the selector hands back the whole state and breaks
// date formatting with "Invalid time zone".
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { user: { id: 'user-1', timezone: 'America/New_York' } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ testId: 'test-1' }),
  };
});

import MySkillTestResultPage from './MySkillTestResultPage';

describe('MySkillTestResultPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockTest = null;
  });

  it('shows the candidate their own official result', () => {
    currentMockTest = { ...baseTest };
    renderWithRouter(<MySkillTestResultPage />);

    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Overall score: 95%')).toBeInTheDocument();
    expect(screen.getByText('Official skills test')).toBeInTheDocument();
  });

  it('marks a practice attempt as not recorded', () => {
    currentMockTest = { ...baseTest, is_practice: true };
    renderWithRouter(<MySkillTestResultPage />);

    expect(screen.getByText(/not recorded against you/i)).toBeInTheDocument();
  });

  // The candidate may clear their own practice notes — that is the whole point
  // of storing practice attempts rather than discarding them at the buzzer.
  it('offers deletion of the candidate own practice attempt', () => {
    currentMockTest = { ...baseTest, is_practice: true };
    renderWithRouter(<MySkillTestResultPage />);

    expect(screen.getByRole('button', { name: /delete this practice attempt/i })).toBeInTheDocument();
  });

  // Official results are evaluation records: withdrawn by an officer's void,
  // never deleted by the member they were scored against.
  it('never offers deletion of an official result', () => {
    currentMockTest = { ...baseTest };
    renderWithRouter(<MySkillTestResultPage />);

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows the reason when a result has been voided', () => {
    currentMockTest = {
      ...baseTest,
      status: 'voided',
      void_reason: 'Scored against the wrong candidate',
      voided_by_name: 'Chief Adams',
      voided_at: '2026-01-16T09:00:00Z',
    };
    renderWithRouter(<MySkillTestResultPage />);

    expect(screen.getByText(/no longer counts/i)).toBeInTheDocument();
    expect(screen.getByText(/Scored against the wrong candidate/)).toBeInTheDocument();
    expect(screen.getByText(/Chief Adams/)).toBeInTheDocument();
  });

  it('loads the test on mount and clears it on unmount', () => {
    currentMockTest = { ...baseTest };
    const { unmount } = renderWithRouter(<MySkillTestResultPage />);

    expect(mockLoadTest).toHaveBeenCalledWith('test-1');
    unmount();
    expect(mockClearCurrentTest).toHaveBeenCalledWith();
  });
});
