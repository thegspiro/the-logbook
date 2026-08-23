/**
 * Theme colour integrity
 *
 * A Tailwind colour utility whose token does not exist compiles to nothing. It
 * is not an error at build time, it is not a lint failure, and on screen it is
 * not obviously a missing colour either — the element simply takes whatever is
 * behind it.
 *
 * `bg-theme-bg` and `bg-theme-background` are both in that state: the tokens
 * defined in styles/index.css are `--color-theme-surface`, `--color-theme-nav-bg`
 * and the three `--color-theme-bg-from|via|to` gradient stops, and none of them
 * produces either class. Both resolve to `rgba(0, 0, 0, 0)` in the running app.
 *
 * That is harmless on a static block and destructive on a sticky or fixed one.
 * The equipment check form's Submit bar carried both, so the item list scrolled
 * visibly through the notes field and the Submit button — which reads as
 * overlapping content, not as a missing background, and so gets diagnosed as a
 * layout bug that is not there.
 *
 * This walks the source for background utilities naming a `theme-` token and
 * fails on any the stylesheet does not define.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const STYLES = path.join(SRC, 'styles', 'index.css');

/** Every `--color-theme-*` custom property the stylesheet declares. */
const definedTokens = (): Set<string> => {
  const css = fs.readFileSync(STYLES, 'utf8');
  const found = new Set<string>();
  for (const match of css.matchAll(/--color-(theme-[a-z0-9-]+)\s*:/g)) {
    if (match[1]) found.add(match[1]);
  }
  return found;
};

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

/**
 * Background utilities only. Text and border utilities share the token
 * namespace but degrade to an inherited colour rather than to transparency, so
 * they are a legibility question rather than a see-through-panel one and are
 * not what this guard is for.
 */
const BG_UTILITY = /\bbg-(theme-[a-z0-9-]+)/g;

/**
 * Sites that carry an undefined token today.
 *
 * A ratchet, in the manner of the coverage floors: it blocks a new one rather
 * than pretending these are fixed. Each needs a visual decision about which
 * defined token it meant — `bg-theme-bg` on a plain block is invisible and
 * harmless, on a sticky or fixed one it is the see-through-panel bug — and that
 * is a change per screen, not a rename. EquipmentCheckForm is deliberately
 * absent: it was the one caught with a screenshot on it and is fixed.
 *
 * Removing an entry as you fix it is the point. Adding one is not.
 */
const KNOWN_BROKEN = [
  'modules/apparatus/pages/ApparatusDetailPage.tsx: bg-theme-bg',
  'modules/communications/pages/MessagesAdminPage.tsx: bg-theme-info',
  'modules/grants-fundraising/pages/GrantApplicationsPage.tsx: bg-theme-bg',
  'modules/grants-fundraising/pages/GrantDetailPage.tsx: bg-theme-bg',
  'modules/prospective-members/pages/InterviewPage.tsx: bg-theme-bg-secondary',
  'pages/ActiveSkillTestPage.tsx: bg-theme-bg',
  'pages/ElectionDetailPage.tsx: bg-theme-bg',
  'pages/ElectionDetailPage.tsx: bg-theme-surface-alt',
  'pages/FinanceApprovalPage.tsx: bg-theme-background',
  'pages/TrainingAdminPage.tsx: bg-theme-surface-primary',
  'pages/scheduling/EquipmentCheckReportsPage.tsx: bg-theme-bg',
  'pages/scheduling/SchedulingAdminReportsPage.tsx: bg-theme-bg',
  'pages/scheduling/SchedulingPatternsPage.tsx: bg-theme-bg',
  'pages/scheduling/SchedulingPlatoonsPage.tsx: bg-theme-bg',
  'pages/scheduling/SchedulingTemplatesPage.tsx: bg-theme-bg',
];

describe('theme colour integrity', () => {
  it('every bg-theme-* utility names a token the stylesheet defines', () => {
    const tokens = definedTokens();
    // Sanity: if this ever empties, the regex above has drifted from the CSS
    // and the whole test would pass by finding nothing to check.
    expect(tokens.size).toBeGreaterThan(20);
    expect(tokens.has('theme-surface')).toBe(true);

    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      // Comments are stripped first: a note explaining why a broken utility was
      // replaced necessarily quotes it, and the walker would then flag the very
      // fix it is documenting.
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
      for (const match of source.matchAll(BG_UTILITY)) {
        const token = match[1];
        if (!token || tokens.has(token)) continue;
        // Tailwind resolves bg-theme-bg-from and friends off the gradient
        // stops; only the bare, undefined names are the problem.
        offenders.push(`${path.relative(SRC, file)}: bg-${token}`);
      }
    }

    expect([...new Set(offenders)].sort()).toEqual(KNOWN_BROKEN);
  });
});
