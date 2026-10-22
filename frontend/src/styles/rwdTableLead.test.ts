import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');
const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Where the reflow table's title-cell override is allowed to live, read from
 * the source rather than from a render.
 *
 * jsdom compiles no Tailwind and applies no cascade, so nothing in a component
 * test can see this. The `.rwd-table` reflow rules are unlayered; unlayered CSS
 * outranks every cascade layer. `rwd-table-lead` was written as an `@utility`,
 * which Tailwind emits into `@layer utilities`, so the reflow's
 * `display: flex` and `data-label` prefix won and the cell meant to title each
 * card rendered as one more `Label: value` line, on every screen that used it.
 */
describe('rwd-table-lead cascade contract', () => {
  it('is not declared as a Tailwind utility, where the reflow rules outrank it', () => {
    expect(withoutComments).not.toMatch(/@utility\s+rwd-table-lead\b/);
  });

  it('is declared unlayered, scoped to outrank the reflow cell rules', () => {
    const block = /\.rwd-table tbody td\.rwd-table-lead \{([\s\S]*?)\}/.exec(withoutComments);
    expect(block, 'no unlayered `.rwd-table tbody td.rwd-table-lead` rule in index.css').not.toBeNull();
    expect(block?.[1] ?? '').toMatch(/display:\s*block/);
    expect(withoutComments).toMatch(/\.rwd-table tbody td\.rwd-table-lead::before \{\s*content:\s*none;?\s*\}/);
  });

  it('follows the reflow rules it overrides', () => {
    // Equal specificity with the `td[data-label]::before` prefix rule, so the
    // later declaration is the one that applies.
    const prefix = withoutComments.indexOf('.rwd-table tbody td[data-label]::before');
    const lead = withoutComments.indexOf('.rwd-table tbody td.rwd-table-lead::before');
    expect(prefix).toBeGreaterThan(-1);
    expect(lead).toBeGreaterThan(prefix);
  });
});
