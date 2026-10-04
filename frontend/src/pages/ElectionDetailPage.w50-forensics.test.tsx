/**
 * Forensics counters disagreed with each other (W50-65): "Total Votes"
 * counted pending paper ballots beside "2 vote(s) cast", "Unused" counted
 * superseded tokens, a voided paper batch was listed as N voided votes and
 * the timeline bucket carried no zone. The backend now sends the split
 * counters; the section renders them rather than re-deriving anything.
 *
 * Asserted against the source, like ElectionDetailPage.tab.test.tsx: the
 * forensics section only mounts after two service calls behind a tab, and
 * the grouping is covered by electionForensics.w50-65.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');

describe('ElectionDetailPage forensics counters (W50-65)', () => {
  it('splits the integrity total into counted, pending paper and test votes', () => {
    expect(page).toContain('Votes checked:');
    expect(page).toContain('{integrityResult.counted_votes} counted');
    expect(page).toContain('{integrityResult.pending_paper_votes}');
    expect(page).toContain('{integrityResult.test_votes} test');
  });

  it('reports tokens as Issued / Live / Superseded / Used / Expired, not Unused', () => {
    expect(page).toContain('forensicsReport.voting_tokens.total_live');
    expect(page).toContain('forensicsReport.voting_tokens.total_superseded');
    expect(page).toContain('forensicsReport.voting_tokens.total_expired');
    expect(page).not.toContain('forensicsReport.voting_tokens.total_issued - forensicsReport.voting_tokens.total_used');
    expect(page).not.toContain('>Unused<');
  });

  it('groups a voided paper batch into one row', () => {
    expect(page).toContain('groupVoidedVotes(forensicsReport.deleted_votes.records)');
    expect(page).toContain('paper batch voided (');
    expect(page).toContain('forensicsReport.deleted_votes.paper_batch_count');
  });

  it('labels the timeline with the zone its buckets are keyed in', () => {
    expect(page).toContain('(times in {forensicsReport.voting_timeline_timezone})');
  });
});
