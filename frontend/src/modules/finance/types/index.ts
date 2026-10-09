/**
 * Finance Module Types
 *
 * TypeScript interfaces and enums for the Finance module.
 */

// =============================================================================
// Enumerations (as const pattern)
// =============================================================================

export const FiscalYearStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  CLOSED: 'closed',
} as const;
export type FiscalYearStatus = (typeof FiscalYearStatus)[keyof typeof FiscalYearStatus];

export const PurchaseRequestStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  DENIED: 'denied',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  PAID: 'paid',
  CANCELLED: 'cancelled',
} as const;
export type PurchaseRequestStatus = (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];

export const ExpenseReportStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  DENIED: 'denied',
  PAID: 'paid',
  CANCELLED: 'cancelled',
} as const;
export type ExpenseReportStatus = (typeof ExpenseReportStatus)[keyof typeof ExpenseReportStatus];

export const CheckRequestStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  DENIED: 'denied',
  ISSUED: 'issued',
  VOIDED: 'voided',
  CANCELLED: 'cancelled',
} as const;
export type CheckRequestStatus = (typeof CheckRequestStatus)[keyof typeof CheckRequestStatus];

export const DuesStatus = {
  PENDING: 'pending',
  PAID: 'paid',
  PARTIAL: 'partial',
  OVERDUE: 'overdue',
  WAIVED: 'waived',
  EXEMPT: 'exempt',
} as const;
export type DuesStatus = (typeof DuesStatus)[keyof typeof DuesStatus];

export const DuesFrequency = {
  ANNUAL: 'annual',
  SEMI_ANNUAL: 'semi_annual',
  QUARTERLY: 'quarterly',
  MONTHLY: 'monthly',
} as const;
export type DuesFrequency = (typeof DuesFrequency)[keyof typeof DuesFrequency];

export const PurchaseRequestPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
export type PurchaseRequestPriority = (typeof PurchaseRequestPriority)[keyof typeof PurchaseRequestPriority];

export const ExpenseType = {
  GENERAL: 'general',
  UNIFORM_REIMBURSEMENT: 'uniform_reimbursement',
  PPE_REPLACEMENT: 'ppe_replacement',
  BOOT_ALLOWANCE: 'boot_allowance',
  TRAINING_REIMBURSEMENT: 'training_reimbursement',
  CERTIFICATION_FEE: 'certification_fee',
  CONFERENCE: 'conference',
  TRAVEL: 'travel',
  MEALS: 'meals',
  MILEAGE: 'mileage',
  EQUIPMENT_PURCHASE: 'equipment_purchase',
  OTHER: 'other',
} as const;
export type ExpenseType = (typeof ExpenseType)[keyof typeof ExpenseType];

export const EXPENSE_TYPE_LABELS: Record<string, string> = {
  [ExpenseType.GENERAL]: 'General',
  [ExpenseType.UNIFORM_REIMBURSEMENT]: 'Uniform Reimbursement',
  [ExpenseType.PPE_REPLACEMENT]: 'PPE Replacement',
  [ExpenseType.BOOT_ALLOWANCE]: 'Boot Allowance',
  [ExpenseType.TRAINING_REIMBURSEMENT]: 'Training Reimbursement',
  [ExpenseType.CERTIFICATION_FEE]: 'Certification Fee',
  [ExpenseType.CONFERENCE]: 'Conference',
  [ExpenseType.TRAVEL]: 'Travel',
  [ExpenseType.MEALS]: 'Meals',
  [ExpenseType.MILEAGE]: 'Mileage',
  [ExpenseType.EQUIPMENT_PURCHASE]: 'Equipment Purchase',
  [ExpenseType.OTHER]: 'Other',
};

export const ApprovalStepType = {
  APPROVAL: 'approval',
  NOTIFICATION: 'notification',
} as const;
export type ApprovalStepType = (typeof ApprovalStepType)[keyof typeof ApprovalStepType];

export const ApproverType = {
  POSITION: 'position',
  PERMISSION: 'permission',
  SPECIFIC_USER: 'specific_user',
  EMAIL: 'email',
} as const;
export type ApproverType = (typeof ApproverType)[keyof typeof ApproverType];

export const ApprovalStepStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  SKIPPED: 'skipped',
  AUTO_APPROVED: 'auto_approved',
  SENT: 'sent',
} as const;
export type ApprovalStepStatus = (typeof ApprovalStepStatus)[keyof typeof ApprovalStepStatus];

