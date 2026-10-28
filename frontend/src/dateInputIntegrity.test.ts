/**
 * Native date/time inputs must not overflow their column on WebKit.
 *
 * WebKit (every iOS browser) sizes a native date control from its own box and
 * can ignore `w-full`, so the Date of Birth field on Edit Member ran under the
 * Personal Email field beside it. The cure is an element rule in `@layer base`
 * rather than a `form-input` modifier, because roughly a tenth of the app's
 * date inputs are styled by hand and a modifier never reaches them. jsdom has
 * no WebKit layout to measure, so this pins the rule itself.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'styles/index.css'), 'utf8');

const baseLayerBlocks = (css: string): string[] => {
  const blocks: string[] = [];
  for (const opener of css.matchAll(/@layer base\s*\{/g)) {
    const start = (opener.index ?? 0) + opener[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(start, i - 1));
  }
  return blocks;
};

describe('date input containment', () => {
  it.each(['date', 'time', 'datetime-local', 'month'])(
    'constrains input[type=%s] inside @layer base so call-site utilities still win',
    (type) => {
      const rule = baseLayerBlocks(CSS)
        .join('\n')
        .match(new RegExp(`input\\[type='${type}'\\][^{]*\\{([^}]*)\\}`));
      expect(rule, `no @layer base rule selects input[type='${type}']`).not.toBeNull();
      const body = rule?.[1] ?? '';
      expect(body).toContain('box-sizing: border-box');
      expect(body).toContain('min-width: 0');
      expect(body).toContain('max-width: 100%');
    }
  );

  // The width caps alone still overflowed on an iPad: iOS's native theme lays
  // the control out regardless of them until the appearance is dropped.
  it.each(['date', 'time', 'datetime-local', 'month'])(
    'drops the native appearance of input[type=%s] on iOS WebKit',
    (type) => {
      const base = baseLayerBlocks(CSS).join('\n');
      const ios = base.match(/@supports \(-webkit-touch-callout: none\)\s*\{([\s\S]*?)\n {2}\}/);
      expect(ios, 'no iOS-scoped @supports block in @layer base').not.toBeNull();
      const rule = (ios?.[1] ?? '').match(new RegExp(`input\\[type='${type}'\\][^{]*\\{([^}]*)\\}`));
      expect(rule?.[1] ?? '').toContain('-webkit-appearance: none');
      expect(rule?.[1] ?? '').toContain('appearance: none');
    }
  );
});
