/**
 * Theme colour integrity
 *
 * A Tailwind colour utility whose token does not exist compiles to nothing. It
 * is not an error at build time, it is not a lint failure, and on screen it is
 * not obviously a missing colour either — the element simply takes whatever is
 * behind it.
 *
 * That is harmless on a static block and destructive on a sticky or fixed one:
 * the equipment check form's Submit bar carried `bg-theme-bg` while nothing
 * defined that token, so the item list scrolled visibly through the notes field
 * and the Submit button — which reads as overlapping content, not as a missing
 * background, and so gets diagnosed as a layout bug that is not there.
 *
 * `--color-theme-bg` is defined now (styles/index.css), as the flat opaque page
 * canvas for exactly that job, and the sites that named it are no longer
 * broken. The mechanism is what remains worth guarding: this walks the source
 * for background utilities naming a `theme-` token and fails on any the
 * stylesheet does not define.
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
 * than pretending these are fixed. It reached zero on 2026-08-24, when the
 * tokens the fifteen remaining sites named were defined rather than renamed —
 * so the assertion below is now a plain invariant with no allowance in it.
 *
 * Adding an entry back is not the way to make a failure go away. A `bg-theme-*`
 * the stylesheet does not define is either a typo or a token somebody meant to
 * add; the fix is one of those two, at the call site or in the stylesheet.
 */
const KNOWN_BROKEN: string[] = [];

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
