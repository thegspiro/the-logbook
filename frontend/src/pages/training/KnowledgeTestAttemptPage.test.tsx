import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderWithRouter } from '../../test/utils';
import type { KnowledgeAttempt } from '../../types/knowledgeTest';

const getAttempt = vi.fn();
const saveAnswers = vi.fn();
const submitAttempt = vi.fn();

vi.mock('../../services/knowledgeTestService', () => ({
  knowledgeTestService: {
    getAttempt: (...args: unknown[]) => getAttempt(...args) as unknown,
    saveAnswers: (...args: unknown[]) => saveAnswers(...args) as unknown,
    submitAttempt: (...args: unknown[]) => submitAttempt(...args) as unknown,
  },
}));

import { KnowledgeTestAttemptPage } from './KnowledgeTestAttemptPage';

const open = (over: Partial<KnowledgeAttempt> = {}): KnowledgeAttempt => ({
  id: 'a1',
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
  test_name: 'Hazmat Awareness',
  instructions: 'Answer every question.',
  passing_score: 80,
  points_earned: null,
  points_possible: null,
  answers: {},
  questions: [
    {
      id: 'q1',
      prompt: 'Placard colour for flammable liquids?',
      question_type: 'single_choice',
      options: [
        { id: 'o1', text: 'Red' },
        { id: 'o2', text: 'Green' },
      ],
      points: 1,
    },
    {
      id: 'q2',
      prompt: 'Which are PPE levels?',
      question_type: 'multiple_choice',
      options: [
        { id: 'o3', text: 'Level A' },
        { id: 'o4', text: 'Level B' },
      ],
      points: 1,
    },
  ],
  review: null,
  seconds_remaining: null,
  ...over,
});

const renderPage = () => {
  window.history.pushState({}, '', '/training/knowledge-tests/attempts/a1');
  return renderWithRouter(
    <Routes>
      <Route path="/training/knowledge-tests/attempts/:attemptId" element={<KnowledgeTestAttemptPage />} />
    </Routes>
  );
};

describe('KnowledgeTestAttemptPage', () => {
  beforeEach(() => {
    getAttempt.mockReset();
    saveAnswers.mockReset();
    submitAttempt.mockReset();
    getAttempt.mockResolvedValue(open());
    saveAnswers.mockResolvedValue(open());
  });

  it('saves the picked options, never a score', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('Red'));
    await user.click(screen.getByLabelText('Level A'));
    await user.click(screen.getByLabelText('Level B'));

    await waitFor(() => expect(saveAnswers).toHaveBeenLastCalledWith('a1', { q1: ['o1'], q2: ['o3', 'o4'] }));
  });

  it('warns about unanswered questions before submitting, then shows the result', async () => {
    submitAttempt.mockResolvedValue(
      open({
        status: 'submitted',
        score: 50,
        passed: false,
        points_earned: 1,
        points_possible: 2,
        credited: true,
        questions: [],
        review: null,
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('Red'));
    await user.click(screen.getByRole('button', { name: 'Submit answers' }));

    expect(await screen.findByText(/1 question is unanswered/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText(/Not passed — 50%/)).toBeInTheDocument();
    expect(screen.getByText('This result was recorded on your training requirement.')).toBeInTheDocument();
    expect(screen.getByText('This test does not show the answers after submission.')).toBeInTheDocument();
    expect(saveAnswers).toHaveBeenCalledWith('a1', { q1: ['o1'] });
  });

  it('shows the answers when the test allows it', async () => {
    getAttempt.mockResolvedValue(
      open({
        status: 'submitted',
        score: 100,
        passed: true,
        answers: { q1: ['o1'] },
        questions: [],
        review: [
          {
            id: 'q1',
            prompt: 'Placard colour for flammable liquids?',
            question_type: 'single_choice',
            options: [
              { id: 'o1', text: 'Red' },
              { id: 'o2', text: 'Green' },
            ],
            points: 1,
            correct: true,
            correct_option_ids: ['o1'],
            explanation: 'Class 3 placards are red.',
          },
        ],
      })
    );
    renderPage();
    expect(await screen.findByText(/Passed — 100%/)).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Class 3 placards are red.')).toBeInTheDocument();
  });

  it('counts down a timed attempt from the server clock', async () => {
    getAttempt.mockResolvedValue(open({ seconds_remaining: 125 }));
    renderPage();
    expect(await screen.findByText('2:05 left')).toBeInTheDocument();
  });
});
