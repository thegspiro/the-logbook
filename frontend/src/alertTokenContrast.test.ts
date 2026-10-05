/**
 * Alert token contrast
 *
 * The five alert families in `index.css` each define `-bg`, `-border`,
 * `-icon`, `-title` and `-text`. Four of the five light-theme `-text` tokens
 * sat on the 700 shade and measured AA-only against their own background:
 * info 6.16:1, purple 6.51:1, danger 5.91:1, and success **4.79:1** — barely
 * over the 4.5:1 AA floor for normal text, on a palette the rest of which was
 * raised to AAA on 2026-08-23.
 *
 * `--alert-warning-text` was the exception, and it is where the rule came
 * from: it alone sits on its family's **900** shade, and it alone measured AAA
 * (8.75:1), with the ratio written into its comment. The other four were not
 * following a different convention, they had simply never been moved. So the
 * fix completed the pattern the file already contained rather than inventing
 * one, and this test is what keeps the next family from being added at 700.
 *
 * The failure mode is the usual one for contrast: nothing about
 * `text-theme-alert-info-text` says which blue it got, the box looks fine on a
 * bright desk monitor, and it goes unreadable on a phone held outdoors — which
 * is where an officer reads a low-stock alert. Review discipline alone does not
 * hold this. The `window.confirm` ban survived 58 call sites on review and
 * regressed anyway, because unlike every other invariant in CLAUDE.md it had no
 * machine check behind it.
 *
 * ## Scope: the light theme, and why only that
 *
 * Light-theme alert backgrounds are opaque hex, so a token's ratio against its
 * own background is the ratio a browser paints and can be asserted here.
 *
 * Dark and high-contrast backgrounds are not. They are `rgba()` tints that
 * composite over the 6%-white card surface, which itself composites over a
 * three-stop page gradient — so the real ratio depends on where on the
 * gradient the alert happens to sit, which a file read cannot know. Measured
 * against the gradient's lightest stop (`#7f1d1d`, the worst case for light
 * text) the dark tokens come out 5.99:1 (info), 6.88:1 (success) and 6.06:1
 * (warning): AA, deliberately not AAA. That matches the standing decision
 * recorded in CLAUDE.md — no tint of grey clears 7:1 against a 6% surface on
 * this gradient, so dark-mode hierarchy comes from size and weight rather than
 * colour. Raising them is a palette decision, not a defect, and is not this
 * test's business. High contrast measures 13.55–17.40:1 throughout.
 *
 * `mobile-accessibility.spec.ts` covers what this cannot: it runs axe against
 * rendered pages in all three themes, where a composited ancestor background
 * is simply there to read. Its per-route `AAA_CONTRAST_BUDGET` is a ceiling
 * (`aaaCount > aaaBudget`), so the budgets now carry slack that could be
 * tightened once someone re-runs that spec and reads the new counts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contrastRatio, hexToRgb, relativeLuminance } from './utils/colorContrast';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const INDEX_CSS = fs.readFileSync(path.join(SRC, 'styles', 'index.css'), 'utf8');

/** WCAG AAA for normal text. */
const AAA = 7;

/**
 * The `:root` block's custom properties.
 *
 * Nested at-rules are stripped before the properties are read so a
 * `@media`-scoped override inside `:root` cannot be mistaken for a base value.
 */
