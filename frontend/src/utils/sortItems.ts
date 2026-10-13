import type { SortDirection } from '../components/ux/SortableHeader';

/** Generic sort utility
 * @deprecated Prefer dedicated sort logic in components */
export function sortItems<T>(
  items: T[],
  field: string | null,
  direction: SortDirection,
  accessor?: (item: T, field: string) => string | number | Date | null | undefined
): T[] {
  if (!field || !direction) return items;

  return [...items].sort((a, b) => {
    const getVal = accessor || ((item: T, f: string) => (item as Record<string, unknown>)[f]);
    const aVal = getVal(a, field);
    const bVal = getVal(b, field);

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let cmp: number;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      cmp = aVal.localeCompare(bVal);
    } else {
      cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    }

    return direction === 'desc' ? -cmp : cmp;
  });
}
