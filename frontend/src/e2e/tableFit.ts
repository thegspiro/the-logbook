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
 *
 * A second measurement then looks for content that leaves the card without
 * widening the table; see the comment inside `expectTableFitsItsCard`.
 * Content under a scroller nearer than the card is reachable and skipped, and
 * content an `overflow-hidden` box clips (a `truncate`) is measured only as far
 * as that box shows it.
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
  const { width, room, spill } = await table.evaluate((el) => {
    const card = el.closest('.rwd-table-container') ?? el.parentElement;
    const width = Math.ceil(el.getBoundingClientRect().width);
    const worst = { over: 0, what: '', cell: '' };
    if (!card) return { width, room: 0, spill: worst };

    // The width check alone misses content that leaves its cell without
    // widening the table. In card mode each <td> is a flex row, so an
    // unbreakable token in a `min-w-0` wrapper, an inline-flex chip or a
    // `shrink-0` child can run past the card's edge while the table's own box
    // still matches the card. So every visible element and text run inside the
    // table is measured against the card's content edges too.
    const cardRect = card.getBoundingClientRect();
    const cardLeft = cardRect.left + card.clientLeft;
    const cardRight = cardLeft + card.clientWidth;

    interface Clip {
      left: number;
      right: number;
    }

    // Overflow under a scroller between the content and the card (a
    // ScrollCueRow, a nested scroll strip) can be reached by scrolling it; the
    // card's own overflow-x-auto does not count, because content past the card
    // is the defect being looked for.
    const scrolls = (style: CSSStyleDeclaration): boolean => style.overflowX === 'auto' || style.overflowX === 'scroll';

    const clipTo = (clip: Clip | null, node: Element): Clip => {
      const r = node.getBoundingClientRect();
      const left = r.left + node.clientLeft;
      const right = left + node.clientWidth;
      return clip ? { left: Math.max(clip.left, left), right: Math.min(clip.right, right) } : { left, right };
    };

    const describe = (text: string): string => {
      const trimmed = text.replace(/\s+/g, ' ').trim();
      if (!trimmed) return '';
      return `"${trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed}"`;
    };

    const record = (rect: DOMRect, clip: Clip | null, what: () => string, from: Element): void => {
      if (rect.width <= 0 || rect.height <= 0) return;
      const left = clip ? Math.max(rect.left, clip.left) : rect.left;
      const right = clip ? Math.min(rect.right, clip.right) : rect.right;
      if (right <= left) return;
      const over = Math.max(cardLeft - left, right - cardRight);
      if (over > worst.over) {
        worst.over = Math.ceil(over);
        worst.what = what();
        worst.cell = from.closest('td, th')?.getAttribute('data-label') ?? '';
      }
    };

    let start: Clip | null = null;
    for (let up = el.parentElement; up && up !== card; up = up.parentElement) {
      const style = getComputedStyle(up);
      if (scrolls(style)) return { width, room: card.clientWidth, spill: worst };
      if (style.overflowX !== 'visible') start = clipTo(start, up);
    }

    const visit = (node: Element, clip: Clip | null): void => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.position === 'fixed') return;
      // Visually hidden text is clipped to a 1px box on purpose.
      if (node.classList.contains('sr-only')) return;
      const shown = style.visibility === 'visible';
      if (shown && node !== el) {
        record(
          node.getBoundingClientRect(),
          clip,
          () => `<${node.tagName.toLowerCase()}> ${describe(node.textContent ?? '')}`.trim(),
          node
        );
      }
      if (node !== el && scrolls(style)) return;
      const inner = node !== el && style.overflowX !== 'visible' ? clipTo(clip, node) : clip;
      for (const child of node.childNodes) {
        if (child instanceof Element) {
          visit(child, inner);
        } else if (child instanceof Text && shown && child.data.trim()) {
          const range = document.createRange();
          range.selectNodeContents(child);
          for (const rect of range.getClientRects()) {
            record(rect, inner, () => `text ${describe(child.data)}`, node);
          }
        }
      }
    };
    visit(el, start);

    return { width, room: card.clientWidth, spill: worst };
  });
  expect(width, `${label} is ${width - room}px wider than its card`).toBeLessThanOrEqual(room);
  const cell = spill.cell ? ` in its "${spill.cell}" cell` : '';
  expect(spill.over, `${label}: ${spill.what}${cell} reaches ${spill.over}px past its card's edge`).toBeLessThanOrEqual(
    1
  );
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
 *
 * A `rwd-table-fields` table in a wide card sets its fields out in a grid
 * instead, where a cell is deliberately narrower than its row and its value
 * sits under its label at the left. There the check is that every cell stays
 * inside the card and holds its own content.
 */
async function expectStackedRowsAligned(table: Locator, label: string): Promise<void> {
  const problems = await table.evaluate((el) => {
    const thead = el.querySelector('thead');
    if (!thead || getComputedStyle(thead).display !== 'none') return [];
    const found: string[] = [];
    for (const tr of el.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      const rowBox = tr.getBoundingClientRect();
      const rowWidth = rowBox.width;
      if (getComputedStyle(tr).display === 'grid') {
        for (const td of tr.querySelectorAll<HTMLTableCellElement>(':scope > td[data-label]')) {
          const box = td.getBoundingClientRect();
          if (getComputedStyle(td).display === 'none' || box.width === 0) continue;
          const name = td.dataset.label ?? '';
          if (box.left < rowBox.left - 1 || box.right > rowBox.right + 1) {
            found.push(`${name}: field runs outside its card`);
          }
          if (td.scrollWidth > td.clientWidth + 1) {
            found.push(`${name}: value is ${td.scrollWidth - td.clientWidth}px wider than its field`);
          }
        }
        continue;
      }
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
