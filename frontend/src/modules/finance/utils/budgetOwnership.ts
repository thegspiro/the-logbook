/**
 * How a budget line's owner is worded. The rule — a line's own owner, else
 * its category's — is decided by the backend (`finance_budget_ownership.py`)
 * and arrives as `effectiveOwnerPositionName` / `ownerInherited`; these only
 * phrase it (CLAUDE.md pitfall #29).
 */

import type { Budget, BudgetCategory } from '../types';

/** "Training Officer", "Training Officer (from category)", or an em dash. */
export const budgetOwnerLabel = (budget: Budget): string => {
  if (!budget.effectiveOwnerPositionName) return '—';
  return budget.ownerInherited
    ? `${budget.effectiveOwnerPositionName} (from category)`
    : budget.effectiveOwnerPositionName;
};

/** What an empty owner picker means: "Uses the category's owner: X" or "No owner". */
export const inheritedOwnerHint = (category: BudgetCategory | undefined): string =>
  category?.ownerPositionName ? `Uses the category's owner: ${category.ownerPositionName}` : 'No owner';
