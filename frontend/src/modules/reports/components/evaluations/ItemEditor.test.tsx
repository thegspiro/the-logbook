/**
 * The item editor must never leave a draft in a shape the backend refuses,
 * and must not fight the user while they type.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ItemEditor } from './ItemEditor';
import type { TemplateItem } from '../../types/evaluations';
import { newItem, withTool } from '../../utils/evaluationTemplate';

const changes = vi.fn();

/** Holds the item in state, as the sections editor does. */
function Harness({ initial }: { initial: TemplateItem }) {
  const [item, setItem] = useState(initial);
  return (
    <ItemEditor
      item={item}
      index={0}
      count={1}
      dataSources={[]}
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
});
