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
 *
 * ## What this sweep does not decide
 *
 * It is a ratchet over source text, not a proof about rendered pixels, and a
 * green run is not a guarantee that every call site clears AA. One gap is known
 * and deliberately left open:
 *
 * **Fragments from separate interpolations.** Branch splitting treats each
 * quoted fragment as mutually exclusive, and fragments from *different*
 * interpolations are not — they render together. A template that puts the fill
 * in one and the foreground in another is measured by neither half. Correlating
 * the Nth branch of one interpolation with the Nth of another is unsound (the
 * conditions need not match), and the obvious heuristic — flatten the template
 * when its foregrounds agree — was built, measured, and rejected: it reported
 * **15 findings across real call sites** that render nothing of the kind,
 * because a foreground inside one branch was paired with fills it never wears.
 * A guard that cries wolf on valid code is worse than one with a stated blind
 * spot, so the blind spot is stated here instead.
 *
 * The runtime pass covers what this cannot: `mobile-accessibility.spec.ts` runs
 * axe against rendered pages in all three themes, where a computed style has no
 * branches to correlate.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { hexToRgb, relativeLuminance, contrastRatio } from './utils/colorContrast';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * An opaque `bg-red-600`. The `/`-suffixed tints are deliberately excluded —
 * except `/100`, which Tailwind emits as the same fully opaque colour as the
 * bare utility, so excluding it let the banned fill through with four
 * characters appended.
 */
