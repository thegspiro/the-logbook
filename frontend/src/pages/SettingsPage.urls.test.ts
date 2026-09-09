/**
 * `/settings` keeps its old links working, and shows the autosave pill only
 * where autosave is what happens.
 *
 * Asserted against the source rather than a render, matching
 * `EmailTemplatesPage.tab.test.tsx`: reaching this page's chrome needs its
 * whole organization-service and permission surface mocked, and
 * what these pin is two small expressions. A render test would pass against a
 * mock that happened to produce the right section.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'SettingsPage.tsx'), 'utf8');

describe('SettingsPage URL compatibility', () => {
  // Three legacy spellings reach this page and none of them names a section on
  // it any more. `?tab=ranks` is the address the ladder had until 2026-09-08;
  // `?tab=ranks&page=evoc` named EVOC under it; and bare `?tab=evoc` is older
  // still, from before EVOC became a sub-page — this screen had been remapping
  // that one internally ever since, and dropping it now would strand exactly
  // the links the remap existed to rescue.
  it('redirects every legacy ranks address to where the ladder moved', () => {
    const redirect = source.slice(source.indexOf('const movedToMembersAdmin'), source.indexOf('const initialTab'));
    expect(redirect).toContain("requestedTab === 'evoc'");
    expect(redirect).toContain("requestedTab === 'ranks'");
    expect(redirect).toContain("membersSettingsPathFor(requestedPage === 'evoc' ? 'evoc' : 'ranks')");
  });

  it('no longer declares a ranks section for those links to land on', () => {
    // The counterpart to the redirect: a section left behind here would make
    // `?tab=ranks` pass the section check and render an empty panel instead of
    // redirecting, which is the failure the redirect exists to prevent.
    const sections = source.slice(source.indexOf('const SECTIONS'), source.indexOf('const DEFAULT_SUB_PAGE'));
    expect(sections).not.toContain("key: 'ranks'");
    expect(sections).not.toContain("key: 'evoc'");
    expect(sections).not.toContain("key: 'operational'");
  });
});

describe('SettingsPage autosave reporting', () => {
  // The credential-writing sections keep an explicit Save. A pill left over
  // from another section reading "All changes saved" would be describing a
  // write that is not going to happen to the SMTP field being typed into.
  it('names the autosaved sections and shows the pill only on those', () => {
    const declared = source.slice(source.indexOf('const AUTOSAVED_SECTIONS'), source.indexOf('const DEFAULT_SUB_PAGE'));
    // `members` was on this list until 2026-09-06, when Contact Visibility and
    // Membership IDs moved to /members/admin/settings. It is asserted absent
    // rather than merely dropped from the loop: a key left here for a section
    // that no longer exists is invisible — the `has()` simply never matches —
    // and this is the assertion that would notice it coming back by accident.
    expect(declared).not.toContain("'members'");
    // `ranks` left on 2026-09-08 for the same reason and is asserted absent for
    // the same one.
    expect(declared).not.toContain("'ranks'");
    for (const section of ['general', 'modules']) {
      expect(declared).toContain(`'${section}'`);
    }
    for (const explicit of ['email', 'storage', 'labelPrinters', 'authentication']) {
      expect(declared).not.toContain(`'${explicit}'`);
    }
    expect(source).toContain('saveState={AUTOSAVED_SECTIONS.has(activeSection) ? saveState : undefined}');
  });
});
