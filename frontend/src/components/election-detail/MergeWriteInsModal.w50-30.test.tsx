/**
 * W50-30: the merge target list named a motion's Approve/Deny by raw item id
 * and offered them for a Chief write-in. Contests are now labelled by item
 * title, and once a source is picked both further sources and the target are
 * restricted to that source's contest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MergeWriteInsModal from './MergeWriteInsModal';
import type { BallotItem, Candidate } from '../../types/election';

const makeCandidate = (overrides: Partial<Candidate>): Candidate => ({
  id: 'c1',
  election_id: 'e1',
  name: 'Candidate',
  accepted: true,
  is_write_in: false,
  display_order: 0,
  nomination_date: '2026-07-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
});

const ballotItems: BallotItem[] = [
  {
    id: 'item_1790747487501_k8vrul',
    type: 'general_vote',
    title: 'Adopt the 2027 budget',
    eligible_voter_types: ['all'],
    vote_type: 'approval',
  },
];

const candidates: Candidate[] = [
  makeCandidate({ id: 'real', name: 'Bob Baker', position: 'Chief' }),
  makeCandidate({ id: 'wi1', name: 'bob baker', position: 'Chief', is_write_in: true }),
  makeCandidate({ id: 'pres', name: 'Pat President', position: 'President' }),
  makeCandidate({ id: 'wi2', name: 'pat president', position: 'President', is_write_in: true }),
  makeCandidate({ id: 'approve', name: 'Approve', position: 'item_1790747487501_k8vrul' }),
  makeCandidate({ id: 'deny', name: 'Deny', position: 'item_1790747487501_k8vrul' }),
];

const onSubmit = vi.fn();
const onClose = vi.fn();

const renderModal = () =>
  render(
    <MergeWriteInsModal
      candidates={candidates}
      ballotItems={ballotItems}
      merging={false}
      error={null}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );

describe('MergeWriteInsModal contests (W50-30)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels an item option by the item title, never the raw id', () => {
    renderModal();
    const target = screen.getByLabelText('Count their votes for');
    expect(within(target).getByRole('option', { name: 'Approve (Adopt the 2027 budget)' })).toBeInTheDocument();
    expect(screen.queryByText(/item_1790747487501_k8vrul/)).not.toBeInTheDocument();
  });

  it('restricts targets and further sources to the selected write-in’s contest', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: 'bob baker (Chief)' }));

    const target = screen.getByLabelText('Count their votes for');
    expect(within(target).getByRole('option', { name: 'Bob Baker (Chief)' })).toBeInTheDocument();
    expect(within(target).queryByRole('option', { name: 'Pat President (President)' })).not.toBeInTheDocument();
    expect(within(target).queryByRole('option', { name: /Approve/ })).not.toBeInTheDocument();
    expect(within(target).queryByRole('option', { name: /Deny/ })).not.toBeInTheDocument();

    // A write-in from another contest cannot be added to the same merge.
    expect(screen.getByRole('checkbox', { name: 'pat president (President)' })).toBeDisabled();

    await user.selectOptions(target, 'real');
    await user.click(screen.getByRole('button', { name: 'Merge 1 Variant' }));
    expect(onSubmit).toHaveBeenCalledWith(['wi1'], 'real');
  });

  it('lifts the restriction when the source is deselected', async () => {
    const user = userEvent.setup();
    renderModal();

    const source = screen.getByRole('checkbox', { name: 'bob baker (Chief)' });
    await user.click(source);
    await user.click(source);

    expect(screen.getByRole('checkbox', { name: 'pat president (President)' })).toBeEnabled();
    const target = screen.getByLabelText('Count their votes for');
    expect(within(target).getByRole('option', { name: 'Pat President (President)' })).toBeInTheDocument();
  });
});
