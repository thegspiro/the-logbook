/**
 * An election's workflow tabs are addressable by `?tab=`.
 *
 * The sixth page found holding its tab in plain `useState`, after Email
 * Templates, Notifications, Medical Screening, Compliance Config and Item
 * Detail. Same three consequences every time: the tab cannot be linked to, the
 * Back button does nothing after a tab change, and the screenshot harness can
 * only ever shoot the default.
 *
 * Here it kept **Eligibility**, **Attendance** and **Proxy Voting** unlinkable
 * — and "the eligibility roster for this election" is exactly the thing a
 * secretary sends a colleague.
 *
 * Unlike the other five this page does not validate the value against a list,
 * and deliberately: `ElectionWorkflowTabs` already computes which tabs this
 * viewer may see and falls back to the first of them when the active tab is not
 * among them, so an unknown or forbidden `?tab=` lands on a real panel instead
 * of a blank one. Duplicating that list here would be a second source of truth
 * for who sees what.
 *
 * Asserted against the source: rendering this page needs the election, its
 * candidates, its package, the applicant service and a permission surface all
 * mocked, and the defect is two expressions a render test would pass over.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');
const tabs = readFileSync(join(__dirname, '../modules/elections/components/ElectionWorkflowTabs.tsx'), 'utf8');

describe('ElectionDetailPage tab deep links', () => {
  it('reads the tab back out of the URL', () => {
    expect(page).toContain('useSearchParams');
    expect(page).toContain("searchParams.get('tab')");
  });

  it('writes the tab back to the URL when it changes', () => {
    expect(page).toContain('setSearchParams({ tab })');
  });

  it('does not keep a second copy of the tab in component state', () => {
    expect(page).not.toContain("useState('ballot')");
  });

  it('leaves the visible-tab fallback where it already lived', () => {
    // The guard that makes an unknown or forbidden `?tab=` safe.
    expect(tabs).toContain("tabs.find((t) => t.id === activeTab) ? activeTab : (tabs[0]?.id ?? 'ballot')");
  });
});
