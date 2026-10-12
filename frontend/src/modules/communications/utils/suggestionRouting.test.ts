import { describe, it, expect } from 'vitest';
import type { IntakeQuestion } from '../types/suggestions';
import { answersToSend, resolveRoute, visibleQuestionIds, withEditorIds } from './suggestionRouting';

const questions: IntakeQuestion[] = [
  {
    id: 'first',
    label: 'First?',
    type: 'radio',
    required: false,
    options: [
      { value: 'yes', label: 'Yes', routeToBoxId: 'box-a' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    id: 'second',
    label: 'Second?',
    type: 'select',
    required: false,
    options: [{ value: 'yes', label: 'Yes', routeToBoxId: 'box-b' }],
    conditionQuestionId: 'first',
    conditionOperator: 'equals',
    conditionValue: 'no',
  },
  {
    id: 'notes',
    label: 'Notes',
    type: 'text',
    required: false,
    options: [],
  },
];

describe('suggestionRouting', () => {
  it('shows a follow-up only when its branch is taken', () => {
    expect(visibleQuestionIds(questions, {})).toEqual(new Set(['first', 'notes']));
    expect(visibleQuestionIds(questions, { first: 'no' })).toEqual(new Set(['first', 'second', 'notes']));
  });

  it('routes on the first shown answer that names a box', () => {
    expect(resolveRoute(questions, { first: 'yes', second: 'yes' })).toBe('box-a');
    expect(resolveRoute(questions, { first: 'no', second: 'yes' })).toBe('box-b');
    expect(resolveRoute(questions, {})).toBeNull();
    expect(resolveRoute(undefined, { first: 'yes' })).toBeNull();
  });

  it('sends only shown, non-blank answers', () => {
    expect(answersToSend(questions, { first: 'yes', second: 'yes', notes: '  ' })).toEqual({ first: 'yes' });
  });

  it('gives an unsaved question an id and keeps a saved one', () => {
    const [saved, fresh] = withEditorIds([
      { id: 'kept', label: 'A', type: 'text', required: false, options: [] },
      { label: 'B', type: 'text', required: false, options: [] },
    ]);
    expect(saved?.id).toBe('kept');
    expect(fresh?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
