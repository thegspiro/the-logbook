import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const srcDir = join(__dirname, '..');
const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');

// The rule text is heavily commented, and a comment naming `text-left` would
// otherwise satisfy a regex looking for the declaration itself.
const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Where a table header's alignment is allowed to be decided, read from the
 * source rather than from a render.
 *
 * jsdom compiles no Tailwind and applies no cascade, so nothing in the DOM can
 * catch what went wrong here: `thead th` was declared UNLAYERED, and unlayered
 * CSS outranks every cascade layer. Tailwind emits utilities into
 * `@layer utilities`, so `text-right` on a <th> was discarded — the heading sat
 * hard left over a right-aligned column of figures. It was live at 108 headers
 * across 37 files (71 `text-right`, 37 `text-center`) and nothing failed,
 * because the markup was correct and only the cascade disagreed.
 *
 * Both halves are guarded, because each is a way for the bug to come back:
 * alignment must stay somewhere a utility can beat it, and the rest of the
 * header treatment must stay somewhere a utility cannot — moving the whole rule
 * into `@layer base` would silently unlock colour, size, weight and casing on
 * every <th> in the app, which is a different change and has to be a deliberate
 * one.
 */
describe('table header alignment contract', () => {
  const baseLayer = /@layer base \{\s*thead th \{([\s\S]*?)\}\s*\}/.exec(withoutComments);
  const unlayered = /\nthead th \{([\s\S]*?)\n\}/.exec(withoutComments);

  it('finds both halves of the rule it is meant to check', () => {
    // Guards the regexes themselves: a silent zero-match sweep would pass every
    // assertion below while checking nothing at all.
    expect(baseLayer, 'no `@layer base { thead th { ... } }` block in index.css').not.toBeNull();
    expect(unlayered, 'no unlayered `thead th` block in index.css').not.toBeNull();
  });

  it('keeps header alignment in @layer base, where a utility can override it', () => {
    expect(
      baseLayer?.[1] ?? '',
      'Declare `text-align` for `thead th` inside `@layer base`. Anywhere unlayered ' +
        "it outranks Tailwind's `text-right`/`text-center` and the header silently " +
        'ignores them.'
    ).toMatch(/text-align:\s*left/);
  });

  it('keeps alignment out of the unlayered rule', () => {
    const declarations = unlayered?.[1] ?? '';

    expect(
      declarations,
      'The unlayered `thead th` rule must not set alignment — that is what made ' +
        '`text-right` inert at 108 headers. Alignment belongs in the `@layer base` block.'
    ).not.toMatch(/text-align|(?<![\w-])text-(?:left|right|center)(?![\w-])/);
  });

  it('leaves the rest of the header treatment unlayered', () => {
    // The scope decision, pinned. These five stay where a utility cannot reach
    // them; unlocking them changes how headers look across every table, so it
    // must be chosen rather than arrived at while tidying the rule above.
    const declarations = unlayered?.[1] ?? '';

    for (const utility of ['text-theme-text-muted', 'text-xs', 'font-semibold', 'tracking-wider', 'uppercase']) {
      expect(
        declarations,
        `\`${utility}\` left the unlayered \`thead th\` rule. Moving the whole rule into ` +
          '`@layer base` unlocks colour, size, weight and casing on every <th> in the app.'
      ).toContain(utility);
    }
  });

  it('keeps the th-numeric stopgap retired', () => {
    // It existed only because `text-right` did not work. Two mechanisms for one
    // job is how the next table ends up half-fixed.
    const offenders = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.tsx') || entry.endsWith('.css'))
      .filter((entry) => readFileSync(join(srcDir, entry), 'utf8').includes('th-numeric'))
      .map((entry) => entry);

    expect(offenders, 'Use `text-right` on the <th>; it works now.').toEqual([]);
  });
});
