/**
 * The info card shows the actual close beside the scheduled end (W50-14),
 * through the shared ElectionCloseStamp so the card and the list agree.
 *
 * Asserted against the source, like ElectionDetailPage.tab.test.tsx: the stamp's
 * rendering is covered by ElectionCloseStamp.w50-14.test.tsx, and this pins
 * that the card mounts it with the actor and relabels the scheduled end.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');

describe('ElectionDetailPage close stamp (W50-14)', () => {
  it('mounts the close stamp with the officer on a closed election', () => {
    expect(page).toContain('<ElectionCloseStamp election={election} showActor />');
  });

  it('keeps the scheduled end labelled as scheduled once closed', () => {
    expect(page).toContain("election.status === ElectionStatus.CLOSED ? 'Scheduled End' : 'End Date'");
  });
});
