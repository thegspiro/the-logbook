/**
 * Does a wide table fit the card it sits in?
 *
 * A table wider than its card either scrolls sideways — with the scrollbar at
 * the foot of the list, out of sight — or, inside an `overflow-hidden` card,
 * is clipped with no way to reach the cut-off columns at all. Tables that can
 * be that wide reflow into cards below a container-query tier
 * (`rwd-table-wide` / `-xwide` / `-2xwide` in index.css); this is the check
 * that the tier chosen for a table is wide enough.
 *
 * The measurement is the table's rendered width against its card's: the
 * nearest `rwd-table-container`, or the table's parent before one is added.
 * Comparing the two catches the clipped case, which a scrollWidth check on an
 * `overflow-hidden` card would miss.
 */

import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

/**
 * The widths where a table's room is hardest to guess from the viewport: two
 * tablets with the side navigation open, the two common laptop widths, and
 * two desktops wide enough to show the widest tier as a table.
 */
export const TABLE_FIT_VIEWPORTS = [
  { name: 'iPad portrait 820x1180', width: 820, height: 1180 },
  { name: 'iPad Pro portrait 1024x1366', width: 1024, height: 1366 },
  { name: 'laptop 1280x800', width: 1280, height: 800 },
  { name: 'laptop 1366x768', width: 1366, height: 768 },
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'desktop 1920x1080', width: 1920, height: 1080 },
];

export async function expectTableFitsItsCard(table: Locator, label: string): Promise<void> {
  await expect(table.locator('tbody tr').first(), `${label} rendered no rows to measure`).toBeVisible();
  const { width, room } = await table.evaluate((el) => {
    const card = el.closest('.rwd-table-container') ?? el.parentElement;
    return {
      width: Math.ceil(el.getBoundingClientRect().width),
      room: card ? card.clientWidth : 0,
    };
  });
  expect(width, `${label} is ${width - room}px wider than its card`).toBeLessThanOrEqual(room);
  await expectStackedRowsAligned(table, label);
}

/**
 * In the stacked view each labelled cell is a flex row: its `data-label` on the
 * left, its value on the right. Three shapes broke that, none visible to the
 * fit check above:
 *
 *   - a width on the <td> (`max-w-[160px]`, `w-10`) capped the whole row, so
 *     label and value sat together in a narrow box at the left;
 *   - a value and its sub-line as sibling elements became separate flex items,
 *     spread across the row: "$248,750" mid-row, "(amended)" at the far edge;
 *   - an auto margin (`mx-auto` on a centred icon) pulled the value off the
 *     right edge.
 *
 * Checked only where the table is stacked, at whatever width that is.
 */
async function expectStackedRowsAligned(table: Locator, label: string): Promise<void> {
  const problems = await table.evaluate((el) => {
    const thead = el.querySelector('thead');
    if (!thead || getComputedStyle(thead).display !== 'none') return [];
    const found: string[] = [];
    for (const tr of el.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      const rowWidth = tr.getBoundingClientRect().width;
      for (const td of tr.querySelectorAll<HTMLTableCellElement>(':scope > td[data-label]')) {
        const style = getComputedStyle(td);
        const box = td.getBoundingClientRect();
        if (style.display === 'none' || td.classList.contains('rwd-table-lead') || box.width === 0) continue;
        const name = td.dataset.label ?? '';
        if (Math.abs(box.width - rowWidth) > 2) {
          found.push(`${name}: row is ${Math.round(box.width)}px in a ${Math.round(rowWidth)}px card`);
        }
        // Each element child is its own flex item; adjacent text nodes share
        // one anonymous item, so a run of text counts once.
        const pieces: Node[] = [];
        let afterText = false;
        for (const node of td.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent?.trim() && !afterText) pieces.push(node);
            if (node.textContent?.trim()) afterText = true;
          } else if (node instanceof HTMLElement) {
            if (getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0) {
              pieces.push(node);
              afterText = false;
            }
          }
        }
        if (pieces.length > 1) found.push(`${name}: value is split into ${pieces.length} pieces across the row`);
        const last = pieces[pieces.length - 1];
        if (pieces.length === 1 && last) {
          let right: number;
          if (last instanceof HTMLElement) right = last.getBoundingClientRect().right;
          else {
            // A text value can be several adjacent text nodes ("21", " of ",
            // "24"); the one piece is all of them, which is the whole cell.
            const range = document.createRange();
            range.selectNodeContents(td);
            right = range.getBoundingClientRect().right;
          }
          const edge = box.right - parseFloat(style.paddingRight);
          if (edge - right > 4) found.push(`${name}: value sits ${Math.round(edge - right)}px short of the right edge`);
        }
      }
    }
    return found;
  });
  expect(problems, `${label}: stacked rows out of line`).toEqual([]);
}
