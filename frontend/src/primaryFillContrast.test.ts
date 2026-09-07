/**
 * Primary fill contrast
 *
 * White on red-600 (`#dc2626`) measures **4.83:1**. That is AA for large text
 * only, and a button label, a filter pill, a tab and a date badge are not
 * large text — so a red-600 fill carrying white content misses the AAA bar
 * the rest of the palette was raised to on 2026-08-23. red-800 (`#991b1b`)
 * measures 8.31:1 and is what `btn-primary` and `nav-item-active` use.
 *
 * The failure is invisible to whoever picks it: the control looks fine on a
 * bright desk monitor and goes unreadable on a phone in daylight, which is
 * where most of this app is used. Nothing about the markup says which red it
 * got, so the only way it stays consistent is to check.
 *
 * Six call sites survived that sweep (a layout toggle, a preview viewport
 * toggle, two shift-board strips, a weekday picker and the calendar's "today"
 * badge) because a hand-typed class string is not something a palette change
 * can find. This walks the source instead. Tinted reds — `bg-red-600/20` and
 * friends, which sit behind red-700 text — are a different pattern and pass.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToRgb, relativeLuminance, contrastRatio } from './utils/colorContrast';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** An opaque `bg-red-600`. The `/`-suffixed tints are deliberately excluded. */
const OPAQUE_RED_600 = /\bbg-red-600\b(?!\/)/;

/**
 * Hex for the fills the stylesheet actually uses. Tailwind v4 authors its
 * palette in OKLCH; these are the sRGB values it resolves to, and the same
 * ones the red-600/red-800 assertion below has always used. A fill whose shade
 * is missing here fails the sweep rather than being skipped, so the map cannot
 * silently fall behind the stylesheet.
 */
const TAILWIND: Record<string, string> = {
  'amber-400': '#fbbf24',
  'amber-500': '#f59e0b',
  'amber-600': '#d97706',
  'amber-700': '#b45309',
  'amber-800': '#92400e',
  'amber-900': '#78350f',
  'blue-400': '#60a5fa',
  'blue-500': '#3b82f6',
  'blue-600': '#2563eb',
  'blue-700': '#1d4ed8',
  'blue-800': '#1e40af',
  'blue-900': '#1e3a8a',
  'cyan-400': '#22d3ee',
  'cyan-500': '#06b6d4',
  'cyan-600': '#0891b2',
  'cyan-700': '#0e7490',
  'cyan-800': '#155e75',
  'cyan-900': '#164e63',
  'emerald-400': '#34d399',
  'emerald-500': '#10b981',
  'emerald-600': '#059669',
  'emerald-700': '#047857',
  'emerald-800': '#065f46',
  'emerald-900': '#064e3b',
  'green-400': '#4ade80',
  'green-500': '#22c55e',
  'green-600': '#16a34a',
  'green-700': '#15803d',
  'green-800': '#166534',
  'green-900': '#14532d',
  'indigo-400': '#818cf8',
  'indigo-500': '#6366f1',
  'indigo-600': '#4f46e5',
  'indigo-700': '#4338ca',
  'indigo-800': '#3730a3',
  'indigo-900': '#312e81',
  'lime-400': '#a3e635',
  'lime-500': '#84cc16',
  'lime-600': '#65a30d',
  'lime-700': '#4d7c0f',
  'lime-800': '#3f6212',
  'lime-900': '#365314',
  'orange-400': '#fb923c',
  'orange-500': '#f97316',
  'orange-600': '#ea580c',
  'orange-700': '#c2410c',
  'orange-800': '#9a3412',
  'orange-900': '#7c2d12',
  'pink-400': '#f472b6',
  'pink-500': '#ec4899',
  'pink-600': '#db2777',
  'pink-700': '#be185d',
  'pink-800': '#9d174d',
  'pink-900': '#831843',
  'purple-400': '#c084fc',
  'purple-500': '#a855f7',
  'purple-600': '#9333ea',
  'purple-700': '#7e22ce',
  'purple-800': '#6b21a8',
  'purple-900': '#581c87',
  'red-400': '#f87171',
  'red-500': '#ef4444',
  'red-600': '#dc2626',
  'red-700': '#b91c1c',
  'red-800': '#991b1b',
  'red-900': '#7f1d1d',
  'rose-400': '#fb7185',
  'rose-500': '#f43f5e',
  'rose-600': '#e11d48',
  'rose-700': '#be123c',
  'rose-800': '#9f1239',
  'rose-900': '#881337',
  'sky-400': '#38bdf8',
  'sky-500': '#0ea5e9',
  'sky-600': '#0284c7',
  'sky-700': '#0369a1',
  'sky-800': '#075985',
  'sky-900': '#0c4a6e',
  'teal-400': '#2dd4bf',
  'teal-500': '#14b8a6',
  'teal-600': '#0d9488',
  'teal-700': '#0f766e',
  'teal-800': '#115e59',
  'teal-900': '#134e4a',
  'violet-400': '#a78bfa',
  'violet-500': '#8b5cf6',
  'violet-600': '#7c3aed',
  'violet-700': '#6d28d9',
  'violet-800': '#5b21b6',
  'violet-900': '#4c1d95',
  'yellow-400': '#facc15',
  'yellow-500': '#eab308',
  'yellow-600': '#ca8a04',
  'yellow-700': '#a16207',
  'yellow-800': '#854d0e',
  'yellow-900': '#713f12',
};

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // e2e specs drive a real browser, not this markup.
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const files = collectSourceFiles(SRC);

