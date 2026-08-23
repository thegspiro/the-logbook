/**
 * `/settings` keeps its old links working, and shows the autosave pill only
 * where autosave is what happens.
 *
 * Asserted against the source rather than a render, matching
 * `EmailTemplatesPage.tab.test.tsx`: reaching this page's chrome needs its
 * whole organization-service, ranks-service and permission surface mocked, and
 * what these pin is two small expressions. A render test would pass against a
 * mock that happened to produce the right section.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'SettingsPage.tsx'), 'utf8');

describe('SettingsPage URL compatibility', () => {
  // EVOC was a top-level section until this screen gained sub-pages, and the
  // old UI put ?tab=evoc in the address bar itself — so those links are in
  // members' bookmarks already. Without the translation they fail the section
  // check and land on General, which reads as the settings having vanished.
  it('translates a legacy ?tab=evoc link to the page EVOC moved to', () => {
    expect(source).toContain("requestedTab === 'evoc' ? 'ranks' : requestedTab");
    expect(source).toContain("requestedTab === 'evoc' ? 'evoc' : requestedPage");
  });

  it('still declares evoc as a sub-page of ranks for that link to land on', () => {
    const sections = source.slice(source.indexOf('const SECTIONS'), source.indexOf('const DEFAULT_SUB_PAGE'));
    expect(sections).toContain("key: 'ranks'");
    expect(sections).toContain("key: 'evoc'");
  });
});

describe('SettingsPage autosave reporting', () => {
  // The credential-writing sections keep an explicit Save. A pill left over
  // from another section reading "All changes saved" would be describing a
  // write that is not going to happen to the SMTP field being typed into.
  it('names the autosaved sections and shows the pill only on those', () => {
    const declared = source.slice(source.indexOf('const AUTOSAVED_SECTIONS'), source.indexOf('const DEFAULT_SUB_PAGE'));
    for (const section of ['general', 'modules', 'members', 'ranks']) {
      expect(declared).toContain(`'${section}'`);
    }
    for (const explicit of ['email', 'storage', 'authentication']) {
      expect(declared).not.toContain(`'${explicit}'`);
    }
    expect(source).toContain('saveState={AUTOSAVED_SECTIONS.has(activeSection) ? saveState : undefined}');
  });
});
