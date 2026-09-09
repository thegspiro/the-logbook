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
 * An alpha channel that leaves the colour fully opaque, or is absent.
 *
 * CSS writes alpha as a number in 0-1 or a percentage, so both spellings are
 * parsed rather than compared against a list of literals.
 */
const opaqueAlpha = (alpha: string | undefined): boolean => {
  if (alpha === undefined) return true;
  const text = alpha.trim();
  if (text === '') return true;
  return text.endsWith('%') ? Number(text.slice(0, -1)) === 100 : Number(text) === 1;
};

/**
 * A Tailwind opacity modifier that leaves the colour fully opaque.
 *
 * The two syntaxes mean different things and that is the trap: a bare `/100` is
 * a **percentage**, while a bracketed `/[…]` is the **alpha channel itself** —
 * `/[100%]` and `/[1]` are opaque, `/[.06]` is 6%. Both are compiled to the
 * same `background-color` as the bare utility when they resolve to 1, so a
 * check that admitted only the literal `/100` let the banned fill through with
 * six characters appended instead of four. Resolving the number is what stops
 * this being fixed once per spelling, which is how `/100` itself got here.
 */
const opaqueModifier = (modifier: string | undefined): boolean => fillOpacity(modifier) === 'opaque';

/**
 * A class token split into its colour value and its opacity modifier.
 *
 * The modifier is whatever follows the closing bracket, not whatever follows
 * the first slash: an arbitrary value can contain one of its own
 * (`bg-[rgb(0_0_0/1)]`), and splitting on the first slash cut that colour in
 * half and read `1)]` as the opacity.
 */
const splitModifier = (raw: string): { value: string; modifier: string | undefined } => {
  const closing = raw.startsWith('[') ? raw.indexOf(']') : -1;
  const slash = raw.indexOf('/', closing === -1 ? 0 : closing + 1);
  return slash === -1
    ? { value: raw, modifier: undefined }
    : { value: raw.slice(0, slash), modifier: raw.slice(slash + 1) };
};

/**
 * The optional opacity modifier, as a capturing regex fragment.
 *
 * Written once and shared by every fill pattern in this file. It used to be a
 * literal `(?:\/100)?` repeated at four sites, and correcting it meant
 * correcting it four times — which is exactly the drift this fragment exists
 * to prevent. A match that captures a modifier is then filtered through
 * `opaqueModifier`, so the regex no longer has to encode which spellings mean
 * "fully opaque".
 */
const OPACITY_MODIFIER = String.raw`(?:\/(\[[^\]\s]*\]|[\d.]+))?`;

/**
 * A Tailwind opacity modifier as an alpha in 0-1; absent means fully opaque.
 *
 * Same two syntaxes `opaqueModifier` distinguishes: a bare `/80` is a
 * percentage, a bracketed one is the alpha channel itself.
 */
const modifierOpacity = (modifier: string | undefined): { kind: 'alpha'; alpha: number } | { kind: 'unresolvable' } => {
  if (modifier === undefined || modifier === '') return { kind: 'alpha', alpha: 1 };
  const raw = modifier.startsWith('[') ? modifier.slice(1, modifier.endsWith(']') ? -1 : undefined).trim() : modifier;
  // A bracketed modifier is the alpha channel itself; a bare one is a
  // percentage. `[13%]` is 13% either way, `[.06]` is 6%, `/50` is 50%.
  const alpha = modifier.startsWith('[')
    ? raw.endsWith('%')
      ? Number(raw.slice(0, -1)) / 100
      : Number(raw)
    : Number(raw) / 100;
  // A modifier this sweep cannot evaluate — `/[var(--opacity)]`, or anything
  // else nonnumeric — is reported, never substituted. Falling back to 1
  // measured a variable-controlled label as fully opaque, so
  // `text-white/[var(--opacity)]` on black passed at 21:1 while the value it
  // resolves to can make the label invisible.
  return Number.isFinite(alpha) ? { kind: 'alpha', alpha } : { kind: 'unresolvable' };
};

/** A fill's opacity modifier, as the three outcomes a sweep must tell apart. */
const fillOpacity = (modifier: string | undefined): 'opaque' | 'translucent' | 'unresolvable' => {
  const opacity = modifierOpacity(modifier);
  if (opacity.kind === 'unresolvable') return 'unresolvable';
  return opacity.alpha === 1 ? 'opaque' : 'translucent';
};

/**
 * `text-white`'s alpha at this call site, or null when the foreground is not
 * white.
 *
 * The foreground carries an opacity modifier as readily as the fill does, and
 * the pattern used to stop at the word boundary before it — so `text-white/0`
 * recorded as opaque white, measured 21:1 against black, and passed while
 * Tailwind painted nothing at all. Alpha is returned rather than the
 * foreground being rejected outright, because it can be composited exactly:
 * the backdrop is the fill being measured, so there is nothing left to guess.
 */
