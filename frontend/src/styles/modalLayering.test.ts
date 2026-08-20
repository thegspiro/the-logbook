import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const srcDir = join(__dirname, '..');
const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');

/**
 * The scrim/panel stacking contract, read from the source rather than a render.
 *
 * jsdom applies no cascade and compiles no Tailwind, so nothing in the DOM can
 * catch what went wrong on 2026-08-16: `modal-overlay` was given `z-50`, which
 * is correct for the dialogs where the scrim is the fixed container and wrong
 * for the ~24 where it is an empty sibling of a `relative z-10` panel. In those,
 * the scrim painted over its own dialog — the surface looked dimmed, and every
 * tap inside it hit the scrim's close handler instead of the control beneath.
 *
 * Both halves of the contract are guarded, because fixing either one alone
 * breaks the other: the utility carries no z-index, and every call site that
 * uses the scrim as its own fixed container names one.
 */
const collectTsxFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => join(dir, entry));

describe('modal layering contract', () => {
  it('keeps z-index out of the modal-overlay utility', () => {
    const utility = /@utility modal-overlay \{([\s\S]*?)\n\}/.exec(stylesheet);
    expect(utility).not.toBeNull();

    const declarations = (utility?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).toMatch(/@apply[^;]*\bfixed\b/);
    expect(declarations).not.toMatch(/\bz-/);
  });

  it('names a z-index at every call site where the scrim is the fixed container', () => {
    // A scrim that lays its dialog out (`flex`) is the container shape: it holds
    // the panel as a child, so it needs its own z-index to clear page chrome.
    // A scrim with no layout classes is the sibling shape and must stay
    // unraised, so only the container shape is required to carry one.
    const offenders: string[] = [];

    for (const file of collectTsxFiles(srcDir)) {
      const source = readFileSync(file, 'utf8');
      for (const [classes] of source.matchAll(/modal-overlay[^"'`]*/g)) {
        if (!/\bflex\b/.test(classes)) continue;
        if (/\bz-(\[|\d)/.test(classes)) continue;
        offenders.push(`${file.slice(srcDir.length + 1)}: ${classes}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * The other way something ends up on top of a dialog: the mobile bottom
 * navigation. It is `fixed bottom-0 z-50` and AppLayout renders it after the
 * page content, so at equal z-index it paints over any dialog rather than under
 * it. Measured at 390x844 with the dialog scrolled to its end, the action row
 * of a taller-than-viewport dialog sat 40px behind the bar, and on a notched
 * phone — where the bar grows by env(safe-area-inset-bottom) — even a
 * max-h-[90dvh] dialog lost 32px. elementFromPoint returned the nav in both
 * cases, so the buttons were untappable, not merely clipped.
 *
 * The fix has two halves that only work together, so both are guarded: the
 * layout hides the bar while an overlay is open, and the stylesheet stops
 * reserving the bar's height inside overlay subtrees once it is gone.
 */
describe('bottom navigation vs dialogs contract', () => {
  it('hides the bottom bar whenever an overlay surface is open', () => {
    const layout = readFileSync(join(srcDir, 'components/layout/AppLayout.tsx'), 'utf8');

    expect(layout).toMatch(/useAnyOverlaySurface\(\)/);

    // Both layout branches (mobile side-nav and top-nav) render their own bar.
    const bars = layout.match(/<BottomNavigation[^/]*\/>/g) ?? [];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) expect(bar).toMatch(/overlayOpen/);
  });

  it("drops the bar's height allowance inside overlay subtrees", () => {
    // Without this, an in-dialog action bar keeps padding for a bar that is no
    // longer rendered and its buttons float above a band of dead space.
    const reset = /\.modal-overlay,\s*\.modal-panel,\s*\.drawer-panel \{[^}]*--bottom-nav-height:\s*0px/;
    expect(stylesheet).toMatch(reset);

    // The page-level default must survive: page action bars still clear a bar
    // that is still on screen for them.
    expect(stylesheet).toMatch(/\.has-bottom-nav \{\s*--bottom-nav-height:\s*3\.5rem/);
  });
});
