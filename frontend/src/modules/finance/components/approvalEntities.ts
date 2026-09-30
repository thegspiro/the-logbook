import { ApprovalEntityType, ApprovalStepStatus } from '../types';
import type { ApprovalStepRecord } from '../types';

export const APPROVAL_ENTITY_LABELS: Record<ApprovalEntityType, string> = {
  [ApprovalEntityType.PURCHASE_REQUEST]: 'Purchase request',
  [ApprovalEntityType.EXPENSE_REPORT]: 'Expense report',
  [ApprovalEntityType.CHECK_REQUEST]: 'Check request',
};

const DETAIL_BASE: Record<ApprovalEntityType, string> = {
  [ApprovalEntityType.PURCHASE_REQUEST]: '/finance/purchase-requests',
  [ApprovalEntityType.EXPENSE_REPORT]: '/finance/expenses',
  [ApprovalEntityType.CHECK_REQUEST]: '/finance/check-requests',
};

export const approvalEntityPath = (entityType: ApprovalEntityType, entityId: string): string =>
  `${DETAIL_BASE[entityType]}/${entityId}`;

/**
 * The step the backend will accept a decision on: the first PENDING record in
 * the order the detail endpoint returns them.
 *
 * That order is `FinanceService.get_approval_records` — step_order, then
 * created_at, then id — and `get_current_pending_step` picks the first pending
 * record from exactly that list, so taking the first one here offers the step
 * `_ensure_current_step` will accept. Do not re-sort: the timeline's sort is by
 * step_order alone and would pick differently when two steps share an order.
 */
export const findCurrentPendingStep = (steps: ApprovalStepRecord[]): ApprovalStepRecord | undefined =>
  steps.find((step) => step.status === ApprovalStepStatus.PENDING);
