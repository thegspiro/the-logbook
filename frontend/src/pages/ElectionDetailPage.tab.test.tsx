/**
 * An election's sections are addressable by path: `/elections/:id` is the
 * Overview and `/elections/:id/<section>` opens one section.
 *
 * They were `?tab=` before, and before that plain `useState` — which kept
 * **Eligibility**, **Attendance** and **Proxy Voting** unlinkable, though "the
 * eligibility roster for this election" is exactly the thing a secretary sends
 * a colleague. A path is the stronger address: the results can be sent round
 * after the vote, and old `?tab=` links are forwarded by ElectionDetailRoute.
 *
 * The page does not keep its own list of who may see which section:
 * `visibleElectionSections` decides, for the links and for the fallback that
 * sends a refused or unknown section to the Overview.
 *
 * Asserted against the source: rendering this page needs the election, its
 * candidates, its package, the applicant service and a permission surface all
 * mocked; the rendered behaviour is covered in ElectionDetailPage.w50-s24.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'ElectionDetailPage.tsx'), 'utf8');
const tabs = readFileSync(join(__dirname, '../modules/elections/components/ElectionWorkflowTabs.tsx'), 'utf8');

describe('ElectionDetailPage section paths', () => {
  it('reads the section from the route, not from the query string', () => {
    expect(page).toContain("'*': sectionPath");
    expect(page).not.toContain('useSearchParams');
  });

  it('moves between sections by path', () => {
    expect(page).toContain('navigate(electionSectionPath(electionId, section))');
    expect(page).toContain("goToSection('results')");
  });

  it('does not keep a second copy of the section in component state', () => {
    expect(page).not.toContain("useState('ballot')");
    expect(page).not.toContain('useState<ElectionSection');
  });

  it('sends a refused or unknown section to the Overview without pushing history', () => {
    expect(page).toContain('visibleElectionSections(election, canManage).some((s) => s.id === activeSection)');
    expect(page).toContain('navigate(electionSectionPath(electionId, null), { replace: true })');
    // The links and the fallback share one rule.
    expect(tabs).toContain('visibleElectionSections(election, canManage, candidateCount)');
  });
});