const OPAQUE_RED_600 = /\bbg-red-600(?:\/100)?\b(?!\/)/;

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
    // `white` and `black` have no shade number, and a gradient stop can name
    // either — `to-white` under `text-white` is invisible text, which is the
    // failure this file exists to catch.
    for (const [, name, value] of css.matchAll(/--color-([a-z]+-\d{2,3}|white|black)\s*:\s*([^;]+);/g)) {
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

/** The stylesheet, read once: the sweeps below consult it thousands of times. */
const INDEX_CSS = fs.readFileSync(path.join(SRC, 'styles', 'index.css'), 'utf8');

const PALETTE = readPalette();

/**
 * The semantic theme tokens, resolved per theme.
 *
 * `bg-theme-accent-blue` carries no shade number, so the numeric fill pattern
 * below never matched one and the whole family went unmeasured. That mattered:
 * the token is blue-900 in light (10.36:1 under white) and a *light* blue in
 * dark and high-contrast — `#60a5fa` is 2.54:1, `#6bb5ff` is 2.17:1 — so
 * `bg-theme-accent-blue text-white` reads fine on a desk monitor and fails AA
 * on the same screen in dark mode. `bg-theme-text-muted text-white` was worse:
 * `--text-muted` is `#ffffff` in dark, making the control literally invisible.
 *
 * Only opaque hex values are resolved. The dark theme's `--surface-bg` is
 * `rgba(255,255,255,0.06)` over a gradient, which has no single value to
 * measure; a fill nothing can resolve is reported rather than skipped.
 */
const THEME_TOKENS: Array<{ theme: string; selector: string }> = [
  { theme: 'light', selector: ':root' },
  { theme: 'dark', selector: '.dark' },
  { theme: 'high-contrast', selector: '.high-contrast' },
];

const themeValues = (): Map<string, Map<string, string>> => {
  const css = INDEX_CSS;
  const resolved = new Map<string, Map<string, string>>();

  for (const { theme, selector } of THEME_TOKENS) {
    const values = new Map<string, string>();
    for (const match of css.matchAll(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{`, 'g'))) {
      let depth = 0;
      const bodyStart = css.indexOf('{', match.index ?? 0);
      let end = css.length;
      for (let i = bodyStart; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      let body = css.slice(bodyStart + 1, end);
      let previous: string;
      do {
        previous = body;
        body = body.replace(/@[\w-]+[^{}]*\{[^{}]*\}/g, ' ');
      } while (body !== previous);
      for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        values.set(name ?? '', (value ?? '').trim());
      }
    }
    resolved.set(theme, values);
  }
  return resolved;
};

const THEME_VALUES = themeValues();

/**
 * `theme-accent-blue` -> the `--accent-blue` / `--text-muted` value per theme.
 *
 * The `@theme` block aliases each Tailwind colour name to a raw custom property
 * (`--color-theme-accent-blue: var(--accent-blue)`), and the themes below set
 * the raw one. Read the alias so a renamed token is followed rather than
 * guessed at.
 */
const SEMANTIC_CACHE = new Map<string, Map<string, string>>();

const semanticFill = (name: string): Map<string, string> => {
  // Memoised, and the stylesheet read once. This is called per fill per
  // segment across ~500 files; re-reading and re-parsing a 2,000-line
  // stylesheet each time took the test from 2s standalone to a 5s timeout
  // under a loaded CI runner, which is a failure that only ever appears where
  // it is hardest to read.
  const cached = SEMANTIC_CACHE.get(name);
  if (cached) return cached;

  const css = INDEX_CSS;
  const alias = new RegExp(`--color-${name}\\s*:\\s*var\\((--[\\w-]+)\\)`).exec(css);
  const resolved = new Map<string, string>();
  if (!alias?.[1]) {
    SEMANTIC_CACHE.set(name, resolved);
    return resolved;
  }
  for (const { theme } of THEME_TOKENS) {
    const value = THEME_VALUES.get(theme)?.get(alias[1]);
    if (value) resolved.set(theme, value);
  }
  SEMANTIC_CACHE.set(name, resolved);
  return resolved;
};

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
    const css = INDEX_CSS;

    // Every utility's body, so an `@apply` of another custom utility can be
    // expanded before the white-foreground gate runs.
    const bodies = new Map<string, string>(
      [...css.matchAll(/@utility\s+([\w-]+)\s*\{(.*?)\n\}/gs)].map(([, name, body]) => [name ?? '', body ?? ''])
    );

    /**
     * A utility body with any composed custom utilities inlined.
     *
     * `@utility card-hover { @apply card; … }` is an established pattern here,
     * and a composed utility inherits the foreground of what it applies — so
     * `@apply btn-primary bg-orange-600` renders white on orange while its own
     * body contains no literal `text-white`. Reading the body alone let that
     * through, and a call site carries only the composed name, so nothing
     * downstream could recover it.
     */
    const expand = (name: string, seen = new Set<string>()): string => {
      if (seen.has(name)) return '';
      seen.add(name);
      const body = bodies.get(name) ?? '';
      const composed = [...body.matchAll(/(?:^|\s)([a-z][\w-]*)/g)]
        .map(([, token]) => token ?? '')
        .filter((token) => bodies.has(token))
        .map((token) => expand(token, seen));
      return [body, ...composed].join(' ');
    };

    const failures = [...bodies.keys()].flatMap((name) => {
      const body = expand(name);
      if (!body.includes('text-white')) return [];

      // Which foreground covers a fill, by variant — the same question the
      // call-site sweep asks. A body-wide `text-white` test paired white with
      // every fill regardless of variant, so an adaptive utility
      // (`bg-orange-600 text-orange-950 dark:bg-black dark:text-white`) was
      // reported at 3.60:1 for a pairing that never renders. Both halves of
      // such a utility are correct; only the cross-pairing is not.
      const utilityForegrounds = new Map<string, string>();
      for (const [, variant, hue, shade] of body.matchAll(/\b((?:[a-z-]+:)*)text-([a-z]+)(?:-(\d{3}))?\b/g)) {
        utilityForegrounds.set(variant ?? '', shade ? `${hue}-${shade}` : (hue ?? ''));
      }
      const coveringForeground = (variant: string): string | undefined => {
        const parts = variant.split(':').filter(Boolean);
        for (let i = 0; i <= parts.length; i++) {
          const candidate = parts.slice(i).length ? `${parts.slice(i).join(':')}:` : '';
          const found = utilityForegrounds.get(candidate);
          if (found !== undefined) return found;
        }
        return undefined;
      };
      // All four fill prefixes, and keyword colours alongside numbered shades.
      // A gradient defined in a shared utility never writes its stops at the
      // TSX call site, so the call-site sweep cannot see them and only this
      // pass can — and the repository's own convention prefers these utilities
      // over repeated inline classes, which makes it the more likely home for
      // one, not the less.
      // `/100` is the opaque colour, as everywhere else in this file; a call
      // site carries only the utility name, so a shade skipped here is skipped
      // by every check.
      const palette = [
        ...body.matchAll(/\b((?:[a-z-]+:)*)(bg|from|via|to)-([a-z]+-\d{2,3}|white|black)(?:\/100)?\b(?!\/)/g),
      ].flatMap(([, variant, prefix, key]) => {
        if (coveringForeground(variant ?? '') !== 'white') return [];
        return ((): string[] => {
          const ratio = whiteOn(key ?? '');
          if (ratio === null) return [`${name}: ${prefix}-${key} is not in the installed Tailwind palette`];
          return ratio >= 7
            ? []
            : [`${name}: white on ${prefix}-${key} is ${ratio.toFixed(2)}:1, below the 7:1 AAA floor`];
        })();
      });

      // Semantic fills and stops, resolved per theme exactly as the call-site
      // sweep does. `--text-muted` is `#ffffff` in dark, so a utility built on
      // it under `text-white` is invisible there — and invisible to every other
      // guard too, since the stops never reach a TSX file.
      const semantic = [
        ...body.matchAll(/\b((?:[a-z-]+:)*)(bg|from|via|to)-(theme-[a-z]+(?:-[a-z]+)*)(?:\/100)?\b(?!\/)/g),
      ].flatMap(([, variant, prefix, token]) =>
        coveringForeground(variant ?? '') !== 'white'
          ? []
          : [...semanticFill(token ?? '').entries()].flatMap(([theme, value]) => {
              const rgb = hexToRgb(value);
              if (!rgb) return [`${name}: ${prefix}-${token} is ${value} in ${theme}, unmeasurable`];
              const ratio = contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), relativeLuminance(255, 255, 255));
              return ratio >= 4.5 ? [] : [`${name}: white on ${prefix}-${token} is ${ratio.toFixed(2)}:1 in ${theme}`];
            })
      );

      return [...palette, ...semantic];
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
    //
    // `/100` is accepted here for the same reason as in the semantic loop
    // below: Tailwind emits it as the fully opaque colour, so rejecting every
    // opacity modifier let the identical broken pairing through with two
    // characters appended. A translucent stop has no single value and stays out.
    const fillPattern = String.raw`\b((?:[a-z-]+:)*)(?:bg|from|via|to)-([a-z]+-\d{2,3}|white|black)(?:\/100)?\b(?!/)`;
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

    const inspect = (
      file: string,
      line: number,
      segment: string,
      inherited: Map<string, string>,
      // The shared static text a branch sits inside, when there is one. A
      // `dark:` fill out here overrides an unprefixed fill in every branch, so
      // theme selection has to see it — reading `segment` alone measures the
      // base fill in a theme the shared override always wins.
      inheritedContext = ''
    ) => {
      const own = foregrounds(segment);
      for (const [whole, variant, key] of segment.matchAll(new RegExp(fillPattern, 'g'))) {
        const prefix = variant ?? '';
        // The foreground that covers this fill, most specific first. A
        // `dark:hover:` fill is covered by `dark:hover:text-*` if present, then
        // by `dark:text-*` — not by the `text-white` sitting beside it for the
        // light theme, which is a pairing that never renders.
        const fg = candidatePrefixes(prefix)
          .flatMap((candidate) => [own.get(candidate), inherited.get(candidate)])
          .find((value) => value !== undefined);
        if (fg !== 'white') continue;
        const ratio = whiteOn(key ?? '');
        if (ratio === null) {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${whole} is not in the installed Tailwind palette`);
          continue;
        }
        if (ratio < 4.5) {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${prefix}white on ${whole} is ${ratio.toFixed(2)}:1`);
        }
      }

      // The semantic fills, measured in every theme, foreground included.
      //
      // These carry no shade number, so the numeric pattern above cannot see
      // one — and they are the fills most likely to be wrong, because their
      // value flips between themes. `bg-theme-accent-blue` is blue-900 in light
      // and a light blue in dark and high-contrast; `bg-theme-text-muted` is
      // `#ffffff` in dark, which made one control white on white.
      //
      // The foreground is resolved per theme, not once. `dark:` is the variant
      // a call site uses to answer a flipping fill — `text-white
      // dark:text-slate-950` is the correct pairing for these tokens — so
      // picking one foreground up front and reusing it across all three themes
      // both misses the dark-mode failure of `text-slate-950 dark:text-white`
      // and reports a false one for the fix. High-contrast carries the `.dark`
      // class too (ThemeContext adds both), so a `dark:` foreground applies
      // there as well.
      //
      // Same segment discipline as above, and for the same reason: a ternary
      // puts a muted fill and a white foreground from two different branches on
      // one line, and reading them as one pairing is how this sweep reported
      // nine surfaces that render nothing of the kind.
      const THEME_VARIANT: Record<string, string> = {
        light: '',
        dark: 'dark:',
        'high-contrast': 'dark:',
      };

      // The trailing `(?!-)` rejects a class name built by interpolation. A
      // surface utility with a `${...}` suffix would otherwise capture with a
      // dangling hyphen and report twenty "resolves to no theme value" findings
      // for classes Tailwind never generates, since it needs whole class names
      // at build time.
      //
      // Written without a literal example on purpose: `themeTokenIntegrity`
      // sweeps this source too, and an illustrative half-token in a comment is
      // indistinguishable to it from the real thing — which is how this comment
      // took that test red.
      //
      // All four fill prefixes, not just `bg-`. A semantic gradient
      // (`bg-linear-to-r from-theme-… to-theme-…`) has a shade-less stop that
      // the numeric loop cannot match either, so restricting this loop to `bg-`
      // left it measured by nothing at all — the same gap that hid the flat
      // semantic fills, reopened one prefix over. The app already writes 57 of
      // these stops.
      //
      // `/100` is accepted, every other opacity modifier still rejected.
      // Tailwind emits `from-…/100` as the same fully opaque colour as the
      // bare utility, so excluding it let an author write the identical broken
      // pairing with two characters appended. A genuinely translucent stop has
      // no single value to measure and stays out.
      //
      // A stop's own variant decides which themes it renders in. `dark:` is the
      // app's only theme variant (`@custom-variant dark (&:is(.dark *))`), and
      // high-contrast carries the `.dark` class too, so a `dark:` fill is
      // painted in those two and never in light. Measuring it against the light
      // value reports a failure for a colour that theme never shows — which
      // would block the adaptive gradients this sweep exists to encourage.
      const themesFor = (matchPrefix: string, word: string): string[] => {
        if (/(^|:)dark:/.test(matchPrefix)) return ['dark', 'high-contrast'];
        // The mirror case: an unprefixed stop that a `dark:` sibling overrides
        // renders only in light. The sibling can be in this segment or in the
        // shared static text the segment is a branch of — branch splitting
        // hands over the inherited *foregrounds*, and this is the fill half of
        // the same context.
        //
        // Stated as an exclusion rather than a list of accepted shapes, and
        // that inversion is the point.
        //
        // This matcher was fixed three times by enumeration — first semantic
        // tokens, then numeric shades, then keyword colours — and each round
        // missed the next form (`dark:bg-black`, `dark:bg-[#0a0a0a]`) and
        // reported a *false* failure against a colour dark mode never paints.
        // The question is not which spellings of a colour exist; it is whether
        // the sibling establishes an opaque one. So anything opaque counts, and
        // only what genuinely fails to override is excluded: `transparent` and
        // `none` set no colour, and a translucent `/NN` composites over what is
        // beneath rather than replacing it. `/100` is opaque, as everywhere
        // else in this file.
        //
        // The two trailing lookaheads both matter. The first forces the value
        // to be maximal, so `dark:bg-slate-950/50` cannot backtrack to
        // `slate-95` and slip past the opacity check on the `0` that follows.
        // Does the `dark:` sibling actually set a colour?
        //
        // Asked semantically rather than by shape, because "looks opaque" was
        // too generous: it accepted anything in the `bg-` namespace, and
        // `bg-cover` sets background-size. `bg-theme-text-muted
        // dark:bg-cover text-white` was therefore excused from dark entirely
        // while still painting white on white — an inversion I introduced to
        // escape enumerating colour *spellings*, which then swept in utilities
        // that are not colours at all. Resolving the candidate answers both
        // questions at once and cannot drift as the palette changes.
        const setsColour = (raw: string): boolean => {
          const slash = raw.indexOf('/');
          const opacity = slash === -1 ? null : raw.slice(slash + 1);
          const value = slash === -1 ? raw : raw.slice(0, slash);
          // A translucent replacement composites over what is beneath rather
          // than replacing it; `/100` is the opaque colour itself.
          if (opacity !== null && opacity !== '100') return false;
          if (value === 'none') return false;
          // `transparent` sets no colour on a flat background, but on a
          // gradient stop it does replace: what shows is whatever backs it.
          if (value === 'transparent') return word !== 'bg';
          // An arbitrary value is only an override if it is a *colour*.
          // Tailwind's bracket syntax also carries background-size, position
          // and image — `dark:bg-[length:200px_100px]` compiles to
          // background-size — so accepting every bracketed value re-made the
          // `bg-cover` mistake one syntax over. Unrecognised shapes are
          // rejected rather than assumed: excusing a fill that is not really
          // overridden hides a defect, while measuring one that is produces a
          // visible complaint someone can correct.
          if (value.startsWith('[')) {
            const inner = value.slice(1, value.endsWith(']') ? -1 : undefined);
            if (/^(?:length|size|position|image|url|angle|percentage|number|integer):/i.test(inner)) return false;
            return /^(?:color:|#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|var\()/i.test(inner);
          }
          if (value.startsWith('theme-')) return semanticFill(value).size > 0;
          return PALETTE[value] !== undefined;
        };

        const state = matchPrefix.replace(/(^|:)dark:/g, '$1');
        const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const haystack = `${segment} ${inheritedContext}`;
        const overridden = [`dark:${state}${word}-`, `${state}dark:${word}-`].some((prefix) =>
          [...haystack.matchAll(new RegExp(String.raw`\b${escape(prefix)}([A-Za-z0-9[\]#.,%()_/-]+)`, 'g'))].some(
            ([, raw]) => setsColour(raw ?? '')
          )
        );
        return overridden ? ['light'] : ['light', 'dark', 'high-contrast'];
      };

      for (const [, variant, fill, token] of segment.matchAll(
        /\b((?:[a-z-]+:)*)(bg|from|via|to)-(theme-[a-z]+(?:-[a-z]+)*)(?:\/100)?\b(?![/-])/g
      )) {
        const prefix = variant ?? '';
        const themes = themesFor(prefix, fill ?? '');
        const perTheme = semanticFill(token ?? '');
        if (perTheme.size === 0) {
          // Only report a token nothing renders if something did pair a
          // foreground with it; an unknown token with no text is not this
          // check's business.
          const anyForeground = candidatePrefixes(prefix)
            .flatMap((candidate) => [own.get(candidate), inherited.get(candidate)])
            .find((value) => value !== undefined);
          if (anyForeground !== undefined) {
            offenders.push(`${path.relative(SRC, file)}:${line} — ${fill}-${token} resolves to no theme value`);
          }
          continue;
        }

        for (const [theme, value] of perTheme) {
          if (!themes.includes(theme)) continue;
          // The foreground this theme actually paints: the `dark:`-prefixed one
          // where the theme has that class, falling back to the unprefixed.
          const themePrefix = THEME_VARIANT[theme] ?? '';
          const fg = candidatePrefixes(`${themePrefix}${prefix}`)
            .flatMap((candidate) => [own.get(candidate), inherited.get(candidate)])
            .find((candidateValue) => candidateValue !== undefined);

          // Still only `text-white`, evaluated per theme rather than once.
          //
          // That per-theme evaluation is the whole point: `dark:text-slate-950`
          // is how a call site answers a fill that flips, so a single
          // resolution either misses the dark-mode failure of
          // `text-slate-950 dark:text-white` or reports a false one against the
          // fix. Keeping the white gate keeps the scope: this measures a label
          // on a filled control, not every icon that happens to sit on a
          // surface token — widening it to any foreground turns 7 findings into
          // 150, nearly all of them icons at 3:1 non-text contrast, which is a
          // different question than the one this check answers.
          if (fg !== 'white') continue;
          const foreground = { r: 255, g: 255, b: 255 };

          const rgb = hexToRgb(value);
          // A translucent token over a gradient has no single value to measure.
          // Reported rather than skipped: such a pairing is not something this
          // check can clear, and silence would read as a pass.
          if (!rgb) {
            offenders.push(
              `${path.relative(SRC, file)}:${line} — ${fill}-${token} is ${value} in ${theme}, unmeasurable`
            );
            continue;
          }
          const themeRatio = contrastRatio(
            relativeLuminance(rgb.r, rgb.g, rgb.b),
            relativeLuminance(foreground.r, foreground.g, foreground.b)
          );
          if (themeRatio < 4.5) {
            offenders.push(
              `${path.relative(SRC, file)}:${line} — ${fg} on ${fill}-${token} is ${themeRatio.toFixed(2)}:1 in ${theme}`
            );
          }
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
        // Both fill shapes across all four prefixes, or `inspect` never sees
        // the literal at all. A numeric-only prefilter discarded
        // `const badge = 'bg-theme-alert-danger-icon text-white'`; a `bg-`-only
        // one discarded every standalone *gradient*, since its own `bg-` is
        // `bg-linear-to-r` and matches neither shape — so a hoisted
        // `'bg-linear-to-r from-red-600 to-orange-600 text-white'` was measured
        // by nothing, numeric stops and all. Both gaps are the same mistake:
        // the prefilter has to admit whatever the passes below can measure.
        if (!/\b(?:bg|from|via|to)-(?:[a-z]+-\d{2,3}|theme-[a-z]+(?:-[a-z]+)*|white|black)\b/.test(value)) continue;
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
        // Split a template's conditional branches, exactly as the className
        // path below does — each branch measured as the shared static text
        // *plus* that branch, never a branch alone.
        //
        // The shared text is prepended because a template can put the fill
        // outside the interpolation and choose only the foreground inside it.
        // Splitting on its own then inspects the fill with no foreground and
        // each foreground with no fill, so the pairing is measured by neither
        // half — a case the old whole-template inspection did catch, which is
        // how splitting for the ternary gap opened this one. Static text is
        // shared by every branch, so folding it in cannot pair one branch's
        // fill with another's foreground; that is the ternary defect and stays
        // guarded by splitting the branches at all. A hoisted `${cond ? 'fill-a text-white' : 'fill-b
        // text-dark'}` is one literal to the scanner, and reading it whole lets
        // the *second* branch's foreground answer for the first — the same
        // ternary false-positive this file already guards against inside
        // `className`, arriving through the door that was opened when the
        // prefilter started admitting hoisted gradients.
        const staticText = value.replace(/'[^']*'|"[^"]*"/g, ' ').replace(/\$\{[^}]*\}/gs, ' ');
        const context = foregrounds(staticText);
        inspect(file, line, staticText, new Map());
        let branches = 0;
        for (const [, single, double] of value.matchAll(/'([^']*)'|"([^"]*)"/g)) {
          branches++;
          inspect(file, line, `${staticText} ${single ?? double ?? ''}`, context, staticText);
        }
        // A plain literal has no branches; it *is* its own segment.
        if (branches === 0) inspect(file, line, value, new Map());
      }
      for (const { value, line } of values) {
        // Static text outside any quoted branch is the shared context: a
        // `text-white` there covers every branch's fill.
        const staticText = value.replace(/'[^']*'|"[^"]*"/g, ' ').replace(/\$\{[^}]*\}/gs, ' ');
        const context = foregrounds(staticText);
        inspect(file, line, staticText, new Map());
        for (const [, single, double] of value.matchAll(/'([^']*)'|"([^"]*)"/g)) {
          inspect(file, line, `${staticText} ${single ?? double ?? ''}`, context, staticText);
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
