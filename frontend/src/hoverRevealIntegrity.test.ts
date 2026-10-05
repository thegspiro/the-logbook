/**
 * Hover-reveal integrity
 *
 * Row and card actions that appear only on hover were written as
 * `sm:opacity-0 sm:group-hover:opacity-100`. That gates the hiding on screen
 * WIDTH, but the thing that decides whether a hover can ever happen is the
 * POINTER. A tablet is wide and has no hover, so on every iPad the edit,
 * delete and download controls on 26 screens sat invisible — still taking
 * their width beside the title, still tappable if you knew where.
 *
 * `pointer-fine:` is the right gate: it hides only for a mouse or trackpad,
 * which can hover to reveal. This walks the source and fails on a hide gated
 * on a width breakpoint instead.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** A width breakpoint that hides an element outright, e.g. `sm:opacity-0`. */
const WIDTH_GATED_HIDE = /(?<![\w-])(?:sm|md|lg|xl|2xl):opacity-0(?![\w./-])/g;

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

describe('hover-reveal integrity', () => {
  it('gates hover-only controls on the pointer, not the screen width', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (WIDTH_GATED_HIDE.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
        WIDTH_GATED_HIDE.lastIndex = 0;
      });
    }
    expect(
      offenders,
      'Use pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 — a width breakpoint hides the control on touch tablets, which cannot hover to reveal it'
    ).toEqual([]);
  });

  it('detects the width-gated pattern it exists to forbid', () => {
    expect('a sm:opacity-0 b').toMatch(WIDTH_GATED_HIDE);
    WIDTH_GATED_HIDE.lastIndex = 0;
    expect('a pointer-fine:opacity-0 b').not.toMatch(WIDTH_GATED_HIDE);
    WIDTH_GATED_HIDE.lastIndex = 0;
    expect('a md:opacity-0.5 b').not.toMatch(WIDTH_GATED_HIDE);
    WIDTH_GATED_HIDE.lastIndex = 0;
  });
});
