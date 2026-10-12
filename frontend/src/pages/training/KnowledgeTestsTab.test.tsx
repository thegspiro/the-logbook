import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { KnowledgeTest, KnowledgeTestDetail } from '../../types/knowledgeTest';
import { newQuestion, questionProblem } from '../../utils/knowledgeTestForm';

const list = vi.fn();
const get = vi.fn();
const create = vi.fn();
const update = vi.fn();
const addQuestion = vi.fn();
const listAttempts = vi.fn();
const getRequirementsEnhanced = vi.fn();

vi.mock('../../services/knowledgeTestService', () => ({
  knowledgeTestService: {
    list: (...a: unknown[]) => list(...a) as unknown,
    get: (...a: unknown[]) => get(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
    update: (...a: unknown[]) => update(...a) as unknown,
    addQuestion: (...a: unknown[]) => addQuestion(...a) as unknown,
    replaceQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    remove: vi.fn(),
    listAttempts: (...a: unknown[]) => listAttempts(...a) as unknown,
  },
}));
vi.mock('../../services/api', () => ({
  trainingProgramService: {
    getRequirementsEnhanced: (...a: unknown[]) => getRequirementsEnhanced(...a) as unknown,
  },
}));

import KnowledgeTestsTab from './KnowledgeTestsTab';

const detail = (over: Partial<KnowledgeTestDetail> = {}): KnowledgeTestDetail => ({
  id: 't1',
  name: 'Hazmat Awareness',
  description: null,
  instructions: null,
  requirement_id: null,
  requirement_name: null,
  passing_score: null,
  effective_passing_score: 70,
  time_limit_minutes: null,
  question_count: null,
  shuffle_questions: true,
  show_correct_answers: false,
  status: 'draft',
  active_question_count: 0,
  attempt_count: 0,
  my_latest_attempt: null,
  created_at: null,
  updated_at: null,
  questions: [],
  ...over,
});

describe('KnowledgeTestsTab', () => {
  beforeEach(() => {
    for (const m of [list, get, create, update, addQuestion, listAttempts, getRequirementsEnhanced]) m.mockReset();
    list.mockResolvedValue([] as KnowledgeTest[]);
    get.mockResolvedValue(detail());
    create.mockResolvedValue(detail());
    update.mockResolvedValue(detail());
    addQuestion.mockResolvedValue(detail());
    listAttempts.mockResolvedValue([]);
    getRequirementsEnhanced.mockResolvedValue([
      { id: 'r1', name: 'Hazmat Exam', requirement_type: 'knowledge_test' },
      { id: 'r2', name: 'Annual hours', requirement_type: 'hours' },
    ]);
  });

  it('creates a test omitting blank settings, then opens its editor', async () => {
    const user = userEvent.setup();
    renderWithRouter(<KnowledgeTestsTab />);
    await screen.findByText('No knowledge tests yet');
    await user.click(screen.getAllByRole('button', { name: /new test/i })[0] ?? document.body);
    await user.type(screen.getByLabelText('Name'), 'Hazmat Awareness');
    await user.selectOptions(screen.getByLabelText(/counts toward requirement/i), 'r1');
    // Only knowledge-test requirements are offered.
    expect(screen.queryByRole('option', { name: 'Annual hours' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      name: 'Hazmat Awareness',
      description: undefined,
      instructions: undefined,
      requirement_id: 'r1',
      passing_score: undefined,
      time_limit_minutes: undefined,
      question_count: undefined,
      shuffle_questions: true,
      show_correct_answers: false,
    });
    expect(await screen.findByRole('heading', { name: 'Questions' })).toBeInTheDocument();
  });

  it('adds a true/false question with its answer marked', async () => {
    list.mockResolvedValue([detail()]);
    const user = userEvent.setup();
    renderWithRouter(<KnowledgeTestsTab />);
    await user.click(await screen.findByRole('button', { name: /questions & results/i }));
    await user.click(await screen.findByRole('button', { name: /add question/i }));
    await user.type(screen.getByLabelText('Question'), 'The ERG is revised every four years.');
    await user.selectOptions(screen.getByLabelText('Type'), 'true_false');
    await user.click(screen.getByLabelText('Option 2 is correct'));
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    await waitFor(() => expect(addQuestion).toHaveBeenCalled());
    expect(addQuestion).toHaveBeenCalledWith('t1', {
      prompt: 'The ERG is revised every four years.',
      question_type: 'true_false',
      options: [
        { id: undefined, text: 'True', correct: false },
        { id: undefined, text: 'False', correct: true },
      ],
      explanation: null,
      points: 1,
      active: true,
    });
  });
});

describe('questionProblem', () => {
  it('names what is missing', () => {
    expect(questionProblem(newQuestion())).toBe('Write the question');
    const q = {
      ...newQuestion(),
      prompt: 'Q',
      options: [
        { text: 'a', correct: true },
        { text: 'A', correct: false },
      ],
    };
    expect(questionProblem(q)).toBe('Two options have the same text');
    const none = {
      ...q,
      options: [
        { text: 'a', correct: false },
        { text: 'b', correct: false },
      ],
    };
    expect(questionProblem(none)).toBe('Mark the one correct answer');
    expect(questionProblem({ ...none, type: 'multiple_choice' })).toBe('Mark at least one correct answer');
    expect(
      questionProblem({
        ...q,
        options: [
          { text: 'a', correct: true },
          { text: 'b', correct: false },
        ],
      })
    ).toBeNull();
  });
});
