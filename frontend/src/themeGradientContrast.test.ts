/**
 * Text on the page gradient
 *
 * The application paints its page background as a `linear-gradient` between
 * three theme variables. axe cannot compute a contrast ratio against a
 * gradient — it files those nodes under `incomplete` with "background gradient"
 * and reports no violation — so on every route, in every theme, the text
 * sitting directly on the page background goes unmeasured by the axe pass.
 * That is roughly 2,200 nodes across the inventory, the dashboard's `h1`
 * included.
 *
 * A browser cannot decide it; the stylesheet can. Both halves are exact hex
 * values declared a few lines apart in `index.css`, and the worst case a
 * gradient can present is one of its stops. So this measures every text tier
 * against every stop, per theme, and holds the result to the same AA floor the
 * axe pass asserts elsewhere.
 *
 * It is deliberately a unit test rather than another browser pass: the numbers
 * come from the stylesheet, so a change to a theme fails here in a second
 * rather than ten minutes into an E2E run.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToRgb, relativeLuminance, contrastRatio } from './utils/colorContrast';

const CSS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'styles', 'index.css'), 'utf8');

/** The three theme scopes, in the order the cascade applies them. */
const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '.dark' },
  { name: 'high-contrast', selector: '.high-contrast' },
] as const;

const GRADIENT_STOPS = ['--bg-gradient-from', '--bg-gradient-via', '--bg-gradient-to'];
const TEXT_TIERS = ['--text-primary', '--text-secondary', '--text-muted'];

/**
 * Every declaration a theme's selector makes, merged in cascade order.
 *
 * Two subtleties, both learned by getting them wrong. The selector appears more
 * than once — `:root` carries the `@theme` palette near the top of the file and
 * the theme variables a thousand lines below it — so taking the first block
 * reads the palette and finds no `--text-primary` at all. And a block's body
 * has to be brace-matched: it contains nested `@media` rules, and stopping at
 * the first closing brace truncates it. Those nested bodies are then dropped,
 * because a reduced-motion or print override is not the theme.
 */
const declarations = (selector: string): Map<string, string> => {
  const found = new Map<string, string>();
  const opener = new RegExp(String.raw`(?:^|\n)${selector.replace('.', '\\.')}\s*\{`, 'g');

  for (const match of CSS.matchAll(opener)) {
    let depth = 0;
    let end = CSS.length;
    const bodyStart = CSS.indexOf('{', match.index ?? 0);
    for (let i = bodyStart; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    // Drop nested at-rule bodies so only the theme's own declarations remain.
    let body = CSS.slice(bodyStart + 1, end);
    let previous: string;
    do {
      previous = body;
      body = body.replace(/@[\w-]+[^{}]*\{[^{}]*\}/g, ' ');
    } while (body !== previous);

    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name ?? '', (value ?? '').trim());
    }
  }
  return found;
};

const ratio = (foreground: string, background: string): number => {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) throw new Error(`unparseable colour: ${foreground} on ${background}`);
  return contrastRatio(relativeLuminance(fg.r, fg.g, fg.b), relativeLuminance(bg.r, bg.g, bg.b));
};

describe('text on the page gradient', () => {
  it.each(THEMES)('holds AA in $name, against every gradient stop', ({ name, selector }) => {
    const vars = declarations(selector);

    const failures: string[] = [];
    for (const tier of TEXT_TIERS) {
      const foreground = vars.get(tier);
      expect(foreground, `${selector} declares no ${tier}`).toBeDefined();
      for (const stop of GRADIENT_STOPS) {
        const background = vars.get(stop);
        expect(background, `${selector} declares no ${stop}`).toBeDefined();
        const measured = ratio(foreground ?? '', background ?? '');
        if (measured < 4.5) {
          failures.push(`${name}: ${tier} (${foreground}) on ${stop} (${background}) is ${measured.toFixed(2)}:1`);
        }
      }
    }

    expect(failures, 'text on the page background must clear 4.5:1 at every stop of the gradient').toEqual([]);
  });

  // The premise, so the test above cannot quietly become vacuous if a theme
  // stops declaring the variables it reads.
  it('reads three stops and three text tiers from all three themes', () => {
    for (const { selector } of THEMES) {
      const vars = declarations(selector);
      for (const name of [...GRADIENT_STOPS, ...TEXT_TIERS]) {
        expect(vars.get(name), `${selector} is missing ${name}`).toMatch(/^#[0-9a-f]{3,8}$/i);
      }
    }
  });
});
