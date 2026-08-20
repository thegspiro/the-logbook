import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const srcDir = join(__dirname, '..');
const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');

/**
 * The scrim/panel stacking contract, read from the source rather than a render.
 *
 * jsdom applies no cascade and compiles no Tailwind, so nothing in the DOM can
 * catch what went wrong on 2026-08-16: `modal-overlay` was given `z-50`, which
 * is correct for the dialogs where the scrim is the fixed container and wrong
 * for the ~24 where it is an empty sibling of a `relative z-10` panel. In those,
 * the scrim painted over its own dialog — the surface looked dimmed, and every
 * tap inside it hit the scrim's close handler instead of the control beneath.
 *
 * Both halves of the contract are guarded, because fixing either one alone
 * breaks the other: the utility carries no z-index, and every call site that
 * uses the scrim as its own fixed container names one.
 */
const collectTsxFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => join(dir, entry));

describe('modal layering contract', () => {
  it('keeps z-index out of the modal-overlay utility', () => {
    const utility = /@utility modal-overlay \{([\s\S]*?)\n\}/.exec(stylesheet);
    expect(utility).not.toBeNull();

    const declarations = (utility?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).toMatch(/@apply[^;]*\bfixed\b/);
    expect(declarations).not.toMatch(/\bz-/);
  });

  it('names a z-index at every call site where the scrim is the fixed container', () => {
    // A scrim that lays its dialog out (`flex`) is the container shape: it holds
    // the panel as a child, so it needs its own z-index to clear page chrome.
    // A scrim with no layout classes is the sibling shape and must stay
    // unraised, so only the container shape is required to carry one.
    const offenders: string[] = [];

    for (const file of collectTsxFiles(srcDir)) {
      const source = readFileSync(file, 'utf8');
      for (const [classes] of source.matchAll(/modal-overlay[^"'`]*/g)) {
        if (!/\bflex\b/.test(classes)) continue;
        if (/\bz-(\[|\d)/.test(classes)) continue;
        offenders.push(`${file.slice(srcDir.length + 1)}: ${classes}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
