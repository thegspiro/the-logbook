/**
 * The edge of a form field
 *
 * WCAG 1.4.11 (Non-text Contrast, AA) asks that what identifies a control —
 * here, where a text field begins and ends — reach 3:1 against what is next to
 * it. A field's fill sits within a hair of every surface it is placed on in
 * every theme (white on white; slate-800 on a 6% white wash), so its border is
 * the whole of that boundary, on the inside against the fill and on the outside
 * against the surface.
 *
 * axe has no rule for non-text contrast, so the accessibility pass could not
 * see that the light border measured 1.48:1 on a card and the dark one 1.10:1
 * on the red band of the gradient. Like `themeGradientContrast.test.ts`, the
 * colours are exact values in `index.css`, so this measures them directly:
 * `--input-border` against the field's own fill, the modal surface, every
 * gradient stop, and every surface token composited over every stop.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToRgb, relativeLuminance, contrastRatio } from './utils/colorContrast';

const CSS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'styles', 'index.css'), 'utf8');

const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '.dark' },
  { name: 'high-contrast', selector: '.high-contrast' },
] as const;

const GRADIENT_STOPS = ['--bg-gradient-from', '--bg-gradient-via', '--bg-gradient-to'];
const SURFACES = ['--surface-bg', '--surface-secondary', '--surface-hover'];
/** Opaque backgrounds a field is drawn against or contains. */
const OPAQUE = ['--input-bg', '--surface-modal'];

/** Every declaration a theme's selector makes, merged in cascade order (see themeGradientContrast.test.ts). */
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

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const parse = (value: string): Rgba => {
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] ? Number(rgba[4]) : 1 };
  const hex = hexToRgb(value);
  if (!hex) throw new Error(`unparseable colour: ${value}`);
  return { ...hex, a: 1 };
};

const over = (top: Rgba, base: Rgba): Rgba => ({
  r: top.r * top.a + base.r * (1 - top.a),
  g: top.g * top.a + base.g * (1 - top.a),
  b: top.b * top.a + base.b * (1 - top.a),
  a: 1,
});

const ratio = (a: Rgba, b: Rgba): number =>
  contrastRatio(relativeLuminance(a.r, a.g, a.b), relativeLuminance(b.r, b.g, b.b));

describe('form-field border (WCAG 1.4.11)', () => {
  it.each(THEMES)('clears 3:1 against everything a field sits on or contains, in $name', ({ name, selector }) => {
    const vars = declarations(selector);
    const border = parse(vars.get('--input-border') ?? '');
    const backgrounds: [string, Rgba][] = [];
    for (const token of OPAQUE) backgrounds.push([token, parse(vars.get(token) ?? '')]);
    for (const stop of GRADIENT_STOPS) {
      const base = parse(vars.get(stop) ?? '');
      backgrounds.push([stop, base]);
      for (const surface of SURFACES)
        backgrounds.push([`${surface} over ${stop}`, over(parse(vars.get(surface) ?? ''), base)]);
    }

    const failures = backgrounds
      .map(([label, background]) => [label, ratio(border, background)] as const)
      .filter(([, measured]) => measured < 3)
      .map(([label, measured]) => `${name}: --input-border on ${label} is ${measured.toFixed(2)}:1`);
    expect(failures, 'a field border must clear 3:1 against its fill and every surface around it').toEqual([]);
  });

  // The token is only the boundary if a field keeps it. The onboarding
  // organization form swapped it for the card-edge token, 1.18:1 on white.
  it('is not replaced on a field by the surface border', () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)));
    const files = fs.readdirSync(src, { recursive: true, encoding: 'utf8' });
    const offenders = files
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
      .flatMap((file) =>
        fs
          .readFileSync(path.join(src, file), 'utf8')
          .split('\n')
          .map((line, index) => [line, index] as const)
          .filter(([line]) => /\bform-input\b/.test(line) && line.includes('border-theme-surface-border'))
          .map(([, index]) => `${file}:${index + 1}`)
      );
    expect(offenders, 'a form-input keeps --input-border; use border-theme-input-border').toEqual([]);
  });

  // The premise, so the test above cannot pass by reading nothing.
  it('reads every token it measures from all three themes', () => {
    for (const { selector } of THEMES) {
      const vars = declarations(selector);
      for (const token of ['--input-border', ...OPAQUE, ...GRADIENT_STOPS, ...SURFACES]) {
        expect(vars.get(token), `${selector} is missing ${token}`).toBeDefined();
      }
    }
  });
});
