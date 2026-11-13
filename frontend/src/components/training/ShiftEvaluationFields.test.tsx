import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShiftEvaluationFields } from './ShiftEvaluationFields';
import type { ShiftEvaluationFormSnapshot } from '../../types/training';
import type { ShiftEvaluationDraft } from '../../utils/shiftEvaluations';

const form = (levels = 4): ShiftEvaluationFormSnapshot => ({
  name: 'EMT Shift Evaluation',
  scale: Array.from({ length: levels }, (_, i) => ({ value: i + 1, label: `Level ${i + 1}` })),
  allow_not_applicable: true,
  not_applicable_label: 'Not Observed',
  comment_required_at_or_below: null,
  header_fields: [],
  statistics: [],
  sections: [
    {
      key: 'clinical',
      title: 'Clinical Performance',
      column_heading: 'Skill Area',
      items: [{ key: 'vitals', label: 'Vital Signs', comment_always_required: false }],
    },
  ],
  closing_comments_label: 'Preceptor Comments',
  closing_comments_hint: null,
});

const empty: ShiftEvaluationDraft = { header_values: {}, statistics: {}, responses: {}, closing_comments: '' };

const Harness: React.FC<{ levels?: number; onChange?: (d: ShiftEvaluationDraft) => void }> = ({ levels, onChange }) => {
  const [draft, setDraft] = useState(empty);
  return (
    <ShiftEvaluationFields
      form={form(levels)}
      draft={draft}
      onChange={(next) => {
        onChange?.(next);
        setDraft(next);
      }}
      showErrors={false}
    />
  );
};

describe('ShiftEvaluationFields rating controls', () => {
  it('is one tab stop, and the arrow keys move and select like radio buttons', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Vital Signs rating' });

    await user.tab();
    expect(within(group).getByRole('radio', { name: '1 – Level 1' })).toHaveFocus();
    expect(
      within(group)
        .getAllByRole('radio')
        .filter((r) => r.tabIndex === 0)
    ).toHaveLength(1);

    await user.keyboard('{ArrowRight}');
    const two = within(group).getByRole('radio', { name: '2 – Level 2' });
    expect(two).toHaveFocus();
    expect(two).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    // Wraps from the first option to the last, N/A.
    const na = within(group).getByRole('radio', { name: 'N/A – Not Observed' });
    expect(na).toHaveFocus();
    expect(na).toHaveAttribute('aria-checked', 'true');
    expect(
      within(group)
        .getAllByRole('radio')
        .filter((r) => r.tabIndex === 0)
    ).toEqual([na]);
  });

  it('wraps a long scale onto another row instead of clipping it', () => {
    render(<Harness levels={10} />);

    const group = screen.getByRole('radiogroup', { name: 'Vital Signs rating' });
    expect(group).toHaveClass('flex-wrap');
    expect(group).not.toHaveClass('overflow-hidden');
    expect(within(group).getAllByRole('radio')).toHaveLength(11);
  });
});
