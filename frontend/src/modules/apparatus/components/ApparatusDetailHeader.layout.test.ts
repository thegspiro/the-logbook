/**
 * The detail header's rows wrap on a phone (workflow review W48-6).
 *
 * Unwrapped, the unit badge, name and the Edit and Archive buttons sat on one
 * row, which ran 85px past a 390px screen and scrolled the whole page sideways.
 * jsdom does no layout, so this is asserted against the source; the browser
 * pass measured the overflow before and after.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'ApparatusDetailHeader.tsx'), 'utf8');
const sharedHeader = readFileSync(join(__dirname, '../../../components/layout/SectionPageHeader.tsx'), 'utf8');
const stylesheet = readFileSync(join(__dirname, '../../../styles/index.css'), 'utf8');

describe('ApparatusDetailHeader layout', () => {
  // The title row and the action row now belong to the shared Operations
  // header, so the wrapping that fixed W48-6 is asserted where it lives: the
  // title stacks above the actions on a phone and the actions wrap, and the
  // badges beside the unit number wrap inside the title.
  it('draws through the shared header, whose title and action rows wrap', () => {
    expect(source).toContain('<OperationsPageHeader');
    // The row is the shared `page-header` utility: a column on a phone, a
    // wrapping row from sm. The actions group wraps its own buttons.
    expect(sharedHeader).toContain('className="page-header mb-8 gap-4 sm:items-center"');
    expect(sharedHeader).toContain('className="page-header-title"');
    expect(sharedHeader).toContain('className="page-header-actions flex flex-wrap items-center gap-2 sm:justify-end"');
    expect(stylesheet).toMatch(/@utility page-header \{\s*display: flex;\s*flex-direction: column;/);
  });

  it('lets the unit number and its badges wrap', () => {
    expect(source).toContain('<span className="flex flex-wrap items-center gap-3">');
    expect(source).not.toContain('<div className="flex items-center justify-between">');
  });
});
