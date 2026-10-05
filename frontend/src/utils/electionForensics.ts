import type { ForensicsReport } from '../types/election';

type VoidedRecord = ForensicsReport['deleted_votes']['records'][number];

export interface VoidedVoteRow extends VoidedRecord {
  key: string;
  // Ballots in the voided paper batch this row stands for; null for a
  // single voided vote
  batch_size: number | null;
}

/**
 * Collapses the votes of one voided paper batch into a single row. Voiding a
 * batch is one officer action, and listing its ballots one per row read as
 * that many separately voided votes (W50-65). Rows keep their first
 * appearance's order.
 */
export function groupVoidedVotes(records: VoidedRecord[]): VoidedVoteRow[] {
  const rows: VoidedVoteRow[] = [];
  const byBatch = new Map<string, VoidedVoteRow>();
  for (const record of records) {
    const batchId = record.is_manual ? record.manual_batch_id : null;
    if (!batchId) {
      rows.push({ ...record, key: record.vote_id, batch_size: null });
      continue;
    }
    const existing = byBatch.get(batchId);
    if (existing) {
      existing.batch_size = (existing.batch_size ?? 0) + 1;
      continue;
    }
    const row: VoidedVoteRow = { ...record, key: `batch:${batchId}`, batch_size: 1 };
    byBatch.set(batchId, row);
    rows.push(row);
  }
  return rows;
}
