/**
 * How many of the top bar's groups fit on one line.
 *
 * The bar carries one entry per enabled module group, so how wide it needs to
 * be is a fact about the department, not the design: with every module on it
 * wanted ~1520px, and below that the whole page scrolled sideways (by 612px on
 * a tablet). No breakpoint can be right for every department, so the fit is
 * measured and whatever does not fit moves into a "More" menu.
 *
 * `widths` are the groups' own widths in order, `gap` the space between two
 * neighbours. When everything fits no "More" is needed and its width is not
 * spent; otherwise the leading groups are kept while they fit alongside it.
 *
 * A row with no width has not been laid out (jsdom, or a hidden header), and
 * is treated as fitting: hiding every group behind More would be the wrong
 * answer to "nothing has been measured yet".
 */
export const fitNavItems = (widths: number[], moreWidth: number, available: number, gap: number): number => {
  if (available <= 0) return widths.length;
  const total = widths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0);
  if (total <= available) return widths.length;

  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + gap + width;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
};
