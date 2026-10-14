/**
 * Budget categories nest (`parentCategoryId`): a Quartermaster category holds
 * Boot reimbursement and Officer brass. These helpers draw that tree from the
 * flat list the API returns. Who may charge a line is decided by the backend
 * (`effectiveChargeAccess`); nothing here re-derives it.
 */

import type { BudgetCategory } from '../types';

export interface CategoryTreeRow {
  category: BudgetCategory;
  /** 0 for a top-level category, 1 for its sub-categories, and so on. */
  depth: number;
}

const byOrderThenName = (a: BudgetCategory, b: BudgetCategory): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Parents before their children, siblings by sort order then name. A category
 * whose parent is missing from the list (inactive and filtered, or another
 * page) is drawn at the top level rather than dropped, and a stored cycle is
 * cut where it closes rather than looping.
 */
export function orderCategoryTree(categories: BudgetCategory[]): CategoryTreeRow[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string, BudgetCategory[]>();
  const roots: BudgetCategory[] = [];
  for (const category of categories) {
    const parent = category.parentCategoryId;
    if (parent && ids.has(parent) && parent !== category.id) {
      children.set(parent, [...(children.get(parent) ?? []), category]);
    } else {
      roots.push(category);
    }
  }
  const rows: CategoryTreeRow[] = [];
  const placed = new Set<string>();
  const visit = (category: BudgetCategory, depth: number) => {
    if (placed.has(category.id)) return;
    placed.add(category.id);
    rows.push({ category, depth });
    for (const child of [...(children.get(category.id) ?? [])].sort(byOrderThenName)) {
      visit(child, depth + 1);
    }
  };
  for (const root of [...roots].sort(byOrderThenName)) visit(root, 0);
  // Anything left sits in a cycle with no way in from the top.
  for (const category of [...categories].sort(byOrderThenName)) visit(category, 0);
  return rows;
}

/** Every category beneath `id`, which may not become its parent. */
export function descendantIds(categories: BudgetCategory[], id: string): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const category of categories) {
      if (category.parentCategoryId === current && !found.has(category.id) && category.id !== id) {
        found.add(category.id);
        stack.push(category.id);
      }
    }
  }
  return found;
}

/** "Quartermaster › Officer brass", from the path the backend reports. */
export const categoryPathLabel = (category: BudgetCategory): string =>
  category.path && category.path.length > 0 ? category.path.join(' › ') : category.name;

export interface BudgetTreeGroup<T> {
  /** The top-level category the lines sit under; '' for lines whose category is unknown. */
  rootId: string;
  rootName: string;
  rows: { budget: T; depth: number }[];
  /** True when the group spans sub-categories, so a subtotal says something a single line does not. */
  hasSubLines: boolean;
}

/**
 * Budget lines grouped under their top-level category, in tree order, so a
 * Quartermaster's sub-lines read beneath it with a subtotal. Display only:
 * the totals are sums of the lines shown, not a stored roll-up.
 */
export function groupBudgetsByCategoryTree<T extends { id: string; categoryId: string }>(
  budgets: T[],
  categories: BudgetCategory[]
): BudgetTreeGroup<T>[] {
  const tree = orderCategoryTree(categories);
  const position = new Map(tree.map(({ category }, index) => [category.id, index]));
  const depth = new Map(tree.map(({ category, depth: d }) => [category.id, d]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rootOf = (id: string): BudgetCategory | undefined => {
    let current = byId.get(id);
    const seen = new Set<string>();
    while (current?.parentCategoryId && byId.has(current.parentCategoryId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentCategoryId);
    }
    return current;
  };
  const sorted = [...budgets].sort(
    (a, b) =>
      (position.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER)
  );
  const groups: BudgetTreeGroup<T>[] = [];
  for (const budget of sorted) {
    const root = rootOf(budget.categoryId);
    const rootId = root?.id ?? '';
    let group = groups[groups.length - 1];
    if (!group || group.rootId !== rootId) {
      group = { rootId, rootName: root?.name ?? 'Unknown', rows: [], hasSubLines: false };
      groups.push(group);
    }
    const lineDepth = depth.get(budget.categoryId) ?? 0;
    if (lineDepth > 0) group.hasSubLines = true;
    group.rows.push({ budget, depth: lineDepth });
  }
  return groups;
}