type WhiteLabel = { kind: 'white'; alpha: number } | { kind: 'unresolvable' } | { kind: 'other' };

/** Is this foreground token pure white, however it is spelled? */
const isWhite = (value: string): boolean => {
  const fill = resolveFill(value);
  return fill.kind === 'colour' && fill.rgb.r === 255 && fill.rgb.g === 255 && fill.rgb.b === 255;
};

const whiteLabel = (foreground: string | undefined): WhiteLabel => {
  if (foreground === undefined) return { kind: 'other' };
  const { value, modifier } = splitModifier(foreground);
  // Resolved, not compared by spelling. `text-[#fff]` is the same colour as
  // `text-white` and used to read as a different foreground entirely — the
  // arbitrary-value fix from two rounds ago had been applied to fills only,
  // which is the asymmetry this review keeps finding.
  if (!isWhite(value)) {
    // An arbitrary foreground this sweep cannot resolve has already passed
    // `namesColour`, so it is a colour of some kind; whether it is white is
    // exactly what cannot be decided, and guessing "not white" skips the
    // pairing.
    return value.startsWith('[') && resolveFill(value).kind === 'unresolvable'
      ? { kind: 'unresolvable' }
      : { kind: 'other' };
  }
  const opacity = modifierOpacity(modifier);
  return opacity.kind === 'unresolvable' ? { kind: 'unresolvable' } : { kind: 'white', alpha: opacity.alpha };
};

/** A translucent foreground composited over the fill it sits on. */
const composite = (
  foreground: { r: number; g: number; b: number },
  background: { r: number; g: number; b: number },
  alpha: number
): { r: number; g: number; b: number } => ({
  r: alpha * foreground.r + (1 - alpha) * background.r,
  g: alpha * foreground.g + (1 - alpha) * background.g,
  b: alpha * foreground.b + (1 - alpha) * background.b,
});

/** The contrast of a possibly translucent white label on a fill. */
const whiteRatioOn = (rgb: { r: number; g: number; b: number }, alpha: number): number => {
  const label = composite({ r: 255, g: 255, b: 255 }, rgb, alpha);
  return contrastRatio(relativeLuminance(rgb.r, rgb.g, rgb.b), relativeLuminance(label.r, label.g, label.b));
};

/**
 * Every `text-*` token with its variant prefix and opacity modifier, so a
 * foreground can be resolved for the variant that actually paints it.
 */
const TEXT_PATTERN =
  String.raw`\b((?:[a-z0-9-]+:)*)text-(\[[^\]\s]*\]|[a-z]+(?:-[a-z0-9]+)*)` + OPACITY_MODIFIER + String.raw`(?![\w-])`;

/**
 * A `bg-red-600` with its opacity modifier, if it has one. The `/`-suffixed
 * tints are a different pattern and pass; a modifier that resolves to fully
 * opaque is the banned fill itself, and `opaqueModifier` decides which is
 * which. Matching the modifier rather than one literal spelling of it is what
 * closes `bg-red-600/[100%]`, which compiles to the identical
 * `background-color` and used to pass.
 */
const RED_600_FILL = String.raw`\bbg-red-600` + OPACITY_MODIFIER + String.raw`(?![\w-])(?!/)`;

/** A CSS colour channel, clamped to the sRGB gamut exactly as a browser does. */
const clampChannel = (raw: string | undefined): number => Math.max(0, Math.min(255, Number(raw)));

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
 * Every shared `@utility` body in the stylesheet, by name.
 *
 * Module scope because **both** sweeps need them. The stylesheet pass expands a
 * composed utility before measuring it; the call-site pass needs the same
 * bodies to know what foreground a utility named in a `className` supplies.
 */
const UTILITY_BODIES = new Map<string, string>(
  [...INDEX_CSS.matchAll(/@utility\s+([\w-]+)\s*\{(.*?)\n\}/gs)].map(([, name, body]) => [name ?? '', body ?? ''])
);

/**
 * A utility body with any composed custom utilities inlined.
 *
 * `@utility card-hover { @apply card; … }` is an established pattern here, and
 * a composed utility inherits the foreground of what it applies — so
 * `@apply btn-primary bg-orange-600` renders white on orange while its own body
 * contains no literal `text-white`.
 *
 * Each dependency is inlined **at its own token position**, not appended.
 * Tailwind emits an `@apply`ed utility's declarations where the token sits, so
 * a composing utility that overrides an inherited foreground renders the
 * override; appending reversed that order and answered with the foreground the
 * composition had just replaced.
 */
const expandUtility = (name: string, seen = new Set<string>()): string => {
  if (seen.has(name)) return '';
  seen.add(name);
  const body = UTILITY_BODIES.get(name) ?? '';
  return body.replace(/(^|\s)([a-z][\w-]*)/g, (whole: string, lead: string, token: string) =>
    UTILITY_BODIES.has(token) ? `${lead}${expandUtility(token, seen)}` : whole
  );
};

