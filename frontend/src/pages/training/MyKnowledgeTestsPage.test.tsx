import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { KnowledgeTest } from '../../types/knowledgeTest';

const list = vi.fn();
const startAttempt = vi.fn();
vi.mock('../../services/knowledgeTestService', () => ({
  knowledgeTestService: {
    list: (...a: unknown[]) => list(...a) as unknown,
    startAttempt: (...a: unknown[]) => startAttempt(...a) as unknown,
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { MyKnowledgeTestsPage } from './MyKnowledgeTestsPage';

const test = (over: Partial<KnowledgeTest> = {}): KnowledgeTest => ({
  id: 't1',
  name: 'Hazmat Awareness',
  description: null,
  instructions: null,
  requirement_id: 'r1',
  requirement_name: 'Hazmat Exam',
  passing_score: null,
  effective_passing_score: 80,
  time_limit_minutes: 20,
  question_count: 10,
  shuffle_questions: true,
  show_correct_answers: false,
  status: 'published',
  active_question_count: 10,
  attempt_count: 0,
  my_latest_attempt: null,
  created_at: null,
  updated_at: null,
  ...over,
});

describe('MyKnowledgeTestsPage', () => {
  beforeEach(() => {
    list.mockReset();
    startAttempt.mockReset();
    mockNavigate.mockReset();
  });

  it('starts a test and opens the attempt', async () => {
    list.mockResolvedValue([test()]);
    startAttempt.mockResolvedValue({ id: 'a1' });
    const user = userEvent.setup();
    renderWithRouter(<MyKnowledgeTestsPage />);

    expect(await screen.findByText('Counts toward: Hazmat Exam')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/training/knowledge-tests/attempts/a1'));
    expect(startAttempt).toHaveBeenCalledWith('t1');
  });

  it('offers to continue an open attempt and shows the last result', async () => {
    list.mockResolvedValue([
      test({
        my_latest_attempt: {
          id: 'a0',
          test_id: 't1',
          user_id: 'u1',
          user_name: 'Mary',
          status: 'in_progress',
          started_at: '2026-10-01T10:00:00Z',
          expires_at: null,
          submitted_at: null,
          score: null,
          passed: null,
          credited: false,
          credit_note: null,
        },
      }),
    ]);
    renderWithRouter(<MyKnowledgeTestsPage />);
    expect(await screen.findByRole('button', { name: /continue/i })).toBeInTheDocument();
  });
});
