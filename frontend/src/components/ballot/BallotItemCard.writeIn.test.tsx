/**
 * `allow_write_ins` is an election-wide switch, but a write-in names someone
 * for a seat. An Approve/Deny item offers only Approve, Deny and Abstain —
 * the same choices the printed ballot gives it — while a candidate race in
 * the same election keeps its Write-in row.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BallotItem, Candidate, Election } from '../../types/election';
import { BallotItemCard } from './BallotItemCard';
import BallotPreviewModal from '../election-detail/BallotPreviewModal';

const motion: BallotItem = {
  id: 'bylaws',
  type: 'general_vote',
  title: 'Bylaws Update',
  eligible_voter_types: ['all'],
  vote_type: 'approval',
};

const race: BallotItem = {
  id: 'president',
  type: 'officer_election',
  title: 'President',
  position: 'President',
  eligible_voter_types: ['all'],
  vote_type: 'candidate_selection',
};

const candidates = [
  { id: 'alice', name: 'Alice', position: 'President', accepted: true, is_write_in: false },
] as unknown as Candidate[];

const renderCard = (item: BallotItem) =>
  render(
    <BallotItemCard
      item={item}
      index={0}
      settings={{ allow_write_ins: true, voting_method: 'simple_majority', max_votes_per_position: 1 }}
      candidates={candidates}
      choice={undefined}
      onChoice={vi.fn()}
      onWriteInName={vi.fn()}
      onToggleCandidate={vi.fn()}
      onRank={vi.fn()}
    />
  );

describe('Write-in on an Approve/Deny item', () => {
  it('offers only Approve, Deny and Abstain on the voter ballot', () => {
    renderCard(motion);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Deny' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Abstain/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Write-in' })).not.toBeInTheDocument();
  });

  it('keeps the write-in on a candidate race in the same election', () => {
    renderCard(race);
    expect(screen.getByRole('radio', { name: 'Write-in' })).toBeInTheDocument();
  });

  it('matches in the ballot preview', () => {
    const election = {
      id: 'elec-1',
      title: 'Second Test',
      status: 'draft',
      ballot_items: [race, motion],
      positions: ['President'],
      allow_write_ins: true,
      anonymous_voting: true,
    } as unknown as Election;
    render(<BallotPreviewModal election={election} candidates={candidates} onClose={vi.fn()} timezone="UTC" />);

    // Two items, one write-in: the President race's, not the motion's.
    expect(screen.getAllByRole('radio', { name: 'Write-in' })).toHaveLength(1);
    expect(screen.getByText('Approve/Deny vote')).toBeInTheDocument();
  });
});