/**
 * The `text-*` tokens the shared utilities named in a class string contribute.
 *
 * A call site that writes `btn-primary bg-orange-600` overrides the utility's
 * red fill while `btn-primary` keeps supplying `text-white`, so the pairing
 * that renders is white on orange-600 at 3.60:1 — and the call-site sweep,
 * reading only literal `text-*` tokens, saw no foreground at all and skipped
 * it. The stylesheet pass cannot see it either: the fill is not in the
 * stylesheet.
 *
 * Only the foregrounds are borrowed, never the fills. Injecting a utility's own
 * fills would re-measure every `card` in the app against `bg-theme-surface` —
 * a translucent token this sweep reports as unmeasurable — turning one real
 * finding into a report at every call site that uses the app's most common
 * container.
 */
const utilityTokens = (text: string, pattern: string): string =>
  [...text.matchAll(/(?:^|\s)([a-z][\w-]*)/g)]
    .map(([, token]) => token ?? '')
    .filter((token) => UTILITY_BODIES.has(token))
    .flatMap((token) => [...expandUtility(token).matchAll(new RegExp(pattern, 'g'))].map(([whole]) => whole))
    .join(' ');

const utilityForegroundText = (text: string): string => utilityTokens(text, TEXT_PATTERN);

/**
 * The fill tokens the shared utilities named in a class string contribute.
 *
 * Borrowed **only** when the call site supplies the white label itself, and
 * that condition is the whole design. `card text-white` renders white on
 * `bg-theme-surface`, which is very nearly white in the light theme — invisible
 * — and neither pass could see it: the stylesheet pass skips `card` because its
 * own body has no white text, and the call-site pass saw no fill. Borrowing
 * fills unconditionally would instead report every `card` in the app against a
 * translucent token, so the qualifying foreground is what makes this safe as
 * well as what makes it necessary.
 */
const utilityFillText = (text: string): string =>
  `${utilityTokens(text, FILL_PATTERN)} ${utilityTokens(text, SEMANTIC_FILL_PATTERN)}`;

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

