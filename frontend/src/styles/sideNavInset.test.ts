import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const srcDir = join(__dirname, '..');
const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');
const appLayout = readFileSync(join(srcDir, 'components/layout/AppLayout.tsx'), 'utf8');

/**
 * The content-column inset contract, read from the source rather than a render.
 *
 * A page-level element fixed to the viewport cannot inherit the content
 * column's offset. In the left-navigation layout that offset is `md:ml-64`
 * while `SideNavigation` is itself `fixed left-0 z-40`, so a bar at `left-0`
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
    // 16rem is SideNavigation's `w-64` and AppLayout's `md:ml-64`; 768px is the
    // breakpoint at which that layout stops being an off-canvas drawer.
    expect(stylesheet).toMatch(
      /@media \(min-width: 768px\) \{\s*\.has-side-nav \{\s*--side-nav-width:\s*16rem;\s*\}\s*\}/
    );
  });

  it('opts in from the left-navigation layout only', () => {
    // Exactly one root carries it. Two would mean the top-navigation branch had
    // been given it as well, which is the gap this variable exists to close.
    expect(appLayout.match(/has-side-nav/g)).toHaveLength(1);
    // …and it is the branch that offsets its own content by the same width.
    expect(appLayout).toMatch(/md:ml-64/);
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
