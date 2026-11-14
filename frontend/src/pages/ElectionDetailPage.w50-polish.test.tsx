/**
 * Detail-page polish from the W50 review.
 *
 * Asserted against the source, like ElectionDetailPage.w50-close-stamp.test.tsx:
 * the page is too large to render here for two conditions, and each is
 * re-driven in the browser (docs/workflow-review/W50-elections.md).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');

describe('ElectionDetailPage W50 polish', () => {
  // W50-92: the Cast Vote tab carries the receipt form and goes at close.
  it('keeps a receipt checkable on the Results tab once the election closes', () => {
    expect(page).toContain("import { VerifyReceipt } from '../components/VerifyReceipt';");
    expect(page).toMatch(
      /election\.status === ElectionStatus\.CLOSED && \(\s*<div className="mt-6">\s*<VerifyReceipt electionId=\{electionId\} \/>/
    );
  });

  // W50-76: a draft or a nominations phase has nothing to vote on yet.
  it('says results come at close only while voting is open', () => {
    expect(page).toContain('{!canManage && !resultsAvailable && election.status === ElectionStatus.OPEN && (');
  });

  // W50-74: the badge reads the same word as the filter pills.
  it('labels the status badge instead of printing the raw status', () => {
    expect(page).toContain('{getStatusLabel(election.status)}');
    expect(page).not.toMatch(/>\s*\{election\.status\}\s*</);
  });
});
