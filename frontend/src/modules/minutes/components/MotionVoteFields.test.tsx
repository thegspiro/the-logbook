import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionVoteFields } from './MotionVoteFields';
import { emptyVoteDraft } from '../utils/voteDraft';
import type { VoteDraft } from '../utils/voteDraft';
import type { AttendeeEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'late', present: true },
  { name: 'Sam Absent', status: 'absent', present: false },
  { name: 'A visitor', status: 'guest', present: false },
];

const show = (value: VoteDraft = emptyVoteDraft(), attendees = roll) => {
  const onChange = vi.fn();
  render(<MotionVoteFields idPrefix="v" attendees={attendees} value={value} onChange={onChange} />);
  return onChange;
};

describe('MotionVoteFields', () => {
  it('offers the three thresholds, with the usual one marked', () => {
    show();
    const options = within(screen.getByLabelText('Needed to carry'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'Majority of the votes cast (usual)',
      'Majority of members present',
      'Two-thirds of the votes cast',
    ]);
  });

  it('reports a change of threshold', async () => {
    const onChange = show();
    await userEvent.setup().selectOptions(screen.getByLabelText('Needed to carry'), 'two_thirds');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ threshold: 'two_thirds' }));
  });

  it('takes totals by default, including recusals', () => {
    show();
    for (const label of ['For', 'Against', 'Abstentions', 'Recused']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('reports a typed total', async () => {
    const onChange = show();
    await userEvent.setup().type(screen.getByLabelText('For'), '7');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ votesFor: '7' }));
  });

  it('switches to a roll call', async () => {
    const onChange = show();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Roll call' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'roll' }));
  });

  it('lists only the members recorded present, each able to vote four ways', () => {
    show({ ...emptyVoteDraft(), mode: 'roll' });
    expect(screen.getByRole('radiogroup', { name: "Pat Chief's vote" })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: "Lee Treasurer's vote" })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: "Sam Absent's vote" })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: "A visitor's vote" })).toBeNull();
    const group = screen.getByRole('radiogroup', { name: "Pat Chief's vote" });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.parentElement?.textContent)
    ).toEqual(['Yes', 'No', 'Abstain', 'Recuse']);
  });

  it('records a member’s vote', async () => {
    const onChange = show({ ...emptyVoteDraft(), mode: 'roll' });
    const group = screen.getByRole('radiogroup', { name: "Lee Treasurer's vote" });
    await userEvent.setup().click(within(group).getByRole('radio', { name: 'Recuse' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roll: { 'Lee Treasurer': 'recuse' } }));
  });

  it('keeps a running tally of the roll call', () => {
    show({ ...emptyVoteDraft(), mode: 'roll', roll: { 'Pat Chief': 'yes', 'Lee Treasurer': 'no' } });
    expect(screen.getByText(/Yes 1 · No 1 · Abstain 0 · Recused 0 — 2 of 2 present have voted/)).toBeInTheDocument();
  });

  it('says so when no one is recorded present', () => {
    show({ ...emptyVoteDraft(), mode: 'roll' }, []);
    expect(screen.getByText(/No one is recorded as present yet/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
