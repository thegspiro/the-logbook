/**
 * Stat-tile padding integrity
 *
 * `card` and `card-secondary` paint a surface, a border and a radius, and no
 * padding: a list or table inside one is meant to run to its edges. A stat
 * tile is not, so every tile inside a `<StatGrid>` brings its own `p-*`. The
 * one that did not — Training's Monthly Status tiles, a bare `card` — printed
 * its figure and label flush against the left border.
 *
 * Found by a render pass over every route, which flagged any card whose text
 * sat within 6px of its edge. That pass needs a browser; this keeps the
 * StatGrid case from coming back with a source scan instead.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** A `<StatGrid …>…</StatGrid>` block, children included. */
const STAT_GRID_BLOCK = /<StatGrid\b[\s\S]*?<\/StatGrid>/g;

/** A static class string that opens with a card surface; group 1 is the whole string. */
const CARD_CLASS = /className="((?:card|card-secondary|card-hover)(?:\s[^"]*)?)"/g;

/** Padding on every side: `p-4`, `p-3`, `p-[10px]`. `px-`/`py-` alone leave two edges flush. */
const ALL_SIDE_PADDING = /(?:^|\s)p-(?:\d|\[)/;

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

describe('stat tiles', () => {
  const files = collectSourceFiles(SRC);

  it('finds the StatGrid tiles it is meant to check', () => {
    const tiles = files.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(STAT_GRID_BLOCK)].flatMap((m) => [...m[0].matchAll(CARD_CLASS)])
    );
    // Guards the regexes: a scan that matches nothing passes for the wrong reason.
    expect(tiles.length).toBeGreaterThan(20);
  });

  it('pads every card tile inside a StatGrid', () => {
    const unpadded = files.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(STAT_GRID_BLOCK)].flatMap((block) =>
        [...block[0].matchAll(CARD_CLASS)]
          .filter((m) => !ALL_SIDE_PADDING.test(m[1] ?? ''))
          .map((m) => `${path.relative(SRC, file)}: className="${m[1] ?? ''}"`)
      )
    );
    expect(unpadded).toEqual([]);
  });
});