const lightThemeTokens = (): Map<string, string> => {
  const values = new Map<string, string>();
  for (const match of INDEX_CSS.matchAll(/(?:^|\n):root\s*\{/g)) {
    const bodyStart = INDEX_CSS.indexOf('{', match.index ?? 0);
    let depth = 0;
    let end = INDEX_CSS.length;
    for (let i = bodyStart; i < INDEX_CSS.length; i++) {
      if (INDEX_CSS[i] === '{') depth++;
      else if (INDEX_CSS[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    let body = INDEX_CSS.slice(bodyStart + 1, end);
    let previous: string;
    do {
      previous = body;
      body = body.replace(/@[\w-]+[^{}]*\{[^{}]*\}/g, ' ');
    } while (body !== previous);
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      values.set(name ?? '', (value ?? '').trim());
    }
  }
  return values;
};

const TOKENS = lightThemeTokens();

/**
 * Families discovered from the stylesheet, not listed here.
 *
 * A sixth family added tomorrow is measured on the day it is added rather than
 * silently skipped — the specific thing `primaryFillContrast.test.ts` learned
 * to do after a shade-by-name ban missed six call sites.
 */
const FAMILIES = [
  ...new Set(
    [...TOKENS.keys()]
      .map((name) => /^--alert-([a-z]+)-bg$/.exec(name)?.[1])
      .filter((family): family is string => Boolean(family))
  ),
].sort();

/** Strip the trailing comment a token value may carry. */
const hexOf = (raw: string | undefined): string | undefined => {
  const match = /^(#[0-9a-fA-F]{3,8})\b/.exec((raw ?? '').trim());
  return match?.[1];
};

/**
 * The token's opaque hex, or a thrown error naming it.
 *
 * Throwing rather than returning undefined is the point: a token that moves to
 * `oklch()`, to a `var()` reference or to an `rgba()` tint needs a human to
 * re-measure it against whatever it now composites over, and an assertion that
 * quietly skipped an unreadable value would report that as a pass.
 */
const requireHex = (token: string): string => {
  const hex = hexOf(TOKENS.get(token));
  if (!hex) {
    throw new Error(
      `${token} is ${TOKENS.has(token) ? `${TOKENS.get(token) ?? ''} — not an opaque hex` : 'not defined in :root'}. ` +
        `This test can only measure opaque values; re-measure it by hand and widen the test if the token is now composited.`
    );
  }
  return hex;
};

const ratioOn = (foreground: string, background: string): number => {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (!fg || !bg) throw new Error(`unparseable colour pair: ${foreground} on ${background}`);
  return contrastRatio(relativeLuminance(fg.r, fg.g, fg.b), relativeLuminance(bg.r, bg.g, bg.b));
};

describe('light-theme alert tokens', () => {
  it('discovers every family defined in the stylesheet', () => {
    // Guards against the parse silently returning nothing, which would make
    // every assertion below pass vacuously.
    expect(FAMILIES).toEqual(['danger', 'info', 'purple', 'success', 'warning']);
  });

  it.each(FAMILIES)('%s: the body text clears AAA on its own background', (family) => {
    const background = requireHex(`--alert-${family}-bg`);
    const text = requireHex(`--alert-${family}-text`);

    const ratio = ratioOn(text, background);
    expect(
      ratio,
      `--alert-${family}-text (${text}) measures ${ratio.toFixed(2)}:1 on ` +
        `${background}, below the ${AAA}:1 AAA floor. Move it to the family's ` +
        `900 shade, as --alert-warning-text already is, and record the measured ratio ` +
        `in its comment.`
    ).toBeGreaterThanOrEqual(AAA);
  });

  it.each(FAMILIES)('%s: the title clears at least AA on its own background', (family) => {
    const background = requireHex(`--alert-${family}-bg`);
    const title = requireHex(`--alert-${family}-title`);

    // AA rather than AAA, deliberately. The titles sit on the 800 shade, where
    // green (6.81:1) and amber (6.84:1) miss AAA by a hair and the other three
    // clear it. Moving those two to 900 would collide with the `-text` token
    // the fix above just put there, erasing a distinction the stylesheet draws
    // on purpose — so the two AA titles are a known, measured residual rather
    // than something to assert away. Raising this bar is a palette decision.
    const ratio = ratioOn(title, background);
    expect(
      ratio,
      `--alert-${family}-title (${title}) measures ${ratio.toFixed(2)}:1 on ` +
        `${background}, below the 4.5:1 AA floor for normal text.`
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the body text distinct from the title', () => {
    // The two tokens are separate on purpose and are used independently (a pin
    // icon and a status pill reach for different ones). Collapsing them to the
    // same value would make the choice between them meaningless without
    // removing either, which is the quiet way a two-tier palette rots.
    const collapsed = FAMILIES.filter(
      (family) => hexOf(TOKENS.get(`--alert-${family}-text`)) === hexOf(TOKENS.get(`--alert-${family}-title`))
    );
    expect(collapsed, `these families give -text and -title the same value: ${collapsed.join(', ')}`).toEqual([]);
  });
});
