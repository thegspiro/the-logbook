/**
 * W50-31: a sanctioned void is walked with the vote chain and reported, so
 * the integrity result is PASS with the voids listed instead of "Vote
 * Integrity Issue Detected". The section names each void from the backend's
 * `voids` summary rather than deriving anything.
 *
 * Asserted against the source, like ElectionDetailPage.w50-forensics.test.tsx:
 * the integrity panel only mounts after service calls behind a tab.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');

describe('ElectionDetailPage integrity voids (W50-31)', () => {
  it('lists each void the integrity check reports, by officer and reason', () => {
    expect(page).toContain('(integrityResult.voids ?? []).map((v) =>');
    expect(page).toContain("vote(s) voided by {v.voided_by_name || 'an officer'}:");
    expect(page).toContain("{v.reason || 'no reason recorded'}");
  });

  it('keeps the alarm banner for a genuine failure only', () => {
    expect(page).toContain("integrityResult && integrityResult.integrity_status !== 'PASS'");
  });
});
