/**
 * Reflow table label integrity
 *
 * Below 768px `.rwd-table` stacks each row into a card and hides every body
 * cell that carries no `data-label` (styles/index.css). That rule exists for
 * cells with nothing to say on a phone, such as a selection checkbox, but a
 * cell that simply forgot its label vanishes the same way, silently. It took
 * the dues actions off phones (workflow review W66-2), the QuickBooks mapping
 * and pledge actions, and every cell of the documents list.
 *
 * This walks the source and requires a `data-label` on each `<td>` in the body
 * of a reflow table. A cell meant to disappear on a phone is listed in ALLOWED
 * with the reason it is safe to hide.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** `file:line` of a body cell deliberately hidden in the stacked view, and why. */
const ALLOWED: Record<string, string> = {
  // The pin and open-item controls; a phone gets the row's own mobile-only
  // Edit/Retire cell below it, and the item name itself opens the item.
  'modules/inventory/pages/InventoryItemsPage.tsx:td-actions':
    'desktop-only row actions, replaced by the mobile-only actions cell',
  // A decorative bar repeating the Hours cell beside it; aria-hidden already.
  'pages/scheduling/MyHoursSummary.tsx:td-bar': 'decorative bar; the hours are in their own labelled cell',
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

/**
 * Each unlabeled `<td>` inside the `<tbody>` of a `rwd-table`, as
 * `file:line` plus the cell's opening tag. Read by tag and section rather than
 * parsed: the tables here are plain JSX, and the nearest preceding `<table`,
 * `<tbody`, `<thead` or `<tfoot` says where a cell sits.
 */
const unlabeledBodyCells = (): { where: string; file: string; tag: string }[] => {
  const found: { where: string; file: string; tag: string }[] = [];
  for (const full of collectSourceFiles(SRC)) {
    const source = fs.readFileSync(full, 'utf8');
    if (!source.includes('rwd-table')) continue;
    const file = path.relative(SRC, full).split(path.sep).join('/');
    const cell = /<td\b[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = cell.exec(source)) !== null) {
      const tag = match[0];
      if (/\bdata-label\b/.test(tag)) continue;
      const before = source.slice(0, match.index);
      const table = before.lastIndexOf('<table');
      if (table < 0 || !/rwd-table/.test(source.slice(table, before.indexOf('>', table) + 1))) continue;
      const sections = ['<tbody', '<thead', '<tfoot'].map((s) => [s, before.lastIndexOf(s)] as const);
      const [section, at] = sections.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (section !== '<tbody' || at < table) continue;
      const line = before.split('\n').length;
      found.push({ where: `${file}:${line}`, file, tag });
    }
  }
  return found;
};

/** An allow-list key names the cell by role, so it survives edits that move lines. */
const allowedKey = (cell: { file: string; tag: string }): string | null => {
  if (cell.file === 'modules/inventory/pages/InventoryItemsPage.tsx' && /className="px-3 py-3"/.test(cell.tag)) {
    return `${cell.file}:td-actions`;
  }
  if (cell.file === 'pages/scheduling/MyHoursSummary.tsx' && /table-col-tertiary/.test(cell.tag)) {
    return `${cell.file}:td-bar`;
  }
  return null;
};

describe('reflow table labels', () => {
  const cells = unlabeledBodyCells();

  it('finds the reflow tables it is meant to police', () => {
    // A scanner that matched nothing would pass forever.
    expect(cells.length).toBeGreaterThan(0);
  });

  it('labels every body cell a phone would otherwise hide', () => {
    const offenders = cells.filter((cell) => {
      const key = allowedKey(cell);
      return !(key && key in ALLOWED);
    });
    expect(offenders.map((cell) => `${cell.where} ${cell.tag}`)).toEqual([]);
  });

  it('keeps no allow-list entry that no longer matches a cell', () => {
    const used = new Set(cells.map(allowedKey).filter((key): key is string => key !== null));
    expect(Object.keys(ALLOWED).filter((key) => !used.has(key))).toEqual([]);
  });
});
