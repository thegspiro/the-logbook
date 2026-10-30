/**
 * Text that renders outside the element holding it.
 *
 * The overflow checks in the presentation and reflow passes compare element
 * boxes with the viewport, so they cannot see a word that runs out of its own
 * box while that box stays on screen. That is what the Finance KPI tiles did at
 * 320px: each label's <p> was squeezed to ~30px between an icon and a chevron,
 * "Budgeted" could not break, and it was drawn straight across the chevron.
 * Every element box was inside the viewport, so nothing failed.
 *
 * Measured from the text itself: a Range over an element's own text nodes
 * gives the line boxes as drawn, and any that reach past the element's padding
 * box are spilling. An ancestor that clips or scrolls (`overflow` other than
 * `visible`) is where spilling becomes truncation or a scroll region, both of
 * which are deliberate, so those are left to the checks that own them.
 *
 * Self-contained because Playwright serializes it into the page: it may not
 * close over anything from this module.
 */
export const findSpilledText = (): string[] => {
  const SLACK = 2;
  const hits: string[] = [];
  const clips = (el: Element) => getComputedStyle(el).overflowX !== 'visible';

  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (el.closest('[data-mobile-scroll-region], svg')) continue;
    const ownText = Array.from(el.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()
    );
    if (!ownText.length) continue;
    const box = el.getBoundingClientRect();
    // sr-only text is a 1px box by design.
    if (box.width <= SLACK || box.height <= SLACK) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || clips(el)) continue;

    // The nearest clipping ancestor hides whatever spills past its own edges,
    // so a spill only shows where it lands inside that ancestor.
    let clipLeft = -Infinity;
    let clipRight = Infinity;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (clips(p)) {
        const pb = p.getBoundingClientRect();
        clipLeft = pb.left;
        clipRight = pb.right;
        break;
      }
    }

    const left = box.left + parseFloat(style.borderLeftWidth);
    const right = box.right - parseFloat(style.borderRightWidth);
    for (const node of ownText) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const spill = Array.from(range.getClientRects()).find(
        (r) =>
          r.width > 0 &&
          ((r.right > right + SLACK && clipRight > right + SLACK) || (r.left < left - SLACK && clipLeft < left - SLACK))
      );
      if (spill) {
        const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const cls = Array.from(el.classList)
          .slice(0, 3)
          .map((c) => `.${c}`)
          .join('');
        hits.push(
          `${el.tagName.toLowerCase()}${cls} "${text}" [box ${Math.round(left)}-${Math.round(right)}, text ${Math.round(spill.left)}-${Math.round(spill.right)}]`
        );
        break;
      }
    }
  }
  return hits;
};
