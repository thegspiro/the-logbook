import type { KnowledgeQuestionAdmin, KnowledgeQuestionType } from '../types/knowledgeTest';

/** The question editor's form state. */
export interface QuestionForm {
  prompt: string;
  type: KnowledgeQuestionType;
  options: { id?: string | undefined; text: string; correct: boolean }[];
  explanation: string;
  points: string;
  active: boolean;
}

export const newQuestion = (): QuestionForm => ({
  prompt: '',
  type: 'single_choice',
  options: [
    { text: '', correct: true },
    { text: '', correct: false },
  ],
  explanation: '',
  points: '1',
  active: true,
});

export const trueFalseOptions = (correctIsTrue: boolean) => [
  { text: 'True', correct: correctIsTrue },
  { text: 'False', correct: !correctIsTrue },
];

export function questionFrom(q: KnowledgeQuestionAdmin): QuestionForm {
  return {
    prompt: q.prompt,
    type: q.question_type,
    options: q.options.map((o) => ({ id: o.id, text: o.text, correct: o.correct })),
    explanation: q.explanation ?? '',
    points: String(q.points),
    active: q.active,
  };
}

/** What is wrong with a question form, or null when it can be saved. */
export function questionProblem(form: QuestionForm): string | null {
  if (!form.prompt.trim()) return 'Write the question';
  const texts = form.options.map((o) => o.text.trim());
  if (texts.some((t) => !t)) return 'Every option needs text';
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) return 'Two options have the same text';
  const correct = form.options.filter((o) => o.correct).length;
  if (form.type === 'multiple_choice' ? correct < 1 : correct !== 1) {
    return form.type === 'multiple_choice' ? 'Mark at least one correct answer' : 'Mark the one correct answer';
  }
  const points = Number(form.points);
  if (!Number.isFinite(points) || points <= 0) return 'Points must be more than 0';
  return null;
}
