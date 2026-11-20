/**
 * Card padding integrity
 *
 * `card` and `card-secondary` paint a surface, a border and a radius, and no
 * padding: a list or table inside one is meant to run to its edges. Content
 * that is not a list brings its own padding, and two shapes kept leaving it
 * out:
 *
 *   - a stat tile inside a `<StatGrid>` with no padding at all. Training's
 *     Monthly Status tiles printed their figure and label flush against the
 *     left border.
 *   - a centred message with only vertical padding (`py-12 text-center`),
 *     almost always an empty state. Its sentence runs border to border once it
 *     wraps, which on a phone is immediately: "No active variant groups yet"
 *     and "No outside departments yet" both touched the card's sides at 390px.
 *     Below 768px index.css forces every `.card` to 0.75rem padding, which
 *     hides the second shape on a phone for `card` only; `card-secondary` has
 *     no such rule, and on a wider screen neither does `card`.
 *
 * Found by a render pass over every route and the dialogs it opens, at desktop
 * and phone widths, flagging any card whose text sat within 6px of its edge.
 * That pass needs a browser; this keeps both shapes from coming back with a
 * source scan instead.
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

/** Padding on every side: `p-4`, `p-3`, `p-[10px]`. */
const ALL_SIDE_PADDING = /(?:^|\s)p-(?:\d|\[)/;

/** Horizontal padding, from `p-*` or `px-*`. */
const HORIZONTAL_PADDING = /(?:^|\s)(?:p|px)-(?:\d|\[)/;

/** Vertical-only padding: the shape that marks a padded message rather than a list. */
const VERTICAL_PADDING = /(?:^|\s)py-(?:\d|\[)/;

/**
 * Cards whose `py-*` belongs to a list, not a message: the rows carry their
 * own horizontal padding and are meant to meet the card's sides.
 */
const LIST_CONTAINERS = new Set(['pages/RoomQRCodesPage.tsx: card divide-theme-surface-border divide-y py-1']);

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

const files = collectSourceFiles(SRC);
const sources = files.map((file) => ({ rel: path.relative(SRC, file), text: fs.readFileSync(file, 'utf8') }));

describe('stat tiles', () => {
  it('finds the StatGrid tiles it is meant to check', () => {
    const tiles = sources.flatMap(({ text }) =>
      [...text.matchAll(STAT_GRID_BLOCK)].flatMap((m) => [...m[0].matchAll(CARD_CLASS)])
    );
    // Guards the regexes: a scan that matches nothing passes for the wrong reason.
    expect(tiles.length).toBeGreaterThan(20);
  });

  it('pads every card tile inside a StatGrid', () => {
    const unpadded = sources.flatMap(({ rel, text }) =>
      [...text.matchAll(STAT_GRID_BLOCK)].flatMap((block) =>
        [...block[0].matchAll(CARD_CLASS)]
          .filter((m) => !ALL_SIDE_PADDING.test(m[1] ?? ''))
          .map((m) => `${rel}: className="${m[1] ?? ''}"`)
      )
    );
    expect(unpadded).toEqual([]);
  });
});

describe('cards with vertical padding', () => {
  const verticalOnly = sources.flatMap(({ rel, text }) =>
    [...text.matchAll(CARD_CLASS)]
      .map((m) => m[1] ?? '')
      .filter((cls) => VERTICAL_PADDING.test(cls) && !HORIZONTAL_PADDING.test(cls))
      .map((cls) => `${rel}: ${cls}`)
  );

  it('finds the list containers it exempts, so a stale exemption is noticed', () => {
    for (const entry of LIST_CONTAINERS) expect(verticalOnly).toContain(entry);
  });

  it('pads their sides too, unless the card is a list whose rows carry the padding', () => {
    expect(verticalOnly.filter((entry) => !LIST_CONTAINERS.has(entry))).toEqual([]);
  });
});
