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
});
