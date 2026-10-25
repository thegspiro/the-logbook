/**
 * Touch-target integrity
 *
 * The 44px touch minimum was written as `max-md:min-h-[44px]` (and
 * `max-sm:`, and `max-md:mobile-touch-target`) at 130 call sites. That gates
 * the target on screen WIDTH, so a phone turned sideways (844px) or an iPad —
 * both driven by a finger — fell back to 24–36px desktop targets.
 *
 * The `touch:` variant in styles/index.css means "phone-width OR coarse
 * pointer"; the shared utilities (btn-*, form-input, touch-target-phone,
 * btn-icon-sm) use the same condition. This walks the source and fails on a
 * touch minimum gated on a width breakpoint alone.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const WIDTH_GATED_TARGET =
  /(?<![\w-])max-(?:sm|md|lg|xl):(?:min-[hw]-(?:\[44px\]|11)|mobile-touch-target|touch-target-phone)(?![\w-])/g;

// `pointer-fine:` is emitted after the shared utilities, so on a phone-width
// window driven by a mouse (a narrow desktop browser, the CI emulation) a bare
// `pointer-fine:min-h-6` beats touch-target-phone's 44px. It has to be scoped to
// `md:` so the 24px floor only applies where the 44px rule does not.
const FINE_POINTER_FLOOR = /(?<![\w-]:)pointer-fine:min-[hw]-/;

// The same mistake written the other way round: the 44px size unprefixed,
// then a width breakpoint taking it back — `min-h-11 sm:min-h-9`. From 640px
// up the target is the desktop size, and a phone on its side is 844px wide.
// Write the desktop size plain and the finger size as `touch:`.
const TOUCH_SIZE = /(?<![\w:[-])(min-h|h|min-w|w)-(?:11|\[44px\])(?![\w-])/g;
const BREAKPOINT_SIZE = /(?<![\w-])(?:sm|md|lg):(min-h|h|min-w|w)-(\d+(?:\.\d+)?|\[(\d+)px\])(?![\w-])/g;

/** Utilities in `line` that set a 44px size and shrink it again at a width breakpoint. */
const shrunkAtBreakpoint = (line: string): string[] => {
  const touchAxes = new Set([...line.matchAll(TOUCH_SIZE)].map((m) => m[1]));
  return [...line.matchAll(BREAKPOINT_SIZE)]
    .filter((m) => {
      if (!touchAxes.has(m[1])) return false;
      const px = m[3] !== undefined ? Number(m[3]) : Number(m[2]) * 4;
      return px < 44;
    })
    .map((m) => m[0]);
};

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

describe('touch-target integrity', () => {
  it('gates the 44px touch minimum on touch, not on screen width alone', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (WIDTH_GATED_TARGET.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
          WIDTH_GATED_TARGET.lastIndex = 0;
        });
    }
    expect(
      offenders,
      'Use touch:min-h-[44px] / touch:mobile-touch-target / touch-target-phone — a width breakpoint leaves landscape phones and tablets with desktop-size targets'
    ).toEqual([]);
  });

  it('detects the width-gated forms it exists to forbid', () => {
    for (const bad of ['max-md:min-h-[44px]', 'max-sm:min-w-[44px]', 'max-md:min-h-11', 'max-md:mobile-touch-target']) {
      expect(`a ${bad} b`).toMatch(WIDTH_GATED_TARGET);
      WIDTH_GATED_TARGET.lastIndex = 0;
    }
    for (const ok of ['touch:min-h-[44px]', 'max-md:min-h-0', 'max-md:px-4', 'touch-target-phone']) {
      expect(`a ${ok} b`).not.toMatch(WIDTH_GATED_TARGET);
      WIDTH_GATED_TARGET.lastIndex = 0;
    }
  });

  it('does not shrink a 44px touch size back at a width breakpoint', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const shrunk = shrunkAtBreakpoint(line);
          if (shrunk.length) offenders.push(`${path.relative(SRC, file)}:${i + 1} ${shrunk.join(' ')}`);
        });
    }
    expect(
      offenders,
      'Write the desktop size plain and the finger size as touch: (`min-h-9 touch:min-h-11`) — a sm:/md: shrink gives a landscape phone the desktop size'
    ).toEqual([]);
  });

  it('detects a breakpoint shrink but not a breakpoint growth or the touch: form', () => {
    for (const bad of ['min-h-11 sm:min-h-9', 'h-11 md:h-9', 'min-w-[44px] sm:min-w-[40px]', 'min-h-11 sm:min-h-0']) {
      expect(shrunkAtBreakpoint(bad), bad).not.toEqual([]);
    }
    for (const ok of [
      'min-h-9 touch:min-h-11',
      'h-9 w-9 sm:h-11 sm:w-11',
      'w-11 sm:w-13',
      'min-h-11 sm:px-2',
      'h-12 sm:h-11',
    ]) {
      expect(shrunkAtBreakpoint(ok), ok).toEqual([]);
    }
  });

  it('does not let a fine-pointer size floor undercut touch-target-phone on a narrow window', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('touch-target-phone') && FINE_POINTER_FLOOR.test(line)) {
            offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
          }
        });
    }
    expect(offenders, 'Write md:pointer-fine:min-h-* so the floor stops applying at phone width').toEqual([]);
  });

  it('detects the unscoped fine-pointer floor but not the md-scoped one', () => {
    expect('x pointer-fine:min-h-6 y').toMatch(FINE_POINTER_FLOOR);
    expect('x md:pointer-fine:min-h-6 y').not.toMatch(FINE_POINTER_FLOOR);
  });
});
