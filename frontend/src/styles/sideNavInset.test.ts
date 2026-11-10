import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const srcDir = join(__dirname, '..');
const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');
const appLayout = readFileSync(join(srcDir, 'components/layout/AppLayout.tsx'), 'utf8');
const sideNavigation = readFileSync(join(srcDir, 'components/layout/SideNavigation.tsx'), 'utf8');

/**
 * The content-column inset contract, read from the source rather than a render.
 *
 * A page-level element fixed to the viewport cannot inherit the content
 * column's offset. In the left-navigation layout that offset is
 * `md:ml-(--side-nav-width)` while `SideNavigation` is itself
 * `fixed left-0 z-40`, so a bar at `left-0`
 * and the same z-index paints over the navigation's bottom. The fix is not a
 * hardcoded `md:left-64`: the top-navigation layout renders content full width,
 * and that correction would leave those departments a 256px dead gap.
 *
 * So the width is published as a variable by the layout that actually renders a
 * side navigation, and fixed elements read it. Three things have to hold
 * together, and each one alone is silently insufficient:
 *
 *   - the stylesheet declares it, per breakpoint;
 *   - only the left-navigation branch opts in;
 *   - nobody goes back to hardcoding the offset.
 *
 * jsdom compiles no Tailwind and applies no cascade, so no render can catch any
 * of it.
 */
const collectTsxFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => join(dir, entry));

describe('side navigation inset contract', () => {
  it('declares the inset as zero by default and the nav width from md up', () => {
    expect(stylesheet).toMatch(/\.has-side-nav \{\s*--side-nav-width:\s*0px;\s*\}/);
    // 16rem is SideNavigation's `w-64`; 768px is the breakpoint at which that
    // layout stops being an off-canvas drawer.
    expect(stylesheet).toMatch(
      /@media \(min-width: 768px\) \{\s*\.has-side-nav \{\s*--side-nav-width:\s*16rem;\s*\}\s*\}/
    );
  });

  it('narrows the inset to the collapsed rail from md up only', () => {
    // 5rem is SideNavigation's collapsed `w-20`. Inside a 768px block, because
    // below it the nav is an off-canvas drawer and the inset must stay 0px.
    expect(stylesheet).toMatch(
      /@media \(min-width: 768px\) \{\s*\.has-side-nav\[data-nav-collapsed='true'\] \{\s*--side-nav-width:\s*5rem;\s*\}\s*\}/
    );
    // …keyed on the root AppLayout owns, not a `:has()` match on the nav.
    expect(appLayout).toMatch(/data-nav-collapsed=\{navCollapsed \? 'true' : 'false'\}/);
    expect(appLayout).toMatch(/onCollapsedChange=\{setNavCollapsed\}/);
  });

  it('collapses the rail and its content offset without a transition under reduced motion', () => {
    // The global reduced-motion rule only shortens transitions to 0.01ms, and
    // WebKit did not finish even that one on the rail: five seconds after a
    // collapse the rail still measured its expanded 256px, and the Expand
    // toggle inside it never stopped moving long enough to be clicked
    // (Frontend E2E, Mobile Safari, on every branch after #4148). With no
    // transition the width is applied as soon as the class changes. The
    // content column already did this; the rail and the column must agree,
    // or one lands while the other is still moving.
    const rail = /<nav\s[^>]*id="side-navigation"[^>]*className=\{`([^`]*)`/s.exec(sideNavigation)?.[1] ?? '';
    expect(rail).toMatch(/\btransition-all\b/);
    expect(rail).toMatch(/\bmotion-reduce:transition-none\b/);
    expect(appLayout).toMatch(/transition-\[margin-left\][^"]*motion-reduce:transition-none/);
  });

  it('opts in from the left-navigation layout only', () => {
    // Exactly one root carries it. Two would mean the top-navigation branch had
    // been given it as well, which is the gap this variable exists to close.
    expect(appLayout.match(/has-side-nav/g)).toHaveLength(1);
    // …and it is the branch that offsets its own content by the same width,
    // read from the variable so the offset follows the collapsed rail. A
    // literal `md:ml-64` left an empty stripe beside the rail.
    expect(appLayout).toMatch(/md:ml-\(--side-nav-width\)/);
    expect(appLayout).not.toMatch(/md:ml-64/);
  });

  it('keeps page action bars below the mobile navigation drawer', () => {
    // Below 768px the navigation is an off-canvas drawer: scrim and panel are
    // both `z-40` and render before any page content, so a page-level bar at
    // `z-40` wins on DOM order and covers the drawer's bottom while it is open.
    // The bar has to outrank page content and yield to the navigation, which
    // `z-30` is. jsdom compiles no Tailwind, so only the source shows this.
    const bars = collectTsxFiles(srcDir).flatMap((file) =>
      (readFileSync(file, 'utf8').match(/className="[^"]*action-bar-safe[^"]*"/g) ?? [])
        .filter((cls) => /\bfixed\b/.test(cls))
        .map((cls) => ({ file: file.slice(srcDir.length + 1), z: /\bz-(\d+)\b/.exec(cls)?.[1] }))
    );

    expect(bars.length).toBeGreaterThan(0);
    expect(bars.filter((bar) => bar.z !== '30')).toEqual([]);
  });

  it('starts every page action bar at the content column', () => {
    // The inset is carried unconditionally rather than only by the bars that
    // render at desktop widths. It is 0px below 768px and absent under top
    // navigation, so it costs nothing where no side navigation exists — and
    // covering those cases is what leaves the rule with no exception to
    // remember. The bar that was left out of it sat behind the navigation.
    const bars = collectTsxFiles(srcDir).flatMap((file) =>
      (readFileSync(file, 'utf8').match(/className="[^"]*action-bar-safe[^"]*"/g) ?? [])
        .filter((cls) => /\bfixed\b/.test(cls))
        .map((cls) => ({ file: file.slice(srcDir.length + 1), cls }))
    );

    expect(bars.length).toBeGreaterThan(0);
    expect(bars.filter((bar) => !bar.cls.includes('left-[var(--side-nav-width,0px)]')).map((b) => b.file)).toEqual([]);
  });

  it('leaves no fixed element hardcoding the left-navigation offset', () => {
    // Comments are stripped first: the rule is about class strings, and the
    // call sites that got this right say `md:left-64` in prose explaining why
    // they do not use it.
    const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    const offenders = collectTsxFiles(srcDir)
      .filter((file) => /\bmd:left-64\b/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(srcDir.length + 1));

    expect(offenders).toEqual([]);
  });
});
