/**
 * The item editor must never leave a draft in a shape the backend refuses,
 * and must not fight the user while they type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ItemEditor } from './ItemEditor';
import type { EvaluationDataSource, TemplateItem } from '../../types/evaluations';
import { newItem, withTool } from '../../utils/evaluationTemplate';

const changes = vi.fn();

/** Holds the item in state, as the sections editor does. */
function Harness({ initial, sources = [] }: { initial: TemplateItem; sources?: EvaluationDataSource[] }) {
  const [item, setItem] = useState(initial);
  return (
    <ItemEditor
      item={item}
      index={0}
      count={1}
      dataSources={sources}
      onChange={(next) => {
        changes(next);
        setItem(next);
      }}
      onRemove={() => undefined}
      onMove={() => undefined}
    />
  );
}

const lastChange = (): TemplateItem => changes.mock.calls[changes.mock.calls.length - 1]?.[0] as TemplateItem;

describe('ItemEditor', () => {
  beforeEach(() => {
    changes.mockReset();
  });

  it('drops the scoring rule when removing the top level leaves it no bands', async () => {
    const item: TemplateItem = {
      ...newItem('Training', []),
      data_block: {
        source: 'training.hours',
        scoring_rule: { bands: [{ min: 0, max: null, score: 5 }] },
      },
    };
    const user = userEvent.setup();
    render(<Harness initial={item} />);

    await user.click(screen.getByRole('button', { name: /remove top level/i }));

    expect(lastChange().levels).toHaveLength(4);
    expect(lastChange().data_block).toEqual({ source: 'training.hours', scoring_rule: null });
  });

  it('lets the user type several checklist options, spaces and all', async () => {
    const user = userEvent.setup();
    render(<Harness initial={withTool(newItem('Gear', []), 'checklist')} />);

    const box = screen.getByLabelText(/checklist options/i);
    await user.type(box, 'SCBA check{Enter}Radio  check{Enter}');

    expect(box).toHaveValue('SCBA check\nRadio  check\n');
    expect(lastChange().checklist_options).toEqual(['SCBA check', 'Radio  check']);
  });

  it('offers the data sources grouped by module', () => {
    const sources: EvaluationDataSource[] = [
      {
        key: 'training.hours',
        label: 'Training hours',
        unit: 'hours',
        module: 'training',
        description: '',
        scoreable: true,
      },
      {
        key: 'shifts.count',
        label: 'Shifts worked',
        unit: 'count',
        module: 'scheduling',
        description: '',
        scoreable: true,
      },
    ];
    render(<Harness initial={newItem('Training', [])} sources={sources} />);

    const select = screen.getByLabelText(/data shown with this item/i);
    const groups = within(select)
      .getAllByRole('group')
      .map((g) => [
        g.getAttribute('label'),
        within(g)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ]);
    expect(groups).toEqual([
      ['Training', ['Training hours']],
      ['Shifts', ['Shifts worked']],
    ]);
  });

  it('says which values a scoring rule leaves without a suggestion', () => {
    const sources: EvaluationDataSource[] = [
      {
        key: 'training.hours',
        label: 'Training hours',
        unit: 'hours',
        module: 'training',
        description: '',
        scoreable: true,
      },
    ];
    const item: TemplateItem = {
      ...newItem('Training', []),
      data_block: {
        source: 'training.hours',
        scoring_rule: {
          bands: [
            { min: 0, max: 10, score: 2 },
            { min: 20, max: null, score: 4 },
          ],
        },
      },
    };
    render(<Harness initial={item} sources={sources} />);

    expect(screen.getByRole('status')).toHaveTextContent('No rating is suggested for values from 10 up to 20.');
  });

  it('says nothing when the bands cover every value', () => {
    const sources: EvaluationDataSource[] = [
      {
        key: 'training.hours',
        label: 'Training hours',
        unit: 'hours',
        module: 'training',
        description: '',
        scoreable: true,
      },
    ];
    const item: TemplateItem = {
      ...newItem('Training', []),
      data_block: {
        source: 'training.hours',
        scoring_rule: {
          bands: [
            { min: 0, max: 10, score: 2 },
            { min: 10, max: null, score: 4 },
          ],
        },
      },
    };
    render(<Harness initial={item} sources={sources} />);

    expect(screen.queryByText(/no rating is suggested/i)).not.toBeInTheDocument();
  });

  it('marks a source the department has turned off, and says why once chosen', () => {
    const sources: EvaluationDataSource[] = [
      {
        key: 'calls.response_pct',
        label: 'Call response rate',
        unit: 'percent',
        module: 'calls',
        description: 'Calls responded to out of all department calls.',
        scoreable: true,
        unavailable_reason: 'Call tracking is turned off.',
      },
      {
        key: 'training.hours',
        label: 'Training hours',
        unit: 'hours',
        module: 'training',
        description: '',
        scoreable: true,
        unavailable_reason: null,
      },
    ];
    const item: TemplateItem = {
      ...newItem('Calls', []),
      data_block: { source: 'calls.response_pct', scoring_rule: null },
    };
    render(<Harness initial={item} sources={sources} />);

    expect(screen.getByRole('option', { name: 'Call response rate (turned off)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Training hours' })).toBeInTheDocument();
    expect(screen.getByText(/call tracking is turned off\. until it is turned on/i)).toBeInTheDocument();
  });
});
