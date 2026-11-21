/**
 * A goal-review item lists each goal the member's previous review set, from
 * the copy taken when the evaluation was drafted, and asks for a result and a
 * comment on each. A reader sees the results; a form with no copied goals
 * says there is nothing to rate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GoalsUnderReview, PartContent, TemplateDefinition } from '../../types/evaluations';
import { EvaluationForm } from './EvaluationForm';

const definition: TemplateDefinition = {
  overall_mode: 'none',
  officer_ranks: [],
  sections: [
    {
      key: 'development',
      title: 'Development',
      description: null,
      officer_only: false,
      weight: 0,
      items: [
        {
          key: 'last_goals',
          label: "Last year's goals",
          help_text: null,
          tool: 'goal_review',
          levels: [],
          allow_na: false,
          weight: 0,
          require_example_for: [],
          checklist_options: [],
          comment: 'none',
          include_in_self_evaluation: true,
          data_block: null,
        },
      ],
    },
  ],
};

const goals: GoalsUnderReview = {
  evaluation_id: 'last-year',
  period_name: '2025 Annual',
  period_start: '2025-01-01',
  period_end: '2025-12-31',
  goals: [
    { key: 'goals', label: 'Goals', text: 'Lead two drills.' },
    { key: 'stretch', label: 'Stretch goal', text: 'Earn Officer I.' },
  ],
};

const changes = vi.fn();

function Harness({ initial, copied }: { initial: PartContent; copied: GoalsUnderReview | null }) {
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
      goalsUnderReview={copied}
    />
  );
}

const lastChange = (): PartContent => changes.mock.calls[changes.mock.calls.length - 1]?.[0] as PartContent;

describe('EvaluationForm goal review', () => {
  beforeEach(() => {
    changes.mockReset();
  });

  it('shows each copied goal and records a result and comment against it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ answers: {} }} copied={goals} />);

    expect(screen.getByText('Goals set in the review for 2025 Annual.')).toBeInTheDocument();
    expect(screen.getByText('Lead two drills.')).toBeInTheDocument();
    expect(screen.getByText('Earn Officer I.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('radiogroup', { name: 'Goals result' })).getByLabelText('Partly met'));
    await user.type(screen.getByLabelText('Comment on Goals'), 'Led one.');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Stretch goal result' })).getByLabelText('No longer applies')
    );

    expect(lastChange().answers.last_goals?.goal_ratings).toEqual({
      goals: { result: 'partly_met', comment: 'Led one.' },
      stretch: { result: 'not_applicable' },
    });
  });

  it('drops a rating for a goal no longer in the copy when another is rated', async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ answers: { last_goals: { goal_ratings: { retired: { result: 'met' } } } } }} copied={goals} />
    );

    await user.click(within(screen.getByRole('radiogroup', { name: 'Goals result' })).getByLabelText('Met'));

    expect(lastChange().answers.last_goals?.goal_ratings).toEqual({ goals: { result: 'met' } });
  });

  it('says there is nothing to rate when the previous review set no goals', () => {
    render(<Harness initial={{ answers: {} }} copied={null} />);

    expect(screen.getByText(/previous review on this form set no goals/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows a reader the result and comment given for each goal', () => {
    render(
      <EvaluationForm
        kind="evaluator"
        definition={definition}
        content={{
          answers: {
            last_goals: { goal_ratings: { goals: { result: 'met', comment: 'Led three.' } } },
          },
        }}
        readOnly
        data={null}
        sources={[]}
        suggested={{}}
        overallLevels={[]}
        goalsUnderReview={goals}
      />
    );

    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Led three.')).toBeInTheDocument();
    expect(screen.getByText('Not rated')).toBeInTheDocument();
  });
});