export const ApprovalEntityType = {
  PURCHASE_REQUEST: 'purchase_request',
  EXPENSE_REPORT: 'expense_report',
  CHECK_REQUEST: 'check_request',
} as const;
export type ApprovalEntityType = (typeof ApprovalEntityType)[keyof typeof ApprovalEntityType];

// =============================================================================
// Status Badge Color Mappings (Tailwind classes)
// =============================================================================

export const PURCHASE_REQUEST_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  pending_approval: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  ordered: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
  received: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-400',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
};

export const EXPENSE_REPORT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  pending_approval: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
};

export const CHECK_REQUEST_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  pending_approval: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  issued: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400',
  voided: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
};

export const DUES_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  paid: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  partial: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  waived: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  exempt: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
};

export const APPROVAL_STEP_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  skipped: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  auto_approved: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-400',
  sent: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
};

/** Exact base-10 monetary value serialized by the API. */
export type DecimalString = string;
export type MonetaryAmount = DecimalString;

// =============================================================================
// Interfaces
// =============================================================================

export interface FiscalYear {
  id: string;
  organizationId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  isLocked: boolean;
  /**
   * The last day line owners may make budget requests (`YYYY-MM-DD`, the
   * department's calendar). Only a draft year carries one.
   */
  requestDeadline?: string | null;
  /** Draft, unlocked, and the deadline (if any) not yet passed — backend-decided. */
  requestsOpen?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
  sortOrder: number;
  isActive: boolean;
  qbAccountName?: string;
  /** The position answerable for this category's lines; a line without its own owner inherits it. */
  ownerPositionId?: string | null;
  ownerPositionName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  categoryId: string;
  amountBudgeted: MonetaryAmount;
  amountSpent: MonetaryAmount;
  amountEncumbered: MonetaryAmount;
  notes?: string;
  /**
   * The category's and fiscal year's names, sent with the line so a reader
   * who cannot list either (a line's owner without `finance.view`) can label it.
   */
  categoryName?: string | null;
  fiscalYearName?: string | null;
  fiscalYearStatus?: FiscalYearStatus | null;
  stationId?: string | null;
  /** The facility name — the same one the request forms label the line with. */
  stationName?: string | null;
  /** The line's own owner; null when it has none of its own. */
  ownerPositionId?: string | null;
  ownerPositionName?: string | null;
  /** Who owns the line: its own owner, else its category's (backend-resolved). */
  effectiveOwnerPositionId?: string | null;
  effectiveOwnerPositionName?: string | null;
  /** True when the owner comes from the category rather than the line. */
  ownerInherited?: boolean;
  /**
   * `amountBudgeted` less the line's amendments — what the line started at.
   * Derived by the backend, never stored; `amountBudgeted` is the current budget.
   */
  originalAmount?: MonetaryAmount;
  /** The sum of the line's amendments. */
  amendmentsTotal?: MonetaryAmount;
  amendmentCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A line the signed-in member owns, as "My budgets" lists it. The backend
 * decides which lines those are (`finance_budget_ownership.py`) and reports
 * what is left and the share used; the page shows them, it does not re-derive
 * them (CLAUDE.md pitfall #29).
 */
export interface MyBudget extends Budget {
  amountRemaining: MonetaryAmount;
  /** Spent plus committed (encumbered), over the current budget, in percent. */
  percentUsed: number;
}

export interface MyBudgetsSummary {
  /** The member owns at least one budget line, in any fiscal year. */
  ownsAny: boolean;
  /**
   * The member owns a line in a draft fiscal year, or has a budget request for
   * one — the "Next year's budget" navigation entry's signal.
   */
  plansNextYear?: boolean;
}

/** What moved a line's totals: a purchase request, check request or expense item. */
export type BudgetTransactionKind = 'purchase_request' | 'check_request' | 'expense_report';

/** `none` is a voided check — once spent, since reversed. */
export type BudgetTransactionEffect = 'spent' | 'encumbered' | 'none';

export interface BudgetTransaction {
  /** The row: the request itself, or an expense report's line item. */
  id: string;
  kind: BudgetTransactionKind;
  /** The purchase request, check request or expense report it came from. */
  entityId: string;
  number: string;
  description?: string | null;
  /** Vendor, payee or merchant. */
  counterparty?: string | null;
  requesterName?: string | null;
  status: string;
  amount: MonetaryAmount;
  effect: BudgetTransactionEffect;
  occurredAt?: string | null;
}

export interface BudgetTransactionPage {
  items: BudgetTransaction[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Extra money leadership approved for a budget line — an audit record.
 *
 * A mistaken amendment is corrected by a reversing entry, never edited: a
 * row with a negative `amount` (`isReversal`) naming the amendment it
 * cancels in `reversesAmendmentId`. The reversed amendment carries the
 * reversal's id, when it was entered and by whom.
 */
export interface BudgetAmendment {
  id: string;
  organizationId: string;
  budgetId: string;
  amount: MonetaryAmount;
  reason: string;
  approvedBy: string;
  /** The approval date, a calendar date ("YYYY-MM-DD"). */
  approvedOn: string;
  createdBy?: string | null;
  enteredByName?: string | null;
  createdAt: string;
  /** On a reversal: the amendment it cancels. */
  reversesAmendmentId?: string | null;
  isReversal?: boolean;
  /** On a reversed amendment: the reversal, when it was entered and by whom. */
  reversedByAmendmentId?: string | null;
  reversedAt?: string | null;
  reversedByName?: string | null;
}

/** `POST /finance/budgets/:id/amendments`. Every field is required. */
export interface BudgetAmendmentCreatePayload {
  amount: MonetaryAmount;
  reason: string;
  approvedBy: string;
  approvedOn: string;
}

/**
 * `POST /finance/budgets/:id/amendments/:amendmentId/reverse`. Every field is
 * required; the amount is the whole amendment's, taken by the backend.
 */
export interface BudgetAmendmentReversePayload {
  reason: string;
  approvedBy: string;
  approvedOn: string;
}

/** The new amendment (or reversal) and the line as it now stands. */
export interface BudgetAmendmentCreated {
  amendment: BudgetAmendment;
  budget: Budget;
}

/** `PUT /finance/budget-categories/:id`. Omitted leaves a field alone; `null` clears it. */
export interface BudgetCategoryUpdatePayload {
  name?: string;
  description?: string | null;
  parentCategoryId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  qbAccountName?: string | null;
  ownerPositionId?: string | null;
}

/** `POST /finance/budgets`. Blank optional fields are omitted. */
export interface BudgetCreatePayload {
  fiscalYearId: string;
  categoryId: string;
  amountBudgeted: MonetaryAmount;
  notes?: string | undefined;
  stationId?: string | undefined;
  ownerPositionId?: string | undefined;
}

/**
 * `PUT /finance/budgets/:id`. An omitted key leaves the field alone; `null`
 * clears it (a cleared owner falls back to the category's).
 */
export interface BudgetUpdatePayload {
  amountBudgeted?: MonetaryAmount;
  notes?: string | null;
  stationId?: string | null;
  ownerPositionId?: string | null;
}

/** An id and a name — `GET /finance/position-options` and `/finance/station-options`. */
export interface FinanceNamedOption {
  id: string;
  name: string;
}

/**
 * A budget line as the request forms offer it — `GET /finance/budgets/options`.
 * All a member holding only `finance.request` sees of a budget.
 */
export interface BudgetOption {
  id: string;
  /** Category name, plus the station when the line has one. */
  label: string;
  amountRemaining: MonetaryAmount;
}

/** An active or draft fiscal year — `GET /finance/fiscal-years/options`. */
export interface FiscalYearOption {
  id: string;
  name: string;
  status: FiscalYearStatus;
  requestDeadline?: string | null;
  requestsOpen?: boolean;
}

/** `PUT /finance/fiscal-years/{id}`. A `null` deadline clears it (CLAUDE.md pitfall #1). */
export interface FiscalYearUpdatePayload {
  name?: string;
  startDate?: string;
  endDate?: string;
  requestDeadline?: string | null;
}

/** What "Start from last year" did: lines copied, and lines the draft already had. */
export interface StartFromLastYearResult {
  created: number;
  skipped: number;
}

// =============================================================================
// Budget requests (next year's amounts, proposed by line owners)
// =============================================================================

export const BudgetRequestStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  ADJUSTED: 'adjusted',
  DECLINED: 'declined',
} as const;
export type BudgetRequestStatus = (typeof BudgetRequestStatus)[keyof typeof BudgetRequestStatus];

export const BudgetRequestDecisionKind = {
  APPROVE: 'approve',
  ADJUST: 'adjust',
  DECLINE: 'decline',
} as const;
export type BudgetRequestDecisionKind = (typeof BudgetRequestDecisionKind)[keyof typeof BudgetRequestDecisionKind];

export interface BudgetRequest {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  fiscalYearName?: string | null;
  /** The draft-year line; set on a proposal once it is approved. */
  budgetId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  stationId?: string | null;
  stationName?: string | null;
  /** "Category · Station", or the category alone. */
  lineLabel: string;
  /** True when the request proposed a line that did not exist. */
  isProposedLine: boolean;
  ownerPositionId?: string | null;
  ownerPositionName?: string | null;
  requestedAmount: MonetaryAmount;
  approvedAmount?: MonetaryAmount | null;
  status: BudgetRequestStatus;
  justification: string;
  decisionNote?: string | null;
  submittedBy?: string | null;
  submittedByName?: string | null;
  submittedAt?: string | null;
  decidedBy?: string | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  /** The active year's figures for the same category and station ("this year"). */
  lastYearFiscalYearName?: string | null;
  lastYearBudgeted?: MonetaryAmount | null;
  lastYearSpent?: MonetaryAmount | null;
  createdAt: string;
  updatedAt: string;
}

/** Either `budgetId`, or `categoryId` (+ `stationId`) and `ownerPositionId` for a new line. */
export interface BudgetRequestCreatePayload {
  fiscalYearId: string;
  budgetId?: string | undefined;
  categoryId?: string | undefined;
  stationId?: string | undefined;
  ownerPositionId?: string | undefined;
  requestedAmount: MonetaryAmount;
  justification: string;
}

export interface BudgetRequestUpdatePayload {
  requestedAmount?: MonetaryAmount;
  justification?: string;
}

/** `adjust` needs `approvedAmount` and `decisionNote`; `decline` needs `decisionNote`. */
export interface BudgetRequestDecisionPayload {
  decision: BudgetRequestDecisionKind;
  approvedAmount?: MonetaryAmount | undefined;
  decisionNote?: string | undefined;
}

export interface MyBudgetRequestLine {
  budget: Budget;
  request: BudgetRequest | null;
  lastYearFiscalYearName?: string | null;
  lastYearBudgeted?: MonetaryAmount | null;
  lastYearSpent?: MonetaryAmount | null;
}

/**
 * `GET /finance/budget-requests/proposal-options` — what "Propose a new line"
 * may offer. The positions are only those the member holds; all three lists
 * are empty for a member who holds none.
 */
export interface BudgetRequestProposalOptions {
  positions: FinanceNamedOption[];
  categories: FinanceNamedOption[];
  stations: FinanceNamedOption[];
}

/** `GET /finance/budget-requests/my-lines` — one call for the owner's screen. */
export interface MyBudgetRequestLines {
  fiscalYear: FiscalYearOption;
  lines: MyBudgetRequestLine[];
}

export interface BudgetSummary {
  totalBudgeted: MonetaryAmount;
  totalSpent: MonetaryAmount;
  totalEncumbered: MonetaryAmount;
  totalRemaining: MonetaryAmount;
  percentUsed: number;
  categoryBreakdown: Record<string, unknown>[];
}

export interface ApprovalChainStep {
  id: string;
  chainId: string;
  stepOrder: number;
  name: string;
  stepType: ApprovalStepType;
  approverType?: ApproverType;
  approverValue?: string;
  notificationEmails?: string[];
  emailTemplateId?: string;
  allowSelfApproval: boolean;
  autoApproveUnder?: MonetaryAmount;
  required: boolean;
  createdAt: string;
}

export interface ApprovalChain {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  appliesTo: ApprovalEntityType;
  minAmount?: MonetaryAmount;
  maxAmount?: MonetaryAmount;
  budgetCategoryId?: string;
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  steps: ApprovalChainStep[];
}

// Approval-chain request bodies are snake_case. The backend's Finance request
// schemas accept either snake_case or camelCase keys (the other Finance pages
// send camelCase); these stay snake_case, which the backend reads by field name.

export interface ApprovalChainCreatePayload {
  name: string;
  description?: string | undefined;
  applies_to: ApprovalEntityType;
  min_amount?: string | undefined;
  max_amount?: string | undefined;
  budget_category_id?: string | undefined;
  is_default?: boolean | undefined;
}

export interface ApprovalChainUpdatePayload {
  name?: string;
  description?: string | null;
  is_active?: boolean;
}

export interface ApprovalChainStepCreatePayload {
  step_order: number;
  name: string;
  step_type: ApprovalStepType;
  approver_type?: ApproverType | undefined;
  approver_value?: string | undefined;
  allow_self_approval: boolean;
  auto_approve_under?: string | undefined;
}

export interface ApprovalChainStepUpdatePayload {
  step_order?: number;
  name?: string;
  step_type?: ApprovalStepType;
  approver_type?: ApproverType | null;
  approver_value?: string | null;
  allow_self_approval?: boolean;
  auto_approve_under?: string | null;
}

export interface ApprovalStepRecord {
  id: string;
  chainId: string;
  stepId: string;
  entityType: ApprovalEntityType;
  entityId: string;
  status: ApprovalStepStatus;
  assignedTo?: string;
  actedBy?: string;
  actedAt?: string;
  notes?: string;
  stepName?: string;
  stepOrder?: number;
  createdAt: string;
  /** Who the step waits on, as a person would name it (e.g. "Treasurer position"). */
  assigneeLabel?: string | null;
  /**
   * For the viewer, decided by the backend's approver matching: true only on
   * the step the request is waiting on, when the viewer is its named approver.
   * Separation of duties is not folded in — the approve call still refuses a
   * requester with its own message.
   */
  canAct?: boolean;
  /** True only for an approvals admin who is not the named approver: they may act by giving an override reason. */
  requiresOverride?: boolean;
}

export interface PendingApproval {
  stepRecordId: string;
  entityType: ApprovalEntityType;
  entityId: string;
  entityTitle: string;
  entityAmount: MonetaryAmount;
  requesterName: string;
  stepName: string;
  stepOrder: number;
  submittedAt: string;
  approverType?: ApproverType | null;
  approverValue?: string | null;
  /** Who the step waits on, as a person would name it. */
  assigneeLabel: string;
  /** The viewer is the step's named approver. */
  canAct: boolean;
  /** The viewer is an approvals admin who is not the named approver, and must give an override reason to act. */
  requiresOverride: boolean;
}

/** Why nobody can act on an approval step, from the approver-coverage report. */
export const ApproverCoverageProblem = {
  NO_VALUE: 'no_value',
  NOT_FOUND: 'not_found',
  NO_ACTIVE_MEMBERS: 'no_active_members',
  INVALID_EMAIL: 'invalid_email',
} as const;
export type ApproverCoverageProblem = (typeof ApproverCoverageProblem)[keyof typeof ApproverCoverageProblem];

/** One approval step, and whether anybody can act on it (`GET /finance/approval-chains/approver-coverage`). */
export interface ApproverCoverageRow {
  chainId: string;
  chainName: string;
  chainIsActive: boolean;
  stepId: string;
  stepName: string;
  stepOrder: number;
  approverType: ApproverType | null;
  approverValue: string | null;
  assigneeLabel: string;
  eligibleActiveCount: number;
  problem: ApproverCoverageProblem | null;
  pendingRequestCount: number;
}

/** A request waiting for approval that no approval chain applies to, so it has no steps. */
export interface UnroutedApproval {
  entityType: ApprovalEntityType;
  entityId: string;
  entityTitle: string;
  entityAmount: MonetaryAmount;
  requesterName: string;
  submittedAt: string;
}

export interface PurchaseRequest {
  id: string;
  organizationId: string;
  requestNumber: string;
  fiscalYearId: string;
  budgetId?: string | null;
  requestedBy: string;
  title: string;
  description?: string | null;
  vendor?: string | null;
  estimatedAmount: MonetaryAmount;
  actualAmount?: MonetaryAmount;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  approvedBy?: string;
  approvedAt?: string;
  denialReason?: string;
  orderedAt?: string;
  receivedAt?: string;
  paidAt?: string;
  notes?: string;
  /** A typed link; the server passes it on only if it is HTTP(S). */
  receiptUrl?: string | null;
  /** The uploaded receipt, opened through `receiptFileUrl`. */
  receiptDocumentId?: string | null;
  receiptFileUrl?: string | null;
  apparatusId?: string;
  facilityId?: string;
  createdAt: string;
  updatedAt: string;
  approvalSteps: ApprovalStepRecord[];
}

export interface ExpenseLineItem {
  id: string;
  expenseReportId: string;
  budgetId?: string;
  description: string;
  amount: MonetaryAmount;
  dateIncurred: string;
  expenseType: ExpenseType;
  receiptUrl?: string | null;
  receiptDocumentId?: string | null;
  receiptFileUrl?: string | null;
  merchant?: string;
  createdAt: string;
}

export interface ExpenseReport {
  id: string;
  organizationId: string;
  reportNumber: string;
  submittedBy: string;
  fiscalYearId: string;
  title: string;
  description?: string;
  totalAmount: MonetaryAmount;
  status: ExpenseReportStatus;
  approvedBy?: string;
  approvedAt?: string;
  denialReason?: string;
  paidAt?: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lineItems: ExpenseLineItem[];
  approvalSteps: ApprovalStepRecord[];
}

export interface CheckRequest {
  id: string;
  organizationId: string;
  requestNumber: string;
  requestedBy: string;
  fiscalYearId: string;
  budgetId?: string;
  payeeName: string;
  payeeAddress?: string;
  amount: MonetaryAmount;
  memo?: string;
  purpose?: string;
  status: CheckRequestStatus;
  approvedBy?: string;
  approvedAt?: string;
  denialReason?: string;
  checkNumber?: string;
  checkDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  approvalSteps: ApprovalStepRecord[];
}

export interface DuesSchedule {
  id: string;
  organizationId: string;
  name: string;
  amount: MonetaryAmount;
  frequency: DuesFrequency;
  dueDate: string;
  gracePeriodDays: number;
  lateFeeAmount?: MonetaryAmount;
  fiscalYearId?: string;
  appliesToMembershipTypes?: string[];
  isActive: boolean;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberDues {
  id: string;
  organizationId: string;
  duesScheduleId: string;
  userId: string;
  amountDue: MonetaryAmount;
  amountPaid: MonetaryAmount;
  status: DuesStatus;
  dueDate: string;
  paidDate?: string;
  paymentMethod?: string;
  transactionReference?: string;
  lateFeeApplied?: MonetaryAmount;
  waivedBy?: string;
  waivedAt?: string;
  waiveReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuesSummary {
  totalExpected: MonetaryAmount;
  totalCollected: MonetaryAmount;
  totalOutstanding: MonetaryAmount;
  totalWaived: MonetaryAmount;
  collectionRate: number;
  membersPaid: number;
  membersOverdue: number;
  membersWaived: number;
}

export const ExportMappingType = {
  EXPENSE: 'expense',
  INCOME: 'income',
  ASSET: 'asset',
} as const;
export type ExportMappingType = (typeof ExportMappingType)[keyof typeof ExportMappingType];

export interface ExportMapping {
  id: string;
  organizationId: string;
  internalCategory: string;
  qbAccountName: string;
  qbAccountNumber?: string | null;
  qbOffsetAccountName?: string | null;
  mappingType: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /finance/export/mappings`. Blank optional fields are omitted. */
export interface ExportMappingCreatePayload {
  internalCategory: string;
  qbAccountName: string;
  qbAccountNumber?: string | undefined;
  qbOffsetAccountName?: string | undefined;
  mappingType: ExportMappingType;
}

/** `PUT /finance/export/mappings/:id`. Omitted leaves a field alone; `null` clears it. */
export interface ExportMappingUpdatePayload {
  internalCategory?: string;
  qbAccountName?: string;
  qbAccountNumber?: string | null;
  qbOffsetAccountName?: string | null;
  mappingType?: ExportMappingType;
}

/** Why the export would refuse a category, as `GET /finance/export/readiness` reports it. */
export const ExportReadinessStatus = {
  READY: 'ready',
  NO_ACCOUNT: 'no_account',
  NO_OFFSET: 'no_offset',
  DUPLICATE_MAPPINGS: 'duplicate_mappings',
} as const;
export type ExportReadinessStatus = (typeof ExportReadinessStatus)[keyof typeof ExportReadinessStatus];

export interface ExportReadinessCategory {
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  status: ExportReadinessStatus;
  accountName?: string | null;
  /** `category` when the category names its own account, else `mapping`. */
  accountSource?: 'category' | 'mapping' | null;
  offsetAccountName?: string | null;
  mappingIds: string[];
}

export interface ExportReadiness {
  categories: ExportReadinessCategory[];
  /** Mappings whose category name matches no budget category: the export never uses them. */
  unmatchedMappingIds: string[];
}

export interface ExportLog {
  id: string;
  organizationId: string;
  exportType: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  recordCount: number;
  fileFormat: string;
  exportedBy: string;
  exportedAt: string;
}

export interface FinanceDashboard {
  budgetHealth: BudgetSummary;
  pendingApprovalsCount: number;
  pendingPurchaseRequests: number;
  pendingExpenseReports: number;
  pendingCheckRequests: number;
  duesCollectionRate: number;
  recentTransactions: Record<string, unknown>[];
}
