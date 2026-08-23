/**
 * Every Email Templates tab is addressable by `?tab=`.
 *
 * The page held its tab in plain `useState('templates')`, so none of the five
 * could be linked to. Two consequences, and the second is the one that made
 * this worth fixing rather than noting:
 *
 * - A secretary could not send a colleague a link to the **Footers** library,
 *   which is the tab a colleague is most likely to be pointed at.
 * - The screenshot harness could only ever shoot the default tab. That is
 *   exactly how `02-21` and `02-41` came to be byte-identical images published
 *   under two different captions, and how `04-20` and `17-01` did the same —
 *   all four were hub routes defaulting to a tab nobody asked for.
 *
 * Asserted against the source rather than a render. Reaching the tab strip
 * needs the page's whole store, permission and fetch surface mocked, and the
 * defect is two small expressions; a render test would pass against a mock
 * that happened to produce the right tab. Same approach as
 * `NotificationsPage.tab.test.tsx`, for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'EmailTemplatesPage.tsx'), 'utf8');

const TABS = ['templates', 'footers', 'officers', 'scheduled', 'history'];

describe('EmailTemplatesPage tab deep links', () => {
  it('reads the tab back out of the URL', () => {
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('tab')");
  });

  it.each(TABS)('lists %s among the addressable tabs', (tab) => {
    const declared = source.slice(
      source.indexOf('const EMAIL_TEMPLATES_TABS'),
      source.indexOf('type EmailTemplatesTab')
    );
    expect(declared).toContain(`'${tab}'`);
  });

  it('validates the query value against the declared tabs', () => {
    // A bare cast would let `?tab=nonsense` through and render nothing at all.
    expect(source).toContain('EMAIL_TEMPLATES_TABS.includes(');
  });

  it('writes the tab back to the URL when it changes', () => {
    const handler = source.slice(
      source.indexOf('const handleTabChange'),
      source.indexOf('const handleTabChange') + 300
    );
    expect(handler).toContain('setSearchParams({ tab })');
  });

  it.each(TABS)('routes the %s button through the handler, not bare state', (tab) => {
    // A single missed call site is the whole defect: that tab silently stops
    // round-tripping while the other four look fine.
    expect(source).toContain(`handleTabChange('${tab}')`);
    expect(source).not.toContain(`setActiveTab('${tab}')`);
  });

  it('derives the active tab from the URL rather than mirroring it into state', () => {
    // The first version of this fix read the parameter once with
    // `useState(initialTab)`. That makes a link work and leaves the **Back
    // button** broken: click Footers then Officers, press Back, and the URL
    // says `?tab=footers` while the page still renders Officers.
    //
    // Asserting the absence of the state is the point. A sync `useEffect` would
    // also work, but it reintroduces two sources of truth and one more ordering
    // problem to get wrong; there is nothing for this page to hold that the URL
    // does not already say.
    expect(source).toMatch(/const activeTab: EmailTemplatesTab =/);
    expect(source).not.toMatch(/useState<EmailTemplatesTab>/);
  });
});

/**
 * The editor and the preview are side by side, not behind tabs.
 *
 * Asserted against the source for the same reason as the tab deep links
 * above: reaching the layout in a render needs the page's whole store,
 * permission and fetch surface mocked, and what is being checked here is a
 * handful of expressions. A render test would pass against a mock that
 * happened to produce the right pane.
 */
describe('EmailTemplatesPage editor layout', () => {
  it('lays the three columns out at lg', () => {
    expect(source).toContain('lg:grid-cols-[296px_minmax(0,1fr)_468px]');
  });

  it('keeps the edit/preview strip only below lg', () => {
    // Above `lg` both panes are on screen and a switch decides nothing; the
    // strip is what makes the stacked phone layout usable.
    expect(source).toContain('tab-scroll lg:hidden');
  });

  it('previews the unsaved draft rather than the stored template', () => {
    expect(source).toContain('previewOverrides');
    expect(source).toContain('html_body: draft.htmlBody');
  });

  it('debounces the preview instead of firing per keystroke', () => {
    // Each preview is a round trip that inlines the whole stylesheet
    // server-side. Per-keystroke would put a request on the wire for every
    // character of a paragraph and paint them back out of order.
    expect(source).toContain('PREVIEW_DEBOUNCE_MS');
    expect(source).toMatch(/const PREVIEW_DEBOUNCE_MS = \d+/);
  });

  it('binds Ctrl+S once rather than on every render', () => {
    // The handler previously had no dependency array, so for a textarea it
    // was a listener added and removed per character typed.
    const effect = source.slice(source.indexOf("e.key === 's'"));
    expect(effect.slice(0, 600)).toContain('}, [draft.isDirty');
  });
});
