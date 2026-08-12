/**
 * Every Medical Screening tab is addressable by `?tab=`.
 *
 * The page held its tab in plain `useState('requirements')`, the same defect
 * `EmailTemplatesPage.tab.test.tsx` and `NotificationsPage.tab.test.tsx` were
 * written for. Two consequences:
 *
 * - **Compliance** could not be linked to, though it is the tab an officer has
 *   cause to send a colleague — it carries the whole module's reporting.
 * - The screenshot harness could only ever shoot the default tab, which is how
 *   `02-21`/`02-41` and `04-20`/`17-01` came to be byte-identical images
 *   published under different captions.
 *
 * And the Back button did nothing after a tab change, because there was nothing
 * in the URL for it to go back to.
 *
 * Asserted against the source rather than a render, for the same reason as the
 * two tests above: reaching the tab strip needs the module's whole store,
 * permission and fetch surface mocked, and the defect is two small expressions
 * a render test could pass over.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'MedicalScreeningPage.tsx'), 'utf8');

const TABS = ['requirements', 'records', 'compliance'];

describe('MedicalScreeningPage tab deep links', () => {
  it('reads the tab back out of the URL', () => {
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('tab')");
  });

  it.each(TABS)('lists %s among the addressable tabs', (tab) => {
    const declared = source.slice(source.indexOf('const MEDICAL_SCREENING_TABS'), source.indexOf('type Tab ='));
    expect(declared).toContain(`'${tab}'`);
  });

  it('validates the query value against the declared tabs', () => {
    // A bare cast would let `?tab=nonsense` through and render no tab at all.
    expect(source).toContain('MEDICAL_SCREENING_TABS.includes(');
  });

  it('writes the tab back to the URL when it changes', () => {
    expect(source).toContain('setSearchParams({ tab })');
  });

  it('does not keep a second copy of the tab in component state', () => {
    // Mirroring the parameter into state reads it once, on mount, so every
    // later URL change — which is what Back is — is ignored. One source of
    // truth removes the class of bug rather than patching the instance.
    expect(source).not.toContain("useState<Tab>('requirements')");
  });
});
