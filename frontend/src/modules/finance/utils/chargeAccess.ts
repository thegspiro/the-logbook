/**
 * The editable form of a budget category's charge setting, and how a screen
 * words the rule the backend reports. Who may charge a line is decided by
 * `finance_budget_access` on the backend; nothing here re-derives it.
 */

import { ChargeAccess, type BudgetCategory } from '../types';

export interface ChargeAccessValue {
  /** `''` inherits the parent category's rule (open at the top level). */
  access: ChargeAccess | '';
  positionIds: string[];
}

/** The editable value of a category's current setting. */
export const chargeAccessValueOf = (
  category: { chargeAccess?: ChargeAccess | null; chargePositionIds?: string[] } | undefined
): ChargeAccessValue => ({
  access: category?.chargeAccess ?? '',
  positionIds: category?.chargePositionIds ?? [],
});

/** The request body for a value: named positions are only kept while restricted. */
export const chargeAccessPayloadOf = (value: ChargeAccessValue) => ({
  chargeAccess: value.access === '' ? null : value.access,
  chargePositionIds: value.access === ChargeAccess.RESTRICTED ? value.positionIds : [],
});

/** What "same as the parent category" resolves to, as the inherit choice's hint. */
export const inheritedChargeHint = (parentName: string | undefined, effective: ChargeAccess | undefined) => {
  if (!parentName || !effective) return undefined;
  return effective === ChargeAccess.RESTRICTED
    ? `${parentName} is restricted, so these lines are too.`
    : `${parentName} is open to anyone who submits requests, so these lines are too.`;
};

/** One line describing the rule a category's lines are under. */
export const chargeRuleSummary = (category: BudgetCategory, positionNames: Map<string, string>): string => {
  if (category.effectiveChargeAccess !== ChargeAccess.RESTRICTED) {
    return category.chargeAccessInheritedFrom
      ? `Anyone can charge (from ${category.chargeAccessInheritedFrom})`
      : 'Anyone can charge';
  }
  if (category.chargeAccessInheritedFrom) {
    return `Restricted (from ${category.chargeAccessInheritedFrom})`;
  }
  const named = (category.chargePositionIds ?? []).map((id) => positionNames.get(id) ?? 'Unknown position');
  return named.length > 0 ? `Restricted to the owner and ${named.join(', ')}` : 'Restricted to the owner';
};
