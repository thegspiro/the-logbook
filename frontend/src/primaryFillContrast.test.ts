/**
 * Primary fill contrast
 *
 * White on red-600 measures **4.77:1**. That is AA for large text only, and a
 * button label, a filter pill, a tab and a date badge are not large text — so a
 * red-600 fill carrying white content misses the AAA bar the rest of the
 * palette was raised to on 2026-08-23. red-800 measures 8.36:1 and is what
 * `btn-primary` and `nav-item-active` use.
 *
 * Those two figures are measured from the installed Tailwind palette rather
 * than quoted from a table, and they moved when the measurement did: the v3
 * hexes this file used to carry put red-600 at 4.83:1 and red-800 at 8.31:1.
 * Tailwind v4 authors its palette in OKLCH, so those hexes were never what the
 * browser painted.
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
import { createRequire } from 'node:module';
import { hexToRgb, relativeLuminance, contrastRatio } from './utils/colorContrast';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** An opaque `bg-red-600`. The `/`-suffixed tints are deliberately excluded. */
const OPAQUE_RED_600 = /\bbg-red-600\b(?!\/)/;

/** sRGB channel from a linear-light one, per the sRGB transfer function. */
const gammaEncode = (channel: number): number => {
  const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
};

/**
 * OKLCH -> sRGB, because that is the space Tailwind v4 authors its palette in.
 *
 * The matrices are the ones in the Oklab specification: polar to rectangular,
 * Oklab to cone responses, cubed, then to linear sRGB and gamma-encoded. Out
 * of gamut components are clamped, which is what a browser does too.
 */
const oklchToRgb = (l: number, c: number, hDegrees: number): { r: number; g: number; b: number } => {
  const h = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  const lCone = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;

  return {
    r: gammaEncode(4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone),
    g: gammaEncode(-1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone),
    b: gammaEncode(-0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone),
  };
};

/**
 * The palette this build actually renders, read out of the installed Tailwind
 * and then out of the project's own `@theme`.
 *
 * It used to be a hand-copied table of v3 hexes, and that was wrong twice over.
 * Tailwind v4 authors its palette in OKLCH — `amber-700` is
 * `oklch(55.5% 0.163 48.998)`, which is not the `#b45309` the table claimed —
 * so every ratio here was measured against a colour the browser does not
 * paint. And a table that duplicates a dependency stays green through the
 * upgrade that changes a shade underneath it, which is the one moment a
 * contrast guard exists for.
 *
 * `index.css` is read second so a project override (`--color-primary-*`) wins
 * over the stock value, in the order the cascade applies them.
 */
const readPalette = (): Record<string, { r: number; g: number; b: number }> => {
  const require = createRequire(import.meta.url);
  const tailwindTheme = path.join(path.dirname(require.resolve('tailwindcss/package.json')), 'theme.css');
  const palette: Record<string, { r: number; g: number; b: number }> = {};

  for (const file of [tailwindTheme, path.join(SRC, 'styles', 'index.css')]) {
    const css = fs.readFileSync(file, 'utf8');
    for (const [, name, value] of css.matchAll(/--color-([a-z]+-\d{2,3})\s*:\s*([^;]+);/g)) {
      const raw = (value ?? '').trim();
      const oklch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/.exec(raw);
      if (oklch) {
        palette[name ?? ''] = oklchToRgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]));
        continue;
      }
      const rgb = hexToRgb(raw);
      if (rgb) palette[name ?? ''] = rgb;
    }
  }
  return palette;
};

const PALETTE = readPalette();

