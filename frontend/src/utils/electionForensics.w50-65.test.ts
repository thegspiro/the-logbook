import { describe, it, expect } from 'vitest';
import { groupVoidedVotes } from './electionForensics';

const record = (vote_id: string, extra: Partial<Parameters<typeof groupVoidedVotes>[0][number]> = {}) => ({
  vote_id,
  candidate_id: null,
  position: 'Chief',
  deleted_at: '2026-09-30T07:07:00Z',
  deleted_by: 'u1',
  deletion_reason: 'mis-keyed',
  is_manual: false,
  manual_batch_id: null,
  ...extra,
});

describe('groupVoidedVotes (W50-65)', () => {
  it('collapses a voided paper batch into one row with its ballot count', () => {
    const rows = groupVoidedVotes([
      record('v1'),
      record('p1', { is_manual: true, manual_batch_id: 'b1' }),
      record('p2', { is_manual: true, manual_batch_id: 'b1' }),
      record('p3', { is_manual: true, manual_batch_id: 'b1' }),
      record('v2'),
    ]);
    expect(rows.map((r) => [r.key, r.batch_size])).toEqual([
      ['v1', null],
      ['batch:b1', 3],
      ['v2', null],
    ]);
  });

  it('keeps a manual vote without a batch id as its own row', () => {
    const rows = groupVoidedVotes([record('p1', { is_manual: true })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.batch_size).toBeNull();
  });
});
