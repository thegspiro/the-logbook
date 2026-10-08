/**
 * How "My Budgets" groups an owner's lines. Which lines are theirs, and each
 * line's figures, are the backend's; this only orders the groups.
 */

import type { MyBudget } from '../types';

/** The year being spent first, then next year's draft, then the closed ones. */
const STATUS_ORDER: Record<string, number> = { active: 0, draft: 1, closed: 2 };

export interface FiscalYearGroup {
  fiscalYearId: string;
  name: string;
  status: string;
  lines: MyBudget[];
}

/**
 * Group the lines by fiscal year: the active year first, then drafts, then
 * closed years. Within a status the backend's order (newest year first) holds,
 * because `Array.prototype.sort` is stable.
 */
export function groupByFiscalYear(lines: MyBudget[]): FiscalYearGroup[] {
  const groups = new Map<string, FiscalYearGroup>();
  for (const line of lines) {
    let group = groups.get(line.fiscalYearId);
    if (!group) {
      group = {
        fiscalYearId: line.fiscalYearId,
        name: line.fiscalYearName || 'Fiscal year',
        status: line.fiscalYearStatus ?? '',
        lines: [],
      };
      groups.set(line.fiscalYearId, group);
    }
    group.lines.push(line);
  }
  return [...groups.values()].sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));
}
