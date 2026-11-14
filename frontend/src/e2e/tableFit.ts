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
}