/** HSL -> sRGB, per the CSS Color specification's conversion. */
const hslToRgb = (hDegrees: number, s: number, l: number): { r: number; g: number; b: number } => {
  const h = ((hDegrees % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[Math.floor(h / 60) % 6] ?? [0, 0, 0];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
};

/**
 * A CSS colour written by hand, resolved to RGB.
 *
 * Only the opaque forms resolve. A translucent one composites over whatever is
 * beneath it and so has no single value to measure, which is the same reason
 * `bg-red-600/20` is excluded everywhere else in this file. Tailwind writes
 * spaces in an arbitrary value as underscores, so those are restored first.
 */
const cssColour = (text: string): { r: number; g: number; b: number } | null => {
  const value = text.trim().replace(/_/g, ' ');

  const hex = hexToRgb(value);
  if (hex) return hex;

  // A CSS colour keyword. Tailwind's own theme defines `white` and `black`, so
  // they are read from the installed palette rather than hard-coded; any other
  // keyword falls through and is reported as unresolvable rather than skipped.
  const keyword = PALETTE[value.toLowerCase()];
  if (keyword) return keyword;

  // Tailwind's own palette is authored with a percentage lightness; a
  // hand-written arbitrary value may use the 0-1 form instead. The alpha is
  // parsed rather than ignored: a prefix-only match read `oklch(0 0 0/0)` as
  // opaque black, so a fully transparent fill measured 21:1 against white and
  // passed, while what the text actually crosses is whatever is beneath it.
  const oklch = /^oklch\(\s*([\d.]+)(%?)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(value);
  if (oklch) {
    if (!opaqueAlpha(oklch[5])) return null;
    const lightness = Number(oklch[1]);
    return oklchToRgb(oklch[2] ? lightness / 100 : lightness, Number(oklch[3]), Number(oklch[4]));
  }

  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(value);
  if (rgb) {
    if (!opaqueAlpha(rgb[4])) return null;
    // CSS clamps an out-of-range channel to the sRGB gamut, so `rgb(999 999
    // 999)` paints white. Passing 999 through to the luminance formula
    // computed a colour no browser shows and measured white-on-white as
    // passing.
    return { r: clampChannel(rgb[1]), g: clampChannel(rgb[2]), b: clampChannel(rgb[3]) };
  }

  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(value);
  if (hsl) {
    if (!opaqueAlpha(hsl[4])) return null;
    return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }

  return null;
};

/**
 * What a fill token actually paints.
 *
 * Three outcomes, and keeping them apart is the whole point. `not-a-colour` is
 * a token in the `bg-` namespace that sets something else entirely —
 * `bg-[length:200px_100px]` compiles to background-size — and measuring it
 * would report a failure against a colour that does not exist. `unresolvable`
 * names a colour this sweep cannot compute (`bg-[var(--brand)]`, or a shade
 * absent from the installed palette); those are reported rather than skipped,
 * because silence on a fill nothing can clear reads as a pass.
 *
 * Arbitrary values are resolved here rather than being ignored: `bg-[#ffffff]
 * text-white` is invisible text, and until this existed neither the call-site
 * sweep, the standalone-literal prefilter nor the shared-utility pass matched
 * an arbitrary fill at all — the one escape hatch from the whole file was
 * spelling the colour out.
 */
type FillColour =
  { kind: 'colour'; rgb: { r: number; g: number; b: number } } | { kind: 'unresolvable' } | { kind: 'not-a-colour' };

const resolveFill = (key: string): FillColour => {
  if (key.startsWith('[')) {
    const inner = key.slice(1, key.endsWith(']') ? -1 : undefined);
    const typed = /^([a-z-]+):([\s\S]*)$/i.exec(inner);
    if (typed) {
      // Tailwind's bracket syntax carries size, position, image and angle
      // besides colour, and only the colour hint names one.
      if ((typed[1] ?? '').toLowerCase() !== 'color') return { kind: 'not-a-colour' };
      const rgb = cssColour(typed[2] ?? '');
      return rgb ? { kind: 'colour', rgb } : { kind: 'unresolvable' };
    }
    const rgb = cssColour(inner);
    if (rgb) return { kind: 'colour', rgb };
    // An untyped bracket that did not parse. Anything colour-shaped is still a
    // colour and must be reported — including the functions above, which reach
    // here when their alpha makes them unmeasurable rather than because the
    // syntax was unrecognised. Listing only the *unimplemented* functions put
    // `oklch(0 0 0/0)` in the `not-a-colour` bucket and silently skipped it.
    // A `url(...)` or a bare length is not a fill and must not be reported.
    // A bare identifier is a colour keyword: `bg-[white]` compiles to
    // `background-color: white`, and `cssColour` resolves the two Tailwind
    // defines. An unrecognised one is reported rather than skipped, which does
    // mean `bg-[cover]` would be reported — deliberately, since the spelling
    // for that is `bg-cover`, and a false report is something a reader can
    // correct while a silent skip is what let `bg-[white] text-white` through.
    const bare = /^[a-z]+$/i.test(inner.trim());
    // A gradient is not a colour, but it *is* what the label crosses, so it
    // belongs with the unresolvable colours rather than with background-size.
    // Tailwind's own `from-`/`to-` gradients are already swept stop by stop;
    // an arbitrary one is the same thing spelled differently, and classifying
    // it `not-a-colour` skipped `bg-[linear-gradient(white,white)] text-white`
    // in silence. A `url(...)` image stays out: it is raster content no source
    // sweep can measure, and the app uses those deliberately.
    const gradient = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(inner.trim());
    return bare ||
      gradient ||
      /^(?:#|var\(|color-mix\(|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i.test(inner.trim())
      ? { kind: 'unresolvable' }
      : { kind: 'not-a-colour' };
  }
  const rgb = PALETTE[key];
  return rgb ? { kind: 'colour', rgb } : { kind: 'unresolvable' };
};

/**
 * Does a `text-*` token name a colour at all?
 *
 * `text-sm`, `text-center` and `text-balance` live in the same namespace and
 * set size, alignment and wrapping. Recording one as a foreground is not
 * harmless: the map is last-write-wins per variant, so `text-white text-sm`
 * ended with `sm`, read as "not white", and skipped the pairing — a `text-sm`
 * appended after the colour silently switched the guard off for that element.
 *
 * Asked by resolving the token rather than by listing the typography
 * utilities, for the same reason `setsColour` is: the set of non-colour
 * `text-*` utilities is open-ended and grows with Tailwind, while the set of
 * colours is something this file can already answer.
 */
const namesColour = (value: string): boolean => {
  if (value.startsWith('[')) return resolveFill(value).kind !== 'not-a-colour';
  if (value.startsWith('theme-')) return semanticFill(value).size > 0;
  return value === 'transparent' || PALETTE[value] !== undefined;
};

/**
 * The measured contrast of a white label on a fill, or null when the fill does
 * not resolve. `alpha` is the label's own opacity, composited over the fill.
 */
const whiteOn = (key: string, alpha = 1): number | null => {
  const fill = resolveFill(key);
  if (fill.kind !== 'colour') return null;
  return whiteRatioOn(fill.rgb, alpha);
};

/**
 * A fill's variant prefix, then every less specific prefix it falls back to,
 * longest first: `dark:hover:` -> `dark:hover:`, `dark:`, `hover:`, ``.
 */
/**
 * A variant prefix with its variants in a canonical order, so `dark:hover:` and
 * `hover:dark:` are one key rather than two.
 *
 * Tailwind accepts either spelling and compiles them to the same rule, and
 * `themesFor` already searched both orders when looking for a *fill* override —
 * but the foreground lookup did not, so `hover:bg-theme-text-muted
 * hover:text-black hover:dark:text-white` asked for `dark:hover:`, missed it,
 * fell back to `hover:text-black`, and skipped a pairing that renders white on
 * the token's white dark-mode value. Sorting is what stops this needing a
 * both-orders check at every site that grows one.
 */
const canonicalPrefix = (prefix: string): string => {
  const variants = prefix.split(':').filter(Boolean).sort();
  return variants.length ? `${variants.join(':')}:` : '';
};

const candidatePrefixes = (prefix: string): string[] => {
  const variants = prefix.split(':').filter(Boolean);
  const subsets: string[][] = [[]];
  for (const variant of variants) {
    for (const subset of [...subsets]) subsets.push([...subset, variant]);
  }
  return subsets
    .sort((a, b) => b.length - a.length)
    .map((subset) => canonicalPrefix(subset.length ? `${subset.join(':')}:` : ''));
};

/**
 * The variant prefix each theme paints its foreground through.
 *
 * `dark:` is the app's only theme variant (`@custom-variant dark (&:is(.dark
 * *))`), and `ThemeContext` puts the `.dark` class on the high-contrast theme
 * too, so a `dark:` foreground covers both of those and never light.
 */
const THEME_VARIANT: Record<string, string> = {
  light: '',
  dark: 'dark:',
  'high-contrast': 'dark:',
};

/** Does a `dark:` sibling of this token actually set a colour? */
const setsColour = (raw: string, word: string): boolean => {
  const { value, modifier } = splitModifier(raw);
  // A translucent replacement composites over what is beneath rather than
  // replacing it; a modifier that resolves to fully opaque is the colour itself.
  if (!opaqueModifier(modifier)) return false;
  if (value === 'none') return false;
  // `transparent` sets no colour on a flat background, but on a gradient stop
  // it does replace: what shows is whatever backs it.
  if (value === 'transparent') return word !== 'bg';
  if (value.startsWith('[')) return resolveFill(value).kind !== 'not-a-colour';
  if (value.startsWith('theme-')) return semanticFill(value).size > 0;
  return PALETTE[value] !== undefined;
};

/**
 * The themes a fill is actually painted in.
 *
 * A `dark:`-prefixed fill renders in dark and high-contrast and never in light,
 * so measuring it against the light value reports a failure for a colour that
 * theme never shows. The mirror case is an unprefixed fill that a `dark:`
 * sibling overrides: it renders only in light.
 *
 * That second question is stated as an exclusion rather than a list of accepted
 * shapes, and the inversion is the point. It was fixed three times by
 * enumeration — first semantic tokens, then numeric shades, then keyword
 * colours — and each round missed the next form and reported a *false* failure
 * against a colour dark mode never paints. The question is not which spellings
 * of a colour exist; it is whether the sibling establishes an opaque one, which
 * `setsColour` answers by resolving the candidate rather than by its shape.
 *
 * Asked semantically for a second reason too: "looks opaque" was once too
 * generous, accepting anything in the `bg-` namespace, and `bg-cover` sets
 * background-size — so `bg-theme-text-muted dark:bg-cover text-white` was
 * excused from dark entirely while still painting white on white.
 *
 * The capture class admits `:` so a typed arbitrary override
 * (`dark:bg-[color:#000000]`) arrives whole; stopping at the colon handed
 * `setsColour` the fragment `[color` and rejected a perfectly valid override.
 */
const themesFor = (haystack: string, matchPrefix: string, word: string): string[] => {
  if (/(^|:)dark:/.test(matchPrefix)) return ['dark', 'high-contrast'];
  const state = matchPrefix.replace(/(^|:)dark:/g, '$1');
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const overridden = [`dark:${state}${word}-`, `${state}dark:${word}-`].some((prefix) =>
    [...haystack.matchAll(new RegExp(String.raw`\b${escape(prefix)}([A-Za-z0-9[\]#.,%():_/-]+)`, 'g'))].some(
      ([, raw]) => setsColour(raw ?? '', word)
    )
  );
  return overridden ? ['light'] : ['light', 'dark', 'high-contrast'];
};

/**
 * Every fill token in a chunk of class text: `bg-` and the three gradient
 * stops, numbered shades, the two keyword colours and arbitrary values alike.
 *
 * The trailing `(?![\w-])` replaces a `\b`, which could not follow the `]` of
 * an arbitrary value without demanding a word character after it. The opacity
 * modifier is captured rather than matched literally: Tailwind emits a fully
 * opaque one as the same colour as the bare utility, so rejecting every
 * modifier let the identical broken pairing through with a few characters
 * appended, and admitting only `/100` let it through with `/[100%]`. Callers
 * pass the capture to `opaqueModifier`; anything translucent has no single
 * value to measure and is skipped.
 */
const FILL_PATTERN =
  String.raw`\b((?:[a-z0-9-]+:)*)(bg|from|via|to)-(\[[^\]\s]*\]|[a-z]+-\d{2,3}|white|black)` +
  OPACITY_MODIFIER +
  String.raw`(?![\w-])(?!/)`;

/**
 * A semantic fill or stop (`bg-theme-accent-blue`) with the same modifier
 * handling. The trailing `(?![\w-])` rejects a class name built by
 * interpolation: a surface utility with an interpolated suffix would otherwise
 * capture with a dangling hyphen and report twenty "resolves to no theme value"
 * findings for classes Tailwind never generates, since it needs whole class
 * names at build time.
 */
const SEMANTIC_FILL_PATTERN =
  String.raw`\b((?:[a-z0-9-]+:)*)(bg|from|via|to)-(theme-[a-z]+(?:-[a-z]+)*)` +
  OPACITY_MODIFIER +
  String.raw`(?![\w-])(?!/)`;

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
      // An unresolvable modifier counts: `bg-red-600/[var(--o)]` is a red-600
      // fill whose opacity this sweep cannot evaluate, and treating it as a
      // tint would be the ban's own escape hatch.
      const bannedRed = [...line.matchAll(new RegExp(RED_600_FILL, 'g'))].some(
        ([, modifier]) => fillOpacity(modifier) !== 'translucent'
      );
      if (!bannedRed) return;
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
    const failures = [...UTILITY_BODIES.keys()].flatMap((name) => {
      const body = expandUtility(name);
      if (!body.includes('text-white')) return [];

      // Which foreground covers a fill, by variant — the same question the
      // call-site sweep asks. A body-wide `text-white` test paired white with
      // every fill regardless of variant, so an adaptive utility
      // (`bg-orange-600 text-orange-950 dark:bg-black dark:text-white`) was
      // reported at 3.60:1 for a pairing that never renders. Both halves of
      // such a utility are correct; only the cross-pairing is not.
      const utilityForegrounds = new Map<string, string>();
      for (const [, variant, colour, modifier] of body.matchAll(new RegExp(TEXT_PATTERN, 'g'))) {
        if (!namesColour(colour ?? '')) continue;
        utilityForegrounds.set(canonicalPrefix(variant ?? ''), modifier ? `${colour}/${modifier}` : (colour ?? ''));
      }
      const coveringForeground = (variant: string): string | undefined =>
        candidatePrefixes(variant)
          .map((candidate) => utilityForegrounds.get(candidate))
          .find((found) => found !== undefined);

      /**
       * The foreground a given theme paints over a fill.
       *
       * Resolved per theme, exactly as the call-site sweep does, and that is
       * the whole of it: `@apply bg-theme-text-muted text-black dark:text-white`
       * paints white on `--text-muted`, which is `#ffffff` in dark — and asking
       * only the unprefixed variant answered `text-black` and excused the
       * utility. A body that adapts its foreground per theme is exactly the
       * shape a shared utility is most likely to have, so resolving it once was
       * wrong in the most likely case rather than an edge one.
       */
      const themeForeground = (variant: string, theme: string): string | undefined =>
        coveringForeground(`${/(^|:)dark:/.test(variant) ? '' : (THEME_VARIANT[theme] ?? '')}${variant}`);

      // All four fill prefixes, and arbitrary values and keyword colours
      // alongside numbered shades. A gradient defined in a shared utility never
      // writes its stops at the TSX call site, so the call-site sweep cannot
      // see them and only this pass can — and the repository's own convention
      // prefers these utilities over repeated inline classes, which makes it
      // the more likely home for one, not the less.
      //
      // A palette colour does not change between themes, but the foreground
      // over it does, so the pairing is still asked per theme: a body writing
      // `bg-slate-600 text-slate-100 dark:text-white` is white-on-slate-600
      // (4.40:1) in dark only, and resolving the foreground once missed it.
      const palette = [...body.matchAll(new RegExp(FILL_PATTERN, 'g'))].flatMap(
        ([, variant, prefix, key, modifier]) => {
          const opacity = fillOpacity(modifier);
          if (opacity === 'translucent') return [];
          if (opacity === 'unresolvable') {
            return [`${name}: ${prefix}-${key} has an opacity this sweep cannot resolve`];
          }
          const themes = themesFor(body, variant ?? '', prefix ?? '');
          // The lowest white alpha any theme paints over this fill: a
          // translucent label is composited over it rather than assumed solid.
          const labels = themes.map((theme) => whiteLabel(themeForeground(variant ?? '', theme)));
          if (labels.some((label) => label.kind === 'unresolvable')) {
            return [`${name}: the white label over ${prefix}-${key} has an opacity this sweep cannot resolve`];
          }
          const alphas = labels.flatMap((label) => (label.kind === 'white' ? [label.alpha] : []));
          if (alphas.length === 0) return [];
          const alpha = Math.min(...alphas);
          const fill = resolveFill(key ?? '');
          // Not every token in the `bg-` namespace paints a colour;
          // `bg-[length:200px_100px]` compiles to background-size.
          if (fill.kind === 'not-a-colour') return [];
          const ratio = whiteOn(key ?? '', alpha);
          if (ratio === null) {
            return [
              `${name}: ${prefix}-${key} ${
                (key ?? '').startsWith('[')
                  ? 'is an arbitrary value this sweep cannot resolve to a colour'
                  : 'is not in the installed Tailwind palette'
              }`,
            ];
          }
          return ratio >= 7
            ? []
            : [`${name}: white on ${prefix}-${key} is ${ratio.toFixed(2)}:1, below the 7:1 AAA floor`];
        }
      );

      // Semantic fills and stops, resolved per theme exactly as the call-site
      // sweep does. `--text-muted` is `#ffffff` in dark, so a utility built on
      // it under `text-white` is invisible there — and invisible to every other
      // guard too, since the stops never reach a TSX file.
      const semantic = [...body.matchAll(new RegExp(SEMANTIC_FILL_PATTERN, 'g'))].flatMap(
        ([, variant, prefix, token, modifier]) => {
          const opacity = fillOpacity(modifier);
          if (opacity === 'translucent') return [];
          if (opacity === 'unresolvable') {
            return [`${name}: ${prefix}-${token} has an opacity this sweep cannot resolve`];
          }
          const themes = themesFor(body, variant ?? '', prefix ?? '');
          return [...semanticFill(token ?? '').entries()].flatMap(([theme, value]) => {
            if (!themes.includes(theme)) return [];
            const label = whiteLabel(themeForeground(variant ?? '', theme));
            if (label.kind === 'other') return [];
            if (label.kind === 'unresolvable') {
              return [`${name}: the white label over ${prefix}-${token} has an opacity this sweep cannot resolve`];
            }
            const alpha = label.alpha;
            const rgb = hexToRgb(value);
            if (!rgb) return [`${name}: ${prefix}-${token} is ${value} in ${theme}, unmeasurable`];
            const ratio = whiteRatioOn(rgb, alpha);
            // The same 7:1 AAA floor the numeric branch above applies. This
            // test's contract is that a *shared* utility clears AAA; 4.5:1 is
            // the call-site floor, and using it here let a semantic shared
            // fill regress to merely AA beside a numeric one that could not.
            return ratio >= 7
              ? []
              : [`${name}: white on ${prefix}-${token} is ${ratio.toFixed(2)}:1 in ${theme}, below the 7:1 AAA floor`];
          });
        }
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
    //
    // `bg-` and the three gradient stops together, via the shared FILL_PATTERN.
    // A gradient fill is still a fill — `from-red-600 to-orange-600` under
    // `text-white` is a button, and orange-600 is 3.60:1 — but axe cannot
    // measure one (it abstains with "background gradient") and the `bg-` sweep
    // never looked at it, so this whole class of control was unmeasured on both
    // sides. Every stop is checked, because the worst stop is what the label
    // crosses.
    /**
     * The foreground each variant prefix paints, e.g. `''` -> white, `dark:` ->
     * emerald-950, `''` -> white/80 where the label carries an opacity.
     *
     * Shared utilities named in the same class string contribute their own
     * foregrounds, and they go in **first** so a literal `text-*` at the call
     * site overwrites them — the author's explicit choice wins over the one it
     * inherits. Without this, `btn-primary bg-orange-600` had no foreground at
     * all to the sweep: the utility supplies `text-white`, the call site
     * overrides only the fill, and the 3.60:1 pairing that renders was visible
     * to neither this pass nor the stylesheet pass (the fill is not in the
     * stylesheet).
     */
    const foregrounds = (text: string, sameList = true): Map<string, string> => {
      const found = new Map<string, string>();
      for (const [, variant, colour, modifier] of `${utilityForegroundText(text)} ${text}`.matchAll(
        new RegExp(TEXT_PATTERN, 'g')
      )) {
        if (!namesColour(colour ?? '')) continue;
        const key = canonicalPrefix(variant ?? '');
        const token = modifier ? `${colour}/${modifier}` : (colour ?? '');
        // Two different colours at the same variant: source order does NOT
        // decide the winner. Tailwind emits its utilities in the stylesheet's
        // own order, not the order they appear in a class string, so
        // `text-white text-black` renders white — the map's last-write-wins
        // read it as black and skipped an invisible pairing on `bg-white`.
        // Rather than model Tailwind's sort, take the white one when either
        // side is white: a class string with two conflicting same-variant
        // foregrounds is defective however it resolves, and the reading that
        // reports it is the one worth having.
        //
        // Only within ONE flat class list, though — `sameList`. A branch and
        // the static text it sits inside are not co-active in this sense: the
        // branch's `text-theme-text-primary` deliberately overrides a
        // `text-white` in the shared part, which is a pattern the app uses and
        // not a conflict at all. Applying the preference there reported
        // `FloatingActionButton` and `EmailPlatformChoice`, both correct.
        const existing = found.get(key);
        if (sameList && existing !== undefined && existing !== token && isWhite(splitModifier(existing).value)) {
          continue;
        }
        found.set(key, token);
      }
      return found;
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
      const own = foregrounds(segment, inheritedContext === '');
      // The fills a shared utility named here contributes, admitted only when
      // a white label covers them. The reported class name is the utility's
      // own (`bg-theme-surface`, not `card`); the file and line locate the call
      // site, and the class string names the utility that brought it.
      const borrowed = [...own.values()].some((value) => isWhite(splitModifier(value).value))
        ? utilityFillText(segment)
        : '';
      const fillText = `${segment} ${borrowed}`;
      for (const [whole, variant, , key, modifier] of fillText.matchAll(new RegExp(FILL_PATTERN, 'g'))) {
        const opacity = fillOpacity(modifier);
        if (opacity === 'translucent') continue;
        if (opacity === 'unresolvable') {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${whole} has an opacity this sweep cannot resolve`);
          continue;
        }
        const prefix = variant ?? '';
        // The foreground that covers this fill, most specific first. A
        // `dark:hover:` fill is covered by `dark:hover:text-*` if present, then
        // by `dark:text-*` — not by the `text-white` sitting beside it for the
        // light theme, which is a pairing that never renders.
        const fg = candidatePrefixes(prefix)
          .flatMap((candidate) => [own.get(candidate), inherited.get(candidate)])
          .find((value) => value !== undefined);
        // A translucent white label is composited over this fill rather than
        // assumed solid: `text-white/0` painted nothing and measured 21:1.
        const label = whiteLabel(fg);
        if (label.kind === 'other') continue;
        if (label.kind === 'unresolvable') {
          offenders.push(
            `${path.relative(SRC, file)}:${line} — ${fg} on ${whole} has an opacity this sweep cannot resolve`
          );
          continue;
        }
        const alpha = label.alpha;
        const fill = resolveFill(key ?? '');
        // A token in the `bg-` namespace that paints no colour is not a fill:
        // `bg-[length:200px_100px]` compiles to background-size, and reporting
        // it would be a complaint about a colour that does not exist.
        if (fill.kind === 'not-a-colour') continue;
        const ratio = whiteOn(key ?? '', alpha);
        if (ratio === null) {
          offenders.push(
            `${path.relative(SRC, file)}:${line} — ${whole} ${
              (key ?? '').startsWith('[')
                ? 'is an arbitrary value this sweep cannot resolve to a colour'
                : 'is not in the installed Tailwind palette'
            }`
          );
          continue;
        }
        if (ratio < 4.5) {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${prefix}${fg} on ${whole} is ${ratio.toFixed(2)}:1`);
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
      // Which themes a stop renders in is decided by the shared `themesFor`,
      // over this segment plus the static text it is a branch of: a `dark:`
      // sibling out there overrides an unprefixed fill in every branch.

      for (const [whole, variant, fill, token, modifier] of fillText.matchAll(new RegExp(SEMANTIC_FILL_PATTERN, 'g'))) {
        const opacity = fillOpacity(modifier);
        if (opacity === 'translucent') continue;
        if (opacity === 'unresolvable') {
          offenders.push(`${path.relative(SRC, file)}:${line} — ${whole} has an opacity this sweep cannot resolve`);
          continue;
        }
        const prefix = variant ?? '';
        const themes = themesFor(`${segment} ${inheritedContext}`, prefix, fill ?? '');
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
          const label = whiteLabel(fg);
          if (label.kind === 'other') continue;
          if (label.kind === 'unresolvable') {
            offenders.push(
              `${path.relative(SRC, file)}:${line} — ${fg} on ${fill}-${token} has an opacity this sweep cannot resolve`
            );
            continue;
          }
          const alpha = label.alpha;

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
          const themeRatio = whiteRatioOn(rgb, alpha);
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
        // by nothing, numeric stops and all. Arbitrary values were the third
        // instance of it: once `inspect` learned to resolve them, a prefilter
        // that still admitted only named shades kept every hoisted one out.
        // All three gaps are the same mistake: the prefilter has to admit
        // whatever the passes below can measure, so it is kept deliberately
        // looser than they are rather than mirroring their patterns.
        if (!/\b(?:bg|from|via|to)-(?:\[[^\]\s]*\]|[a-z]+-\d{2,3}|theme-[a-z]+(?:-[a-z]+)*|white|black)/.test(value))
          continue;
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
