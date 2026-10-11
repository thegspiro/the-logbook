import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { EditableQuestion } from '../utils/suggestionRouting';
import IntakeQuestionsEditor, { type RouteTarget } from './IntakeQuestionsEditor';

const targets: RouteTarget[] = [
  { id: 'b-compliance', name: 'Compliance', anonymityMode: 'allowed' },
  { id: 'b-named', name: 'Named only', anonymityMode: 'disabled' },
];

const safety: EditableQuestion = {
  id: 'safety',
  label: 'Is this a safety concern?',
  type: 'radio',
  required: false,
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
};
const where: EditableQuestion = {
  id: 'where',
  label: 'Where?',
  type: 'text',
  required: false,
  options: [],
  conditionQuestionId: 'safety',
  conditionOperator: 'equals',
  conditionValue: 'yes',
};

let latest: EditableQuestion[] = [];
const onChangeSpy = vi.fn();

const Harness: React.FC<{ initial: EditableQuestion[]; anonymityMode?: string }> = ({
  initial,
  anonymityMode = 'allowed',
}) => {
  const [questions, setQuestions] = useState(initial);
  return (
    <IntakeQuestionsEditor
      questions={questions}
      onChange={(next) => {
        latest = next;
        onChangeSpy(next);
        setQuestions(next);
      }}
      routeTargets={targets}
      anonymityMode={anonymityMode}
    />
  );
};

describe('IntakeQuestionsEditor', () => {
  beforeEach(() => {
    latest = [];
    onChangeSpy.mockReset();
  });

  it('adds a question with Yes / No options that can route', async () => {
    renderWithRouter(<Harness initial={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Add question' }));
    await user.type(screen.getByLabelText('Question'), 'Safety concern?');
    await user.click(screen.getByRole('button', { name: 'Use Yes / No' }));
    await user.selectOptions(screen.getByLabelText('Where option 1 sends the submission'), 'b-compliance');

    const [question] = latest;
    expect(question?.label).toBe('Safety concern?');
    expect(question?.options).toEqual([
      { value: 'yes', label: 'Yes', routeToBoxId: 'b-compliance' },
      { value: 'no', label: 'No' },
    ]);
  });

  it('never offers a question its own follow-up as a parent', () => {
    const notes: EditableQuestion = { id: 'notes', label: 'Notes', type: 'text', required: false, options: [] };
    renderWithRouter(<Harness initial={[safety, where, notes]} />);
    const first = screen.getByRole('group', { name: 'Question 1' });
    const parentPicker = within(first).getByLabelText('Show only after this question');
    expect(within(parentPicker).getByRole('option', { name: /Notes/ })).toBeInTheDocument();
    expect(within(parentPicker).queryByRole('option', { name: /Where\?/ })).not.toBeInTheDocument();
  });

  it('keeps a follow-up attached when the option it branches on is reworded', async () => {
    renderWithRouter(<Harness initial={[safety, where]} />);
    const user = userEvent.setup();
    const option = screen.getByLabelText('Option 1');
    await user.clear(option);
    await user.type(option, 'Definitely');

    const parent = latest.find((q) => q.id === 'safety');
    expect(parent?.options[0]).toEqual({ value: 'yes', label: 'Definitely' });
    expect(latest.find((q) => q.id === 'where')?.conditionValue).toBe('yes');
  });

  it('gives a new option a stable value of its own', async () => {
    renderWithRouter(<Harness initial={[safety]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add option' }));

    const added = latest[0]?.options[2];
    expect(added?.label).toBe('');
    expect(added?.value).toMatch(/^[0-9a-f]{12}$/);
  });

  it('releases a follow-up when its question is removed', async () => {
    renderWithRouter(<Harness initial={[safety, where]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove question 1' }));
    await user.click(await screen.findByRole('button', { name: 'Remove question' }));

    expect(latest).toHaveLength(1);
    expect(latest[0]?.conditionQuestionId).toBeNull();
  });

  it('keeps a box that requires anonymity from routing to one that records names', () => {
    renderWithRouter(<Harness initial={[safety]} anonymityMode="required" />);
    const picker = screen.getByLabelText('Where option 1 sends the submission');
    expect(within(picker).getByRole('option', { name: 'Send to Compliance' })).toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: 'Send to Named only' })).not.toBeInTheDocument();
  });

  it('offers no routing on a checkbox question', () => {
    renderWithRouter(<Harness initial={[{ ...safety, type: 'checkbox' }]} />);
    expect(screen.queryByLabelText('Where option 1 sends the submission')).not.toBeInTheDocument();
  });
});
