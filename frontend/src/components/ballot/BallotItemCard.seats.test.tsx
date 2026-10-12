/**
 * W50-11 — a multi-seat race tells the voter how many will be elected, so
 * "Select up to 2" reads as a two-seat race rather than a looser cap on a
 * one-winner race. A one-seat race says nothing extra.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BallotItem, Candidate } from '../../types/election';
import { BallotItemCard } from './BallotItemCard';

const item: BallotItem = {
  id: 'trustee',
  type: 'officer_election',
  title: 'Trustee',
  position: 'Trustee',
  eligible_voter_types: ['all'],
  vote_type: 'candidate_selection',
};

const candidates = ['Alice', 'Bob', 'Cara'].map(
  (name) =>
    ({ id: name.toLowerCase(), name, position: 'Trustee', accepted: true, is_write_in: false }) as unknown as Candidate
);

const renderCard = (seats: number | undefined) =>
  render(
    <BallotItemCard
      item={item}
      index={0}
      settings={{
        allow_write_ins: false,
        voting_method: 'simple_majority',
        max_votes_per_position: seats ?? 1,
        seats_per_position: seats,
      }}
      candidates={candidates}
      choice={undefined}
      onChoice={vi.fn()}
      onWriteInName={vi.fn()}
      onToggleCandidate={vi.fn()}
      onRank={vi.fn()}
    />
  );

describe('BallotItemCard seat count (W50-11)', () => {
  it('names how many a two-seat race elects', () => {
    renderCard(2);
    expect(screen.getByText(/Select up to 2 candidates\.\s*2 will be elected\./)).toBeInTheDocument();
  });

  it('adds nothing for a one-seat race or an older server that sends no seat count', () => {
    renderCard(undefined);
    expect(screen.queryByText(/will be elected/)).not.toBeInTheDocument();
  });
});
