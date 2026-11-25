/**
 * ELEC2-15: the Void Batch button disappeared once the election closed. The
 * backend never gates a void on the election's status, and the owner decided
 * on 2026-10-05 that a correction after close is allowed and marked as a
 * results revision — so the screen hid the only way to make one.
 * Attesting stays open-only; it is the backend's rule too.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import PaperBallotBatchesPanel from './PaperBallotBatchesPanel';
import type { ManualBallotBatch } from '../../types/election';

const batch = (extra: Partial<ManualBallotBatch>): ManualBallotBatch => ({
  batch_id: 'b1',
  status: 'confirmed',
  recorded_by: 'u1',
  recorded_by_name: 'Casey Lin',
  recorded_at: '2026-09-30T06:00:00Z',
  notes: null,
  ballots_cast: 3,
  over_count_override: false,
  required_attestations: 2,
  attestations: [],
  totals: [{ candidate_id: 'c1', candidate_name: 'Blair Carter', position: 'Chief', count: 3 }],
  total_ballots: 3,
  ...extra,
});

const renderClosed = (batches: ManualBallotBatch[]) =>
  render(
    <PaperBallotBatchesPanel
      batches={batches}
      currentUserId="u2"
      electionOpen={false}
      attestingBatchId={null}
      onAttest={() => undefined}
      onVoid={() => undefined}
    />
  );

describe('PaperBallotBatchesPanel after the election closes', () => {
  it('still offers to void a confirmed batch', () => {
    renderClosed([batch({})]);
    expect(screen.getByRole('button', { name: 'Void Batch' })).toBeInTheDocument();
  });

  it('does not offer to void a batch that is already voided', () => {
    renderClosed([batch({ status: 'voided' })]);
    expect(screen.queryByRole('button', { name: 'Void Batch' })).not.toBeInTheDocument();
  });
});
