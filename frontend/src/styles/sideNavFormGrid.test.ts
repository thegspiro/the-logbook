import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');
const settingsLayout = readFileSync(join(__dirname, '..', 'components/settings/SettingsLayout.tsx'), 'utf8');

/**
 * The tablet form-field contract, read from the source rather than a render.
 *
 * From 768px the left navigation takes 16rem, but `sm:`/`md:` still answer for
 * the whole viewport. On an iPad in portrait that split field grids into
 * ~124px columns and left Organization Settings a ~200px panel. jsdom compiles
 * no Tailwind and applies no cascade, so no render can see any of this; the
 * laid-out result is asserted by `e2e/tablet-layout.spec.ts`. This pins the
 * rules that produce it, and the limits that keep them from reaching further.
 */

/** The body of the first rule whose selector contains `marker`, nesting included. */
const ruleContaining = (marker: string): string => {
  const at = stylesheet.indexOf(marker);
  if (at < 0) return '';
  const open = stylesheet.indexOf('{', at);
  let depth = 1;
  let i = open + 1;
  while (i < stylesheet.length && depth > 0) {
    if (stylesheet[i] === '{') depth += 1;
    else if (stylesheet[i] === '}') depth -= 1;
    i += 1;
  }
  return stylesheet.slice(at, i);
};

describe('form grids beside the side navigation', () => {
  const block = ruleContaining('@media (min-width: 768px) and (max-width: 1023px)');

  it('applies only between the side navigation appearing and lg', () => {
    expect(block).not.toBe('');
  });

  it('is limited to the left-navigation layout, inside main', () => {
    expect(block).toMatch(/\.has-side-nav\s+main\s+:is\(/);
  });

  it('touches only grids that hold a text field, select or textarea', () => {
    // Without :has() it would also reflow stat tiles and card grids.
    expect(block).toMatch(/:has\(\s*input:not\([^)]*\[type='checkbox'\][^)]*\),\s*select,\s*textarea\s*\)/);
  });

  it('stays out of dialogs, whose width does not depend on the navigation', () => {
    expect(block).toContain(":not(:is(.modal-overlay, .modal-panel, [role='dialog']) *)");
  });

  it('holds such grids at two columns and turns wider spans into full rows', () => {
    expect(block).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    // A span of three in a two-column grid would create an implicit column.
    expect(block).toMatch(/> :is\([^)]*\.sm\\:col-span-3[^)]*\)\s*\{\s*grid-column: 1 \/ -1;/);
  });
});

describe('settings rail', () => {
  it('stays a strip above the panel until lg', () => {
    expect(settingsLayout).toContain('lg:flex-row');
    expect(settingsLayout).toContain('lg:w-52');
    expect(settingsLayout).not.toMatch(/md:(flex-row|w-52)/);
  });

  it('switches its item treatment at the same breakpoint as the layout', () => {
    const item = ruleContaining('@utility settings-subnav-item {');
    const active = ruleContaining('@utility settings-subnav-item-active');
    expect(item).toContain('lg:border-l-3');
    expect(item).not.toMatch(/\bmd:/);
    expect(active).toContain('lg:border-l-red-800');
  });
});

describe('field font size on a touch screen', () => {
  it('keeps fields at 16px on any coarse pointer, not only below 768px', () => {
    // iOS zooms the page on focus below 16px, and a phone on its side is wider
    // than 767px.
    const rule = ruleContaining('@media (max-width: 767px), (pointer: coarse) {\n  input:not');
    expect(rule).toContain('font-size: max(1rem, 16px);');
  });

  it('leaves the width resets at phone width, where they cannot override a tablet max-w-*', () => {
    const rule = ruleContaining('@media (max-width: 767px) {\n  input:not');
    expect(rule).toContain('max-width: 100%;');
    expect(rule).not.toContain('font-size');
  });
});