/** The measured contrast of white on a palette entry, or null if unknown. */
const whiteOn = (key: string): number | null => {
  const rgb = PALETTE[key];
  if (!rgb) return null;
  return contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), relativeLuminance(255, 255, 255));
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
    // Measured against the installed palette, so a Tailwind upgrade that moves
    // either shade is reported here rather than quietly invalidating the rule.
    expect(whiteOn('red-600')).toBeLessThan(7);
    expect(whiteOn('red-800')).toBeGreaterThanOrEqual(7);
  });

  /**
   * The rule above bans one shade. This one states the property that shade was
   * banned for, over every shared fill in the stylesheet at once — which is
   * what "the palette is one decision" in CLAUDE.md actually claims.
   *
   * It was not true when written. `btn-primary` and `nav-item-active` were
   * raised to red-800 in the 2026-08-23 sweep and the other three fills were
   * not looked at, because the sweep searched for a red. `btn-success` sat at
   * green-600 (3.22:1) and `btn-warning` at yellow-600 (2.94:1) — both below
   * the 4.5:1 AA floor for normal text, not merely short of AAA — and
   * `btn-info` at blue-600 (5.25:1) was AA only. Between them they carry the
   * confirm, publish, approve and archive actions in 101 files.
   *
   * Reading the fills out of index.css rather than listing them here is the
   * point: a new `@utility` pairing text-white with a fill is measured the day
   * it is added, and an unknown shade fails loudly instead of being skipped.
   */
  it('gives every shared white-on-fill utility a AAA background', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles', 'index.css'), 'utf8');

    const failures = [...css.matchAll(/@utility\s+([\w-]+)\s*\{(.*?)\n\}/gs)].flatMap(([, name, body]) => {
      if (!body?.includes('text-white')) return [];
      return [...body.matchAll(/\bbg-([a-z]+)-(\d{2,3})\b(?!\/)/g)].flatMap(([, color, shade]) => {
        const ratio = whiteOn(`${color}-${shade}`);
        if (ratio === null) return [`${name}: bg-${color}-${shade} is not in the installed Tailwind palette`];
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
   * Pairing a fill with the foreground that actually covers it takes three
   * rules, each learned by getting it wrong:
   *
   *   Per quoted **segment**, not per line. A ternary puts both branches on one
   *   line, so a line-level match reads `bg-amber-400 text-amber-950` (8.97:1,
   *   a deliberately bright "on" indicator) as white-on-amber and "fixes" it to
   *   2.98:1. The sweep that cleared this backlog did exactly that to
   *   FlashlightToggle before it was caught.
   *
   *   Template literals count, and their static text is shared context. A
   *   `className={`… text-white … ${cond ? 'bg-green-600' : …}`}` keeps the
   *   foreground in the static part and the fill in a branch, so neither piece
   *   on its own looks like a violation — and the most common className form in
   *   this codebase went entirely unscanned. ReturnRequestsPanel sat at 3.30:1
   *   through the sweep and through the first version of this test.
   *
   *   Variants scope the pairing. `dark:bg-emerald-500` is covered by
   *   `dark:text-emerald-950`, not by the `text-white` sitting beside it for the
   *   light theme; measuring it against white reports 1.9:1 for a pairing that
   *   never renders. A fill takes the foreground sharing its variant prefix,
   *   falling back to the unprefixed one.
   */
  it('pairs no text-white with a sub-AA fill at any call site', () => {
    // Any hue, not only the ones already in the table: a fill whose shade is
    // unknown must fail loudly ("add its hex") rather than be skipped. Building
    // the alternation out of the palette made the sweep self-limiting — the one
    // shape it could never report was the one nobody had measured yet.
    // `bg-` and the three gradient stops together. A gradient fill is still a
    // fill — `from-red-600 to-orange-600` under `text-white` is a button, and
    // orange-600 is 3.60:1 — but axe cannot measure one (it abstains with
    // "background gradient") and the `bg-` sweep never looked at it, so this
    // whole class of control was unmeasured on both sides. Every stop is
    // checked, because the worst stop is what the label crosses.
    const fillPattern = String.raw`\b((?:[a-z-]+:)*)(?:bg|from|via|to)-([a-z]+)-(\d{2,3})\b(?!/)`;
    const textPattern = /\b((?:[a-z-]+:)*)text-([a-z]+)(?:-(\d{3}))?\b/g;

    /** The foreground each variant prefix paints, e.g. `''` -> white, `dark:` -> emerald-950. */
    const foregrounds = (text: string): Map<string, string> => {
      const found = new Map<string, string>();
      for (const [, variant, hue, shade] of text.matchAll(textPattern)) {
        found.set(variant ?? '', shade ? `${hue}-${shade}` : (hue ?? ''));
      }
      return found;
    };

    /**
     * A fill's variant prefix, then every less specific prefix it falls back
     * to, longest first: `dark:hover:` -> `dark:hover:`, `dark:`, `hover:`, ``.
     */
    const candidatePrefixes = (prefix: string): string[] => {
      const variants = prefix.split(':').filter(Boolean);
      const subsets: string[][] = [[]];
      for (const variant of variants) {
        for (const subset of [...subsets]) subsets.push([...subset, variant]);
      }
      return subsets.sort((a, b) => b.length - a.length).map((subset) => (subset.length ? `${subset.join(':')}:` : ''));
    };

    const offenders: string[] = [];

    const inspect = (file: string, line: number, segment: string, inherited: Map<string, string>) => {
      const own = foregrounds(segment);
      for (const [whole, variant, hue, shade] of segment.matchAll(new RegExp(fillPattern, 'g'))) {
        const prefix = variant ?? '';
        // The foreground that covers this fill, most specific first. A
        // `dark:hover:` fill is covered by `dark:hover:text-*` if present, then
        // by `dark:text-*` — not by the `text-white` sitting beside it for the
        // light theme, which is a pairing that never renders.
        const fg = candidatePrefixes(prefix)
          .flatMap((candidate) => [own.get(candidate), inherited.get(candidate)])
          .find((value) => value !== undefined);
        if (fg !== 'white') continue;
        const key = `${hue}-${shade}`;
        const ratio = whiteOn(key);
        if (ratio === null) {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${whole} is not in the installed Tailwind palette`);
          continue;
        }
        if (ratio < 4.5) {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${prefix}white on ${whole} is ${ratio.toFixed(2)}:1`);
        }
      }
    };

    /**
     * Every `className` value in a file, each bounded to the one element it
     * dresses.
     *
     * Bounding matters twice over. Per line is too small — a className template
     * routinely spans three lines (static text, an interpolated ternary, the
     * closing brace), so a per-line matcher never sees a complete backtick pair
     * and the branch inside it goes unexamined; that is where
     * ReturnRequestsPanel hid a 3.30:1 pairing. Whole-file is too large — a
     * bare ``/`[^`]*`/`` pairs backticks across unrelated elements, and the
     * foregrounds of one then get attributed to the fills of another.
     */
    const classNameValues = (source: string): Array<{ value: string; line: number; end: number }> => {
      const found: Array<{ value: string; line: number; end: number }> = [];
      const attribute = /className=/g;
      for (const match of source.matchAll(attribute)) {
        let i = (match.index ?? 0) + match[0].length;
        const line = source.slice(0, i).split('\n').length;
        const opener = source[i];
        if (opener === '"' || opener === "'") {
          const close = source.indexOf(opener, i + 1);
          if (close > -1) found.push({ value: source.slice(i + 1, close), line, end: close });
          continue;
        }
        if (opener !== '{') continue;
        // Walk to the matching brace, stepping over nested braces and over
        // string/template bodies so their braces and quotes do not confuse it.
        let depth = 0;
        const start = i;
        for (; i < source.length; i++) {
          const ch = source[i];
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) break;
          } else if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i++;
            while (i < source.length && source[i] !== quote) {
              if (source[i] === '\\') i++;
              i++;
            }
          }
        }
        found.push({ value: source.slice(start + 1, i), line, end: i });
      }
      return found;
    };

    /**
     * Class strings declared away from the element they dress: the module-level
     * palette array in `Avatar.tsx`, the `Record<string, string>` status-badge
     * maps in `constants/enums.ts`, a `const badgeClass = '…'` above the JSX.
     * They are self-contained — `'bg-slate-500 text-white'` carries its own
     * foreground — so each literal is its own segment with no inherited
     * context. Literals already inside a className value are skipped; that pass
     * has the surrounding static text and so measures them better.
     */
    const standaloneLiterals = (
      source: string,
      covered: Array<{ start: number; end: number }>
    ): Array<{ value: string; line: number }> => {
      const found: Array<{ value: string; line: number }> = [];
      for (const match of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
        const index = match.index ?? 0;
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        if (!/\bbg-[a-z]+-\d{2,3}\b/.test(value)) continue;
        if (covered.some((range) => index >= range.start && index < range.end)) continue;
        found.push({ value, line: source.slice(0, index).split('\n').length });
      }
      return found;
    };

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const values = classNameValues(source);
      const covered = values.map(({ value, end }) => ({ start: end - value.length, end }));
      for (const { value, line } of standaloneLiterals(source, covered)) {
        inspect(file, line, value, new Map());
      }
      for (const { value, line } of values) {
        // Static text outside any quoted branch is the shared context: a
        // `text-white` there covers every branch's fill.
        const staticText = value.replace(/'[^']*'|"[^"]*"/g, ' ').replace(/\$\{[^}]*\}/gs, ' ');
        const context = foregrounds(staticText);
        inspect(file, line, staticText, new Map());
        for (const [, single, double] of value.matchAll(/'([^']*)'|"([^"]*)"/g)) {
          inspect(file, line, single ?? double ?? '', context);
        }
      }
    }

    expect(
      [...new Set(offenders)],
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
