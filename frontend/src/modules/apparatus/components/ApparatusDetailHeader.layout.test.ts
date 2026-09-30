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

describe('ApparatusDetailHeader layout', () => {
  it('lets the title row and the action row wrap', () => {
    expect(source).toContain('className="flex flex-wrap items-center justify-between gap-3"');
    expect(source).toContain('className="flex flex-wrap items-center gap-2"');
    expect(source).not.toContain('<div className="flex items-center justify-between">');
  });
});
