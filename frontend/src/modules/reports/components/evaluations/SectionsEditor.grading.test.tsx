/**
 * The builder's controls for a form graded by section: a weight per
 * section, item weights read as shares of their section, the running totals
 * publishing checks, and the grade ranges.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';
import type { TemplateDefinition } from '../../types/evaluations';
import { SectionsEditor } from './SectionsEditor';

const LEVELS = [1, 2, 3, 4, 5].map((value) => ({ value, label: `L${value}`, anchor: `A${value}` }));

const definition: TemplateDefinition = {
  overall_mode: 'sectioned',
  officer_ranks: [],
  sections: [
    {
      key: 'ops',
      title: 'Operations',
      description: null,
      officer_only: false,
      weight: 60,
      items: [
        {
          key: 'scene',
          label: 'Scene performance',
          help_text: null,
          tool: 'labeled_scale',
          levels: LEVELS,
          allow_na: false,
          weight: 70,
          require_example_for: [],
          checklist_options: [],
          comment: 'optional',
          include_in_self_evaluation: true,
          data_block: null,
        },
      ],
    },
  ],
};

function Harness({ onChange }: { onChange: (d: TemplateDefinition) => void }) {
  const [current, setCurrent] = useState(definition);
  return (
    <SectionsEditor
      definition={current}
      dataSources={[]}
      ranks={[]}
      onChange={(next) => {
        setCurrent(next);
        onChange(next);
      }}
    />
  );
}

describe('SectionsEditor, graded by section', () => {
  it('shows the section weight and the totals that must reach 100% to publish', () => {
    renderWithRouter(<Harness onChange={vi.fn()} />);

    expect(screen.getByLabelText('Section weight in overall (%)')).toHaveValue(60);
    expect(screen.getByLabelText('Weight in section (%)')).toHaveValue(70);
    expect(
      screen.getByText('Item weights in this section add up to 70% — they must total 100% to publish.')
    ).toBeInTheDocument();
    expect(screen.getByText('Section weights add up to 60% — they must total 100% to publish.')).toBeInTheDocument();
  });

  it('edits a section weight and the lowest score for a grade', async () => {
    const changed = vi.fn<(d: TemplateDefinition) => void>();
    const user = userEvent.setup();
    renderWithRouter(<Harness onChange={changed} />);

    const weight = screen.getByLabelText('Section weight in overall (%)');
    await user.clear(weight);
    await user.type(weight, '100');
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ sections: [expect.objectContaining({ weight: 100 })] })
    );

    const outstanding = screen.getByLabelText('Outstanding from');
    expect(outstanding).toHaveValue(4.5);
    await user.clear(outstanding);
    await user.type(outstanding, '4.8');
    const last = changed.mock.lastCall?.[0];
    expect(last?.grade_bands?.find((band) => band.level === 5)?.min).toBe(4.8);
    expect(screen.getByText('Unsatisfactory below that')).toBeInTheDocument();
  });

  it('offers grading by section among the overall settings', () => {
    renderWithRouter(<Harness onChange={vi.fn()} />);
    expect(screen.getByLabelText('Overall rating')).toHaveValue('sectioned');
    expect(screen.getByRole('option', { name: 'Graded by section' })).toBeInTheDocument();
  });
});