interface Offender {
  file: string;
  line: number;
  text: string;
}

const findOffenders = (): Offender[] => {
  const offenders: Offender[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!OPAQUE_RED_600.test(line)) return;
      offenders.push({ file: path.relative(SRC, file), line: index + 1, text: line.trim() });
    });
  }
  return offenders;
};

describe('primary fill contrast', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  // The premise, pinned so the rule survives a palette change rather than
  // reading as an arbitrary ban on one Tailwind shade.
  it('is the reason red-600 is not a fill: white on it misses AAA', () => {
    const white = relativeLuminance(255, 255, 255);
    const ratioOn = (hex: string) => {
      const rgb = hexToRgb(hex);
      if (!rgb) throw new Error(`unparseable hex: ${hex}`);
      return contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), white);
    };

    expect(ratioOn('#dc2626')).toBeLessThan(7); // red-600 — 4.83:1
    expect(ratioOn('#991b1b')).toBeGreaterThanOrEqual(7); // red-800 — 8.31:1
  });

  /**
   * The rule above bans one shade. This one states the property that shade was
   * banned for, over every shared fill in the stylesheet at once — which is
   * what "the palette is one decision" in CLAUDE.md actually claims.
   *
   * It was not true when written. `btn-primary` and `nav-item-active` were
   * raised to red-800 in the 2026-08-23 sweep and the other three fills were
   * not looked at, because the sweep searched for a red. `btn-success` sat at
   * green-600 (3.30:1) and `btn-warning` at yellow-600 (2.94:1) — both below
   * the 4.5:1 AA floor for normal text, not merely short of AAA — and
   * `btn-info` at blue-600 (5.17:1) was AA only. Between them they carry the
   * confirm, publish, approve and archive actions in 101 files.
   *
   * Reading the fills out of index.css rather than listing them here is the
   * point: a new `@utility` pairing text-white with a fill is measured the day
   * it is added, and an unknown shade fails loudly instead of being skipped.
   */
  it('gives every shared white-on-fill utility a AAA background', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles', 'index.css'), 'utf8');
    const white = relativeLuminance(255, 255, 255);

    const failures = [...css.matchAll(/@utility\s+([\w-]+)\s*\{(.*?)\n\}/gs)].flatMap(([, name, body]) => {
      if (!body?.includes('text-white')) return [];
      return [...body.matchAll(/\bbg-([a-z]+)-(\d{2,3})\b(?!\/)/g)].flatMap(([, color, shade]) => {
        const hex = TAILWIND[`${color}-${shade}`];
        if (!hex) return [`${name}: bg-${color}-${shade} — add its hex to TAILWIND so it can be measured`];
        const rgb = hexToRgb(hex);
        if (!rgb) throw new Error(`unparseable hex for ${color}-${shade}: ${hex}`);
        const ratio = contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), white);
        return ratio >= 7
          ? []
          : [`${name}: white on bg-${color}-${shade} is ${ratio.toFixed(2)}:1, below the 7:1 AAA floor`];
      });
    });

    expect(failures, 'move the fill two shades darker (600 -> 800) as btn-primary did').toEqual([]);
  });

  /**
   * The same 4.5:1 floor, at the call sites the utilities do not cover.
   *
   * 125 class strings across 60 files paired `text-white` with a fill below AA
   * — `bg-green-600` at 3.30:1, `bg-amber-600` at 3.19:1, `bg-cyan-600` at
   * 3.68:1 and so on. None was reachable by a palette change, because none goes
   * through index.css; they are hand-typed strings, and the 2026-08-23 uplift
   * that "was applied to every call site at once" could not have found them.
   *
   * Call sites are held to AA here, not the AAA the shared fills above meet:
   * the colour often carries meaning (a status, a channel, a severity) and
   * darkening every one of them two steps flattens a distinction the reader
   * uses. `mobile-accessibility.spec.ts` measures the rendered result and
   * ratchets what is left below 7:1.
   *
   * Matched per quoted **segment**, not per line. A ternary puts both branches
   * on one line, so a line-level match reads `bg-amber-400 text-amber-950`
   * (8.97:1, a deliberately bright "on" indicator) as white-on-amber and
   * "fixes" it to 2.98:1. That is not hypothetical — the sweep that cleared
   * this backlog did exactly that to FlashlightToggle before it was caught.
   */
  it('pairs no text-white with a sub-AA fill at any call site', () => {
    const white = relativeLuminance(255, 255, 255);
    const hues = [...new Set(Object.keys(TAILWIND).map((key) => key.split('-')[0]))].join('|');
    const FILL = new RegExp(String.raw`\b(?:[a-z-]+:)*bg-(${hues})-(\d{3})\b(?!/)`, 'g');

    const offenders = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return source.split('\n').flatMap((line, index) =>
        [...line.matchAll(/'([^']*)'|"([^"]*)"/g)].flatMap((quoted) => {
          const segment = quoted[1] ?? quoted[2] ?? '';
          if (!segment.includes('text-white')) return [];
          return [...segment.matchAll(FILL)].flatMap(([token, hue, shade]) => {
            const hex = TAILWIND[`${hue}-${shade}`];
            if (!hex) return [`${path.relative(SRC, file)}:${index + 1} — ${token}: add its hex to TAILWIND`];
            const rgb = hexToRgb(hex);
            if (!rgb) throw new Error(`unparseable hex for ${hue}-${shade}: ${hex}`);
            const ratio = contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), white);
            return ratio >= 4.5
              ? []
              : [`${path.relative(SRC, file)}:${index + 1} — white on ${token} is ${ratio.toFixed(2)}:1`];
          });
        })
      );
    });

    expect(
      offenders,
      'raise the fill to the lightest shade of the same hue that clears 4.5:1 (usually -700), ' +
        'or reach for btn-primary/btn-success/btn-info/btn-warning instead of a hand-typed box'
    ).toEqual([]);
  });

  it('uses no opaque red-600 fill anywhere', () => {
    const report = findOffenders().map((o) => `${o.file}:${o.line} — ${o.text}`);

    expect(
      report,
      'Use bg-red-800 (8.31:1 against white), matching btn-primary and nav-item-active. ' +
        'A tinted bg-red-600/20 behind red-700 text is a different pattern and is fine.'
    ).toEqual([]);
  });
});
