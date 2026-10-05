/**
 * A voided batch card showed no reason, voider or time, and a pending
 * over-count batch carried no mark (W50-66). The batch response now carries
 * both; the card must show them.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import PaperBallotBatchesPanel from './PaperBallotBatchesPanel';
import type { ManualBallotBatch } from '../../types/election';

const batch = (extra: Partial<ManualBallotBatch>): ManualBallotBatch => ({
  batch_id: 'b1',
  status: 'pending',
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

const renderPanel = (batches: ManualBallotBatch[]) =>
  render(
    <PaperBallotBatchesPanel
      batches={batches}
      currentUserId="u2"
      electionOpen
      attestingBatchId={null}
      onAttest={() => undefined}
      onVoid={() => undefined}
    />
  );

describe('PaperBallotBatchesPanel void metadata and override mark (W50-66)', () => {
  it('shows who voided a batch, when, and why', () => {
    renderPanel([
      batch({
        status: 'voided',
        voided_by: 'u3',
        voided_by_name: 'Jordan Avery',
        voided_at: '2026-09-30T07:07:00Z',
        void_reason: 'Counted the wrong stack',
      }),
    ]);
    const line = screen.getByText(/^Voided by/);
    expect(line).toHaveTextContent('Voided by Jordan Avery');
    expect(line).toHaveTextContent('September 30, 2026');
    expect(line).toHaveTextContent('— Counted the wrong stack');
  });

  it('marks an over-count override on a pending batch', () => {
    renderPanel([batch({ over_count_override: true })]);
    expect(screen.getByText('Over-count override')).toBeInTheDocument();
  });

  it('marks an over-count override on a confirmed batch', () => {
    renderPanel([batch({ status: 'confirmed', over_count_override: true })]);
    expect(screen.getByText('Over-count override')).toBeInTheDocument();
  });

  it('shows neither on an ordinary pending batch', () => {
    renderPanel([batch({})]);
    expect(screen.queryByText('Over-count override')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Voided by/)).not.toBeInTheDocument();
  });
});
