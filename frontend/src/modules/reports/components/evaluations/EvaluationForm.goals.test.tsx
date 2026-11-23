/**
 * A Goals item is a list of goals, each with an optional target date. An
 * answer written before then (one block of text) is edited as the first goal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PartContent, TemplateDefinition } from '../../types/evaluations';
import { EvaluationForm } from './EvaluationForm';

const definition: TemplateDefinition = {
  overall_mode: 'none',
  officer_ranks: [],
  sections: [
    {
      key: 'dev',
      title: 'Development',
      description: null,
      officer_only: false,
      weight: 0,
      items: [
        {
          key: 'goals',
          label: 'Goals for the coming year',
          help_text: null,
          tool: 'goals',
          levels: [],
          allow_na: false,
          weight: 0,
          require_example_for: [],
          checklist_options: [],
          comment: 'none',
          include_in_self_evaluation: false,
          data_block: null,
        },
      ],
    },
  ],
};

const changes = vi.fn();

function Harness({ initial }: { initial: PartContent }) {
  const [content, setContent] = useState(initial);
  return (
    <EvaluationForm
      kind="evaluator"
      definition={definition}
      content={content}
      onChange={(next) => {
        changes(next);
        setContent(next);
      }}
      readOnly={false}
      data={null}
      sources={[]}
      suggested={{}}
      overallLevels={[]}
    />
  );
}

const lastGoals = () => (changes.mock.calls[changes.mock.calls.length - 1]?.[0] as PartContent).answers.goals;

describe('EvaluationForm goals', () => {
  beforeEach(() => {
    changes.mockReset();
  });

  it('adds goals with target dates, each with its own id', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ answers: {} }} />);

    await user.click(screen.getByRole('button', { name: 'Add a goal' }));
    await user.type(screen.getByLabelText('Goal 1'), 'Lead two drills.');
    await user.type(screen.getByLabelText(/Target date for goal 1/), '2027-06-30');
    await user.click(screen.getByRole('button', { name: 'Add a goal' }));
    await user.type(screen.getByLabelText('Goal 2'), 'Earn Officer I.');

    expect(lastGoals()).toEqual({
      goals: [
        { id: 'goal-1', text: 'Lead two drills.', target_date: '2027-06-30' },
        { id: 'goal-2', text: 'Earn Officer I.', target_date: null },
      ],
      text: null,
    });
  });

  it('edits goals written as one block of text as the first goal', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ answers: { goals: { text: 'Lead two drills.' } } }} />);

    expect(screen.getByLabelText('Goal 1')).toHaveValue('Lead two drills.');
    await user.type(screen.getByLabelText('Goal 1'), ' Twice.');

    expect(lastGoals()).toEqual({
      goals: [{ id: 'goal-1', text: 'Lead two drills. Twice.', target_date: null }],
      text: null,
    });
  });

  it('removes a goal, and the next one added does not reuse a kept id', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          answers: {
            goals: {
              goals: [
                { id: 'goal-1', text: 'A' },
                { id: 'goal-2', text: 'B' },
              ],
            },
          },
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Remove goal 1' }));
    await user.click(screen.getByRole('button', { name: 'Add a goal' }));

    expect(lastGoals()?.goals?.map((goal) => goal.id)).toEqual(['goal-2', 'goal-3']);
  });

  it('shows a reader a numbered list with target dates', () => {
    render(
      <EvaluationForm
        kind="evaluator"
        definition={definition}
        content={{
          answers: {
            goals: {
              goals: [
                { id: 'a', text: 'Lead two drills.', target_date: '2027-06-30' },
                { id: 'b', text: 'Earn Officer I.' },
              ],
            },
          },
        }}
        readOnly
        data={null}
        sources={[]}
        suggested={{}}
        overallLevels={[]}
      />
    );

    // The form lists its items too; the goals are the two innermost entries.
    const items = screen.getAllByRole('listitem').slice(-2);
    expect(items[0]).toHaveTextContent(/Lead two drills\. \(by .*2027\)/);
    expect(items[1]).toHaveTextContent('Earn Officer I.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
