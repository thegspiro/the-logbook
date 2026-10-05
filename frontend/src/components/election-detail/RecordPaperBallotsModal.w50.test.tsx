/**
 * W50-30: a ballot item's Approve/Deny rows carry `position = <item id>`.
 * The paper-ballot tally must name that contest by the item's title —
 * "Approve (Adopt the 2027 budget)", not "Approve (item_1790747487501_k8vrul)".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecordPaperBallotsModal from './RecordPaperBallotsModal';
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
  makeCandidate({ id: 'chief', name: 'Casey Chief', position: 'Chief' }),
  makeCandidate({ id: 'approve', name: 'Approve', position: 'item_1790747487501_k8vrul' }),
  makeCandidate({ id: 'deny', name: 'Deny', position: 'item_1790747487501_k8vrul' }),
];

const onSubmit = vi.fn();
const onClose = vi.fn();

describe('RecordPaperBallotsModal contest labels (W50-30)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels an item option by the item title and a position row by its position', () => {
    render(
      <RecordPaperBallotsModal
        candidates={candidates}
        ballotItems={ballotItems}
        recording={false}
        error={null}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );

    expect(screen.getByLabelText('Approve (Adopt the 2027 budget)')).toBeInTheDocument();
    expect(screen.getByLabelText('Deny (Adopt the 2027 budget)')).toBeInTheDocument();
    expect(screen.getByLabelText('Casey Chief (Chief)')).toBeInTheDocument();
    expect(screen.queryByText(/item_1790747487501_k8vrul/)).not.toBeInTheDocument();
  });

  it('falls back to the raw position when no ballot items are supplied', () => {
    render(
      <RecordPaperBallotsModal
        candidates={candidates}
        recording={false}
        error={null}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );

    expect(screen.getByLabelText('Approve (item_1790747487501_k8vrul)')).toBeInTheDocument();
  });
});
