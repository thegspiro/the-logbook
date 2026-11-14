/**
 * A form graded by section: each section and the overall show the grade the
 * server calculated, the evaluator may give a different one with a reason,
 * and a reader sees both. The self-evaluation shows no grades at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Grades, PartContent, ScaleLevel, TemplateDefinition } from '../../types/evaluations';

const gradesCall = vi.fn();
vi.mock('../../services/evaluationsApi', () => ({
  evaluationsService: {
    grades: (...a: unknown[]) => gradesCall(...a) as unknown,
  },
}));

import { EvaluationForm } from './EvaluationForm';
import { useLiveGrades } from '../../hooks/useLiveGrades';

const LEVELS = [1, 2, 3, 4, 5].map((value) => ({ value, label: `L${value}`, anchor: `A${value}` }));
const OVERALL: ScaleLevel[] = [
  'Unsatisfactory',
  'Needs improvement',
  'Meets expectations',
  'Exceeds expectations',
  'Outstanding',
].map((label, i) => ({ value: i + 1, label, anchor: null }));

const definition: TemplateDefinition = {
  overall_mode: 'sectioned',
  officer_ranks: [],
  sections: [
    {
      key: 'ops',
      title: 'Operations',
      description: null,
      officer_only: false,
      weight: 100,
      items: [
        {
          key: 'scene',
          label: 'Scene performance',
          help_text: null,
          tool: 'labeled_scale',
          levels: LEVELS,
          allow_na: false,
          weight: 100,
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

const result = (overrides: Partial<Grades['overall']> = {}): Grades['overall'] => ({
  score: 3,
  calculated_level: 3,
  calculated_label: 'Meets expectations',
  override_level: null,
  override_label: null,
  reason: null,
  level: 3,
  label: 'Meets expectations',
  ...overrides,
});

const grades = (section: Partial<Grades['overall']> = {}): Grades => ({
  sections: [{ ...result(section), key: 'ops', title: 'Operations', weight: 100 }],
  overall: result(),
});

function Editable({ initial, onSave }: { initial: PartContent; onSave: (c: PartContent) => void }) {
  const [content, setContent] = useState(initial);
  return (
    <EvaluationForm
      kind="evaluator"
      definition={definition}
      content={content}
      onChange={(next) => {
        setContent(next);
        onSave(next);
      }}
      readOnly={false}
      data={null}
      sources={[]}
      suggested={{}}
      overallLevels={OVERALL}
      grades={grades()}
    />
  );
}

describe('EvaluationForm grades', () => {
  beforeEach(() => {
    gradesCall.mockReset();
  });

  it('shows each section grade and the overall as the server calculated them', () => {
    render(
      <EvaluationForm
        kind="evaluator"
        definition={definition}
        content={{ answers: { scene: { rating: 3 } } }}
        readOnly
        data={null}
        sources={[]}
        suggested={{}}
        overallLevels={OVERALL}
        grades={grades()}
      />
    );
    const ops = screen.getByRole('region', { name: 'Operations' });
    expect(within(ops).getByText(/3\.0 of 5 — Meets expectations/)).toHaveTextContent(
      'Section grade: 3.0 of 5 — Meets expectations'
    );
    const overall = screen.getByRole('region', { name: 'Overall grade' });
    expect(within(overall).getByText(/3\.0 of 5 — Meets expectations/)).toBeInTheDocument();
  });

  it('asks for a reason only once the evaluator picks a different grade, and clears it on the calculated one', async () => {
    const saved = vi.fn();
    const user = userEvent.setup();
    render(<Editable initial={{ answers: { scene: { rating: 3 } } }} onSave={saved} />);

    expect(screen.queryByLabelText(/Why is this/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Your grade', { selector: '#evaluator-ops-grade' }), '5');
    await user.type(screen.getByLabelText(/Why is this Outstanding rather than Meets expectations/), 'Led the rescue.');
    expect(saved).toHaveBeenLastCalledWith(
      expect.objectContaining({ section_grades: { ops: { level: 5, reason: 'Led the rescue.' } } })
    );

    await user.selectOptions(screen.getByLabelText('Your grade', { selector: '#evaluator-ops-grade' }), '3');
    expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({ section_grades: {} }));
    expect(screen.queryByLabelText(/Why is this/)).not.toBeInTheDocument();
  });

  it("shows a reader the evaluator's grade and why beside the calculated one", () => {
    render(
      <EvaluationForm
        kind="evaluator"
        definition={definition}
        content={{ answers: {} }}
        readOnly
        data={null}
        sources={[]}
        suggested={{}}
        overallLevels={OVERALL}
        grades={grades({ override_level: 5, override_label: 'Outstanding', reason: 'Led the rescue.', level: 5 })}
      />
    );
    expect(screen.getByText('Outstanding', { exact: false, selector: 'p' })).toHaveTextContent(
      "Evaluator's grade: Outstanding"
    );
    expect(screen.getByText('Why: Led the rescue.')).toBeInTheDocument();
  });

  it('shows the member no grades on their self-evaluation', () => {
    render(
      <EvaluationForm
        kind="self_evaluation"
        definition={definition}
        content={{ answers: {} }}
        readOnly={false}
        onChange={vi.fn()}
        data={null}
        sources={[]}
        suggested={{}}
        overallLevels={OVERALL}
        grades={grades()}
      />
    );
    expect(screen.queryByText(/Section grade/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Overall grade' })).not.toBeInTheDocument();
  });
});

function LiveProbe({ def, content }: { def: TemplateDefinition | null; content: PartContent }) {
  const live = useLiveGrades(def, content);
  return <p>{live.grades ? `overall ${live.grades.overall.label ?? ''}` : 'none'}</p>;
}

describe('useLiveGrades', () => {
  beforeEach(() => {
    gradesCall.mockReset();
    gradesCall.mockResolvedValue(grades());
  });

  it('asks the server for the grades, never working them out itself', async () => {
    const content = { answers: { scene: { rating: 3 } } };
    render(<LiveProbe def={definition} content={content} />);

    expect(await screen.findByText('overall Meets expectations')).toBeInTheDocument();
    expect(gradesCall).toHaveBeenCalledTimes(1);
    expect(gradesCall).toHaveBeenCalledWith(definition, content);
  });

  it('asks nothing for a form not graded by section, or with nothing to grade', async () => {
    const { rerender } = render(
      <LiveProbe def={{ ...definition, overall_mode: 'weighted' }} content={{ answers: {} }} />
    );
    rerender(<LiveProbe def={null} content={{ answers: {} }} />);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(gradesCall).not.toHaveBeenCalled();
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('keeps the last grades when a recalculation fails', async () => {
    const { rerender } = render(<LiveProbe def={definition} content={{ answers: {} }} />);
    await screen.findByText('overall Meets expectations');

    gradesCall.mockRejectedValueOnce(new Error('offline'));
    rerender(<LiveProbe def={definition} content={{ answers: { scene: { rating: 5 } } }} />);
    await waitFor(() => expect(gradesCall).toHaveBeenCalledTimes(2));
    expect(screen.getByText('overall Meets expectations')).toBeInTheDocument();
  });
});
