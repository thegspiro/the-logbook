/**
 * Theme token integrity
 *
 * Tailwind generates a `bg-theme-*` / `text-theme-*` / `border-theme-*`
 * utility only if a matching `--color-theme-*` variable is declared in
 * `styles/index.css`. Ask for one that is not, and nothing happens: no build
 * warning, no lint error, no missing-class error at runtime. The class stays
 * in the DOM looking exactly like a class that works, and the element simply
 * renders without the colour.
 *
 * That is not hypothetical. `bg-theme-bg` was used at 26 call sites across 12
 * files and had never generated a single rule, because the only tokens near
 * that name are `--color-theme-bg-from` / `-via` / `-to`, the three stops of
 * the page gradient. Twelve of those were full-page wrappers, where a
 * transparent background happens to look right — the gradient on `html` shows
 * through — so nobody had reason to look. The rest were sticky bars that were
 * meant to occlude what scrolled under them and did not, and inset panels
 * drawn with a border and no fill.
 *
 * So: every theme utility named anywhere in the source has to resolve to a
 * token that exists.
 *
 * A false positive is possible — the scan cannot always tell a class name in
 * a comment or a string from one on an element. That is the right way round:
 * naming a token that does not exist is worth a moment's attention wherever
 * it appears.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const STYLESHEET = path.join(SRC, 'styles', 'index.css');

/**
 * Utility prefixes that take a colour. A `theme-` name after any of these is
 * a request for `--color-theme-<rest>`.
 */
const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'divide',
  'outline',
  'fill',
  'stroke',
  'accent',
  'caret',
  'shadow',
  'from',
  'via',
  'to',
  'placeholder',
  'decoration',
];

/**
 * `hover:bg-theme-surface-hover/30` → prefix `bg`, name `surface-hover`.
 *
 * Leading variants (`hover:`, `dark:`, `sm:`, `group-hover:`) and a trailing
 * opacity modifier are stripped, because neither changes which token is being
 * asked for.
 */
const UTILITY = new RegExp(
  String.raw`(?<![\w-])(${COLOUR_PREFIXES.join('|')})-theme-([a-z0-9-]+?)(?:\/\d+)?(?![\w-])`,
  'g'
);

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

/** Every `--color-theme-*` the stylesheet declares. */
const definedTokens = (): Set<string> => {
  const css = fs.readFileSync(STYLESHEET, 'utf8');
  const names = new Set<string>();
  for (const match of css.matchAll(/--color-theme-([a-z0-9-]+)\s*:/g)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
};

interface Offender {
  file: string;
  line: number;
  utility: string;
}

const scan = (): Offender[] => {
  const defined = definedTokens();
  const offenders: Offender[] = [];

  for (const file of collectSourceFiles(SRC)) {
    // This file names undefined utilities on purpose, to prove the scan
    // catches them. Scanning itself would make it permanently red.
    if (file === fileURLToPath(import.meta.url)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((text, index) => {
      if (text.includes('--color-theme-')) return;
      for (const match of text.matchAll(UTILITY)) {
        const name = match[2];
        if (!name || defined.has(name)) continue;
        offenders.push({
          file: path.relative(SRC, file),
          line: index + 1,
          utility: match[0],
        });
      }
    });
  }
  return offenders;
};

describe('theme token integrity', () => {
  it('declares a token for every theme utility the source asks for', () => {
    const offenders = scan();
    const report = offenders.map((o) => `  ${o.file}:${o.line}  ${o.utility}`).join('\n');

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These utilities generate no CSS — the element renders with no colour, silently:\n${report}\n\n` +
            `Either declare the token in styles/index.css or use one that exists.`
    ).toEqual([]);
  });

  it('finds the tokens it is checking against', () => {
    // A regex that quietly matched nothing would make the test above pass
    // for every input, which is the failure mode a source-walking test is
    // most prone to.
    const defined = definedTokens();
    expect(defined.size).toBeGreaterThan(20);
    expect(defined.has('surface')).toBe(true);
    expect(defined.has('bg')).toBe(true);
  });

  it('reads a utility down to its last hyphenated segment', () => {
    // Built by concatenation so the scan above does not read this file's own
    // probes as real call sites. The earlier version of this regex was
    // non-greedy against a \\b, which stopped at the first hyphen: it read
    // `ring-theme-focus-ring` as `focus` and reported the correct utility as
    // undefined, while a genuinely wrong one would have been missed the same
    // way.
    const probe = 'bg-' + 'theme-' + 'surface-hover';
    const matches = [...probe.matchAll(UTILITY)];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.[2]).toBe('surface-hover');
    expect(definedTokens().has('surface-hover')).toBe(true);
  });

  it('strips a variant prefix and an opacity modifier', () => {
    const probe = 'hover:bg-' + 'theme-' + 'surface-secondary/30';
    const matches = [...probe.matchAll(UTILITY)];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.[2]).toBe('surface-secondary');
  });
});
