/**
 * Contrast integrity for the sweep
 *
 * The sweep paints the same three states — good, fault, restock — on two
 * grounds that pull in opposite directions, and the pull is invisible in
 * review because both sites read as "the fault colour".
 *
 * A truck-map segment is a graphical object on the fixed slate-900 header, so
 * it is measured against that dark ground and wants a *lighter* fill. A
 * jump-sheet pip or a verdict button is white text on a fill over the light
 * body surface, so it is measured with white and wants a *darker* one. The
 * shade that satisfies either fails the other by a wide margin: red-800 is
 * 8.3:1 with white and 2.2:1 on slate-900, which is why the fault segment —
 * the one thing the strip exists to make findable — was the hardest block on
 * it to see.
 *
 * Both halves are asserted here, so the tempting refactor fails: collapse the
 * two palettes into one constant and whichever ground loses goes red, naming
 * the ratio and the site.
 *
 * The bars are WCAG's: 7:1 for text (AAA — CLAUDE.md's reason for a red-800
 * primary is that white on red-600 is 4.8:1, and a button label is not large
 * text), and 3:1 for a graphical object carrying meaning.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Tailwind v4 palette values, only the shades these files actually name. */
const PALETTE: Record<string, string> = {
  white: '#ffffff',
  'slate-900': '#0f172a',
  'amber-600': '#d97706',
  'amber-800': '#92400e',
  'blue-600': '#2563eb',
  'blue-800': '#1e40af',
  'blue-900': '#1e3a8a',
  'green-500': '#22c55e',
  'green-600': '#16a34a',
  'green-700': '#15803d',
  'green-800': '#166534',
  'red-500': '#ef4444',
  'red-600': '#dc2626',
  'red-800': '#991b1b',
  'red-900': '#7f1d1d',
  'orange-500': '#f97316',
  'orange-700': '#c2410c',
  'orange-800': '#9a3412',
};

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const r = channel(parseInt(h.slice(0, 2), 16));
  const g = channel(parseInt(h.slice(2, 4), 16));
  const b = channel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const shade = (name: string): string => {
  const hex = PALETTE[name];
  // A shade the sweep started using and this table does not know is not a pass
  // by default — it is an unmeasured colour, which is the state this test
  // exists to prevent.
  if (hex === undefined) throw new Error(`Add ${name} to PALETTE so its contrast is measured, not assumed.`);
  return hex;
};

const SWEEP_FILES = [
  'CheckSweep.tsx',
  'CheckSweepStop.tsx',
  'CheckJumpSheet.tsx',
  'CheckFinish.tsx',
  // The accordion is held to the same bar. Its verdict triad shipped at
  // 3.19 / 3.30 / 8.31 — two answers below AA sitting beside one at AAA, three
  // buttons meant to read as peers — and nothing was watching.
  'EquipmentCheckForm.tsx',
];

const read = (file: string): string => fs.readFileSync(path.join(HERE, file), 'utf8');

describe('sweep contrast', () => {
  it('clears AAA wherever white text sits on a palette fill', () => {
    const failures: string[] = [];

    for (const file of SWEEP_FILES) {
      const source = read(file);
      // Class strings are quoted literals; a ternary's branches are separate
      // literals, so a fill and the `text-white` it carries share one match
      // only when they genuinely apply together.
      for (const literal of source.match(/'[^'\n]*'|"[^"\n]*"/g) ?? []) {
        if (!/(?<![\w-])text-white(?![\w-])/.test(literal)) continue;
        for (const [, name] of literal.matchAll(
          /(?<![\w-])bg-((?:slate|green|red|orange|amber|blue)-\d{3})(?![\w-/])/g
        )) {
          const ratio = contrast(shade(name as string), PALETTE.white as string);
          if (ratio < 7) failures.push(`${file}: white on ${name as string} is ${ratio.toFixed(2)}:1, needs 7:1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps every truck-map fill legible against the dark header it sits on', () => {
    // The map's ground is the slate-900 band both the sweep and the finish
    // wrap it in; the segments carry no text, so the bar is the graphical 3:1.
    const source = read('CheckSweep.tsx');
    const block = /const MAP_FILL[^{]*\{([^}]*)\}/.exec(source)?.[1];
    expect(block, 'MAP_FILL should still be a literal this test can read').toBeDefined();

    const fills = [...(block as string).matchAll(/'bg-((?:green|red|orange)-\d{3})'/g)].map((m) => m[1] as string);
    // Three coloured states — untouched is bg-white/20 and measured by eye
    // against the same ground it is a tint of.
    expect(fills).toHaveLength(3);

    const failures = fills
      .map((name) => ({ name, ratio: contrast(shade(name), PALETTE['slate-900'] as string) }))
      .filter(({ ratio }) => ratio < 3)
      .map(({ name, ratio }) => `${name} on slate-900 is ${ratio.toFixed(2)}:1, needs 3:1`);

    expect(failures).toEqual([]);
  });
});
