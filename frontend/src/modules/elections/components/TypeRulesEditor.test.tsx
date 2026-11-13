/**
 * The per-type voter rules editor (eligibility rules version 2): one row per
 * member type, each reporting a complete rule up only once it is valid.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ElectionEligibilityRules, VoterRow } from '../../../types/election';
import { TypeRulesEditor } from './TypeRulesEditor';

const ROWS: VoterRow[] = [
  { key: 'regular', label: 'Regular', decided_by: 'status', counts_as: null },
  { key: 'senior', label: 'Senior', decided_by: 'status', counts_as: 'regular' },
  { key: 'probationary', label: 'Probationary', decided_by: 'status', counts_as: null },
  { key: 'administrative', label: 'Administrative', decided_by: 'class', counts_as: null },
];

const RULES: ElectionEligibilityRules = {
  version: 2,
  attendance: { mode: 'none' },
  types: {
    regular: { may_vote: true, wait: null, attendance: [] },
    probationary: { may_vote: false, wait: null, attendance: [] },
    administrative: { may_vote: true, wait: null, attendance: [] },
  },
};

const onChange = vi.fn();

/** Holds the value the way a real parent does, so each change builds on the last. */
const Harness: React.FC<{ initial: ElectionEligibilityRules }> = ({ initial }) => {
  const [value, setValue] = useState(initial);
  return (
    <TypeRulesEditor
      idPrefix="t"
      rows={ROWS}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
};

const lastSent = (): ElectionEligibilityRules => {
  const call = onChange.mock.calls[onChange.mock.calls.length - 1] as [ElectionEligibilityRules] | undefined;
  if (!call) throw new Error('nothing was reported');
  return call[0];
};

const row = (label: string) => screen.getByRole('group', { name: `${label} members` });

describe('TypeRulesEditor', () => {
  beforeEach(() => {
    onChange.mockReset();
  });

  it('shows a row for every member type and says the class rows apply on top', () => {
    render(<Harness initial={RULES} />);
    expect(within(row('Probationary')).getByLabelText('May vote')).toHaveValue('no');
    expect(within(row('Regular')).getByLabelText('May vote')).toHaveValue('yes');
    expect(row('Administrative')).toHaveAccessibleDescription(/must meet both/);
  });

  it('says which row judges a tier that has none of its own', () => {
    render(<Harness initial={RULES} />);
    expect(row('Senior')).toHaveAccessibleDescription(/judged by the Regular row/);
  });

  it('turning a type off clears its other rules', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...RULES,
          types: {
            ...RULES.types,
            regular: { may_vote: true, wait: { months: 6, counted_from: 'type' }, attendance: [] },
          },
        }}
      />
    );
    await user.selectOptions(within(row('Regular')).getByLabelText('May vote'), 'no');
    expect(lastSent().types?.regular).toEqual({ may_vote: false, wait: null, attendance: [] });
    expect(lastSent().version).toBe(2);
  });

  it('starts a wait from joining the department, and can count it from becoming the type', async () => {
    const user = userEvent.setup();
    render(<Harness initial={RULES} />);
    const regular = row('Regular');

    await user.selectOptions(within(regular).getByLabelText('Waiting period'), 'months');
    expect(lastSent().types?.regular?.wait).toEqual({ months: 12, counted_from: 'joined' });

    await user.selectOptions(within(regular).getByLabelText('Counted from'), 'type');
    expect(lastSent().types?.regular?.wait).toEqual({ months: 12, counted_from: 'type' });
    expect(within(regular).getByRole('option', { name: 'Becoming regular' })).toBeInTheDocument();
  });

  it('holds an out-of-range wait in its box', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...RULES,
          types: {
            ...RULES.types,
            regular: { may_vote: true, wait: { months: 12, counted_from: 'joined' }, attendance: [] },
          },
        }}
      />
    );
    const months = within(row('Regular')).getByLabelText('Months');
    await user.clear(months);
    await user.type(months, '0');
    expect(months).toHaveAttribute('aria-invalid', 'true');
    expect(within(row('Regular')).getByRole('alert')).toHaveTextContent('It is still saved as 12.');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds attendance rules that must all be met, and removes one', async () => {
    const user = userEvent.setup();
    render(<Harness initial={RULES} />);
    const regular = row('Regular');

    await user.click(within(regular).getByRole('button', { name: 'Add attendance rule' }));
    expect(lastSent().types?.regular?.attendance).toEqual([{ mode: 'count', min_meetings: 6, of_last_meetings: 12 }]);

    await user.click(within(regular).getByRole('button', { name: 'Add attendance rule' }));
    await user.selectOptions(within(regular).getByLabelText('Attendance rule 2'), 'percent');
    expect(lastSent().types?.regular?.attendance[1]).toEqual({
      mode: 'percent',
      meeting_types: null,
      min_pct: 50,
      period_months: 12,
    });
    expect(within(regular).getByText('Every rule below must be met.')).toBeInTheDocument();

    await user.click(within(regular).getByRole('button', { name: 'Remove attendance rule 1 for Regular members' }));
    expect(lastSent().types?.regular?.attendance).toHaveLength(1);
    expect(lastSent().types?.regular?.attendance[0]?.mode).toBe('percent');
  });

  it('holds a count above the look-back instead of reporting it', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...RULES,
          types: {
            ...RULES.types,
            regular: {
              may_vote: true,
              wait: null,
              attendance: [{ mode: 'count', min_meetings: 6, of_last_meetings: 12 }],
            },
          },
        }}
      />
    );
    const attended = within(row('Regular')).getByLabelText('Meetings attended');
    await user.clear(attended);
    await user.type(attended, '13');
    expect(attended).toHaveAttribute('aria-invalid', 'true');
    expect(within(row('Regular')).getByRole('alert')).toHaveTextContent(
      'cannot be more than the meetings looked back over'
    );
    for (const [sent] of onChange.mock.calls as [ElectionEligibilityRules][]) {
      expect(sent.types?.regular?.attendance[0]?.min_meetings).not.toBe(13);
    }
  });

  it('limits a rule to the meeting types ticked', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...RULES,
          types: {
            ...RULES.types,
            regular: {
              may_vote: true,
              wait: null,
              attendance: [{ mode: 'count', min_meetings: 6, of_last_meetings: 12 }],
            },
          },
        }}
      />
    );
    const regular = row('Regular');
    expect(within(regular).getByText('Every meeting counts')).toBeInTheDocument();
    await user.click(within(regular).getByLabelText('Business meeting'));
    expect(lastSent().types?.regular?.attendance[0]?.meeting_types).toEqual(['business']);
    await user.click(within(regular).getByLabelText('Business meeting'));
    // Unticking the last one means every meeting counts again, never none.
    expect(lastSent().types?.regular?.attendance[0]?.meeting_types).toBeNull();
  });
});
