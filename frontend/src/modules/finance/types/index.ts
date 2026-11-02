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

export const BudgetAmendmentStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
} as const;
export type BudgetAmendmentStatus = (typeof BudgetAmendmentStatus)[keyof typeof BudgetAmendmentStatus];

export const PurchaseRequestStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  DENIED: 'denied',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  PAID: 'paid',
  /** Bought by the requester and paid back through an expense report. */
  REIMBURSED: 'reimbursed',
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

/** One step a request would wait on, named as its timeline would name it. */
export interface ApprovalRouteStep {
  name: string;
  stepOrder: number;
  stepType: ApprovalStepType;
  /** Who the step waits on; null on a notification step. */
  assigneeLabel?: string | null;
  /** The amount falls under the step's auto-approve limit. */
  autoApproved: boolean;
}

/** Who a request would wait on if it were submitted now (`GET /finance/approval-chains/route-preview`). */
export interface ApprovalRoutePreview {
  chainName?: string | null;
  /** No chain applies: a finance approver decides by hand. */
  manual: boolean;
  steps: ApprovalRouteStep[];
  /** At or over the department's dual-approval threshold. */
  secondApproverRequired: boolean;
}

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
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  reimbursed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
};

export const EXPENSE_REPORT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  pending_approval: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
};

export const CHECK_REQUEST_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  pending_approval: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  issued: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
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
  /** Draft, unlocked, taking requests, and the deadline (if any) not yet passed — backend-decided. */
  requestsOpen?: boolean;
  /** Where a draft year's budget is on its way to adoption; null unless a draft. */
  planningStage?: BudgetPlanningStage | null;
  /** The board's adoption, recorded from board review (`YYYY-MM-DD`). */
  adoptedOn?: string | null;
  adoptionReference?: string | null;
  adoptionNotes?: string | null;
  adoptionRecordedBy?: string | null;
  adoptionRecordedAt?: string | null;
  /** When the year-end close began; a closed year that is not locked is closing. */
  closingStartedAt?: string | null;
  /** The active year's end date has passed and its close has not begun — backend-decided. */
  closeDue?: boolean;
  /** The Treasurer's reconciliation sign-off that locked the year. */
  lockedBy?: string | null;
  lockedAt?: string | null;
  lockNotes?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A draft year's planning stage. Owners request amounts, then the Treasurer
 * closes the draft for senior leadership's review, then it goes before the
 * board. Recording the board's vote makes it `adopted`, where it waits for
 * the Treasurer to start the year.
 */
export const BudgetPlanningStage = {
  REQUESTS: 'requests',
  LEADERSHIP_REVIEW: 'leadership_review',
  BOARD_REVIEW: 'board_review',
  ADOPTED: 'adopted',
} as const;
export type BudgetPlanningStage = (typeof BudgetPlanningStage)[keyof typeof BudgetPlanningStage];

/** `POST /finance/fiscal-years/{id}/adopt`: the board's vote. */
export interface FiscalYearAdoptionPayload {
  adoptedOn: string;
  adoptionReference: string;
  adoptionNotes?: string | undefined;
}

/** `POST /finance/fiscal-years/{id}/lock`: the Treasurer's reconciliation sign-off. */
export interface FiscalYearLockPayload {
  notes: string;
}

/** A request still in flight that stops a closing year from locking. */
export interface FiscalYearOpenItem {
  /** For `budget_amendment`, `entityId` is the budget line, not the amendment. */
  kind: 'purchase_request' | 'expense_report' | 'check_request' | 'budget_amendment';
  entityId: string;
  number: string;
  description: string;
  status: string;
  amount?: number | string | null;
}

/**
 * What an expense was for, as IRS Form 990 Part IX reports it. Fundraising is
 * the cost of raising money, not what the money raised buys.
 */
export const FunctionalClass = {
  PROGRAM: 'program',
  MANAGEMENT_GENERAL: 'management_general',
  FUNDRAISING: 'fundraising',
} as const;
export type FunctionalClass = (typeof FunctionalClass)[keyof typeof FunctionalClass];

export const isFunctionalClass = (value: string | null | undefined): value is FunctionalClass =>
  (Object.values(FunctionalClass) as string[]).includes(value ?? '');

export const FUNCTIONAL_CLASS_LABELS: Record<FunctionalClass, string> = {
  [FunctionalClass.PROGRAM]: 'Program services',
  [FunctionalClass.MANAGEMENT_GENERAL]: 'Management & general',
  [FunctionalClass.FUNDRAISING]: 'Fundraising',
};

/** Who may charge a category's lines on a request. `null` on a category inherits its parent's. */
export const ChargeAccess = {
  OPEN: 'open',
  RESTRICTED: 'restricted',
} as const;
export type ChargeAccess = (typeof ChargeAccess)[keyof typeof ChargeAccess];

export const isChargeAccess = (value: string | null | undefined): value is ChargeAccess =>
  (Object.values(ChargeAccess) as string[]).includes(value ?? '');

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
  /** Default for payments against its lines; null inherits the parent category's. */
  functionalClass?: FunctionalClass | null;
  /** The category's own charge setting; null inherits its parent's. */
  chargeAccess?: ChargeAccess | null;
  /** The rule its lines are actually under, as the backend resolved it. */
  effectiveChargeAccess?: ChargeAccess;
  /** The ancestor the rule comes from when it is inherited; null otherwise. */
  chargeAccessInheritedFrom?: string | null;
  /** Positions this category names as able to charge it while restricted. */
  chargePositionIds?: string[];
  /** Category names from the top-level category down to this one. */
  path?: string[];
  /**
   * The inactive ancestor that closes this otherwise-active category to new
   * charges, budget lines and proposals, as the backend resolved it; null when
   * nothing above it is inactive (or it is inactive itself).
   */
  inactiveThrough?: string | null;
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
  /** The sum of the line's confirmed amendments. */
  amendmentsTotal?: MonetaryAmount;
  /** Confirmed amendments only. */
  amendmentCount?: number;
  /** Amendments entered and awaiting a second officer's confirmation. */
  pendingAmendmentCount?: number;
  /**
   * Whether `amountBudgeted` may be edited directly. False from board review
   * on, and in an active, closing or locked year: from then the amount moves
   * only through a confirmed amendment.
   */
  amountEditable?: boolean;
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
 * Entered `pending`; it moves the line's budget only once a second officer
 * (`finance.budget_review` or `finance.manage`, never whoever entered it)
 * confirms it. A rejected one is kept, with the reason, and moves nothing.
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
  /** On a reversed amendment: whether its reversal is pending or confirmed. */
  reversalStatus?: BudgetAmendmentStatus | null;
  status?: BudgetAmendmentStatus;
  /** Who confirmed or rejected it, when, and (on a rejection) why. */
  decidedBy?: string | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

/** `POST /finance/budgets/:id/amendments/:amendmentId/reject`. */
export interface BudgetAmendmentRejectPayload {
  note: string;
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
  functionalClass?: FunctionalClass | null;
  chargeAccess?: ChargeAccess | null;
  chargePositionIds?: string[];
}

/** `PUT /finance/budget-categories/:id/charge-access` — the whole setting at once. */
export interface ChargeAccessPayload {
  chargeAccess: ChargeAccess | null;
  chargePositionIds: string[];
}

/** `GET /finance/charge-access`: the categories the caller may set, and the positions. */
export interface ChargeAccessSettings {
  categories: BudgetCategory[];
  positions: FinanceNamedOption[];
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
 * All a member holding only `finance.request` sees of a budget: the name, and
 * no amount. `amountRemaining` is null unless the server allows the caller to
 * see it (`finance.view` / `finance.manage`, or the line's owner).
 */
export interface BudgetOption {
  id: string;
  /** Category name, plus the station when the line has one. */
  label: string;
  amountRemaining: MonetaryAmount | null;
  /**
   * False when the line's category is inactive. Such a line takes no new
   * charges (the server refuses it), so a picker shows it only as a
   * request's existing selection — see `selectableBudgetOptions`.
   */
  categoryActive: boolean;
}

/** An active or draft fiscal year — `GET /finance/fiscal-years/options`. */
export interface FiscalYearOption {
  id: string;
  name: string;
  status: FiscalYearStatus;
  requestDeadline?: string | null;
  requestsOpen?: boolean;
  planningStage?: BudgetPlanningStage | null;
}

/** `PUT /finance/fiscal-years/{id}`. A `null` deadline clears it (CLAUDE.md pitfall #1). */
export interface FiscalYearUpdatePayload {
  name?: string;
  startDate?: string;
  endDate?: string;
  requestDeadline?: string | null;
}

/**
 * What "Start from last year" did: lines copied, lines the draft already had,
 * and lines left behind because their category is retired.
 */
export interface StartFromLastYearResult {
  created: number;
  skipped: number;
  retired: number;
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
  /** Senior leadership's change during leadership review; the line holds this amount when set. */
  reviewAmount?: MonetaryAmount | null;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
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
/** `POST /finance/budget-requests/{id}/review` — senior leadership's amount and why. */
export interface BudgetRequestReviewPayload {
  amount: MonetaryAmount;
  note: string;
}

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
  /** Expense reports: lines submitted after the substantiation deadline; approving must acknowledge them. */
  lateLineCount?: number;
  /** How far it would take its restricted funds past what they have left; null when it fits. */
  fundShortfall?: MonetaryAmount | null;
  /** An "email" approver step's link, as the backend reads it; null for every other step. */
  emailDelivery?: ApprovalEmailDelivery | null;
  /** When the last send was attempted; null when none was recorded. */
  emailStatusAt?: string | null;
  /** Named back by a re-send, so a repeated one sends nothing. */
  emailLinkVersion?: number;
  /** The viewer may re-send the link (an approvals admin, on an email step). */
  canResendEmail?: boolean;
}

/** The state of an emailed approval link (`PendingApproval.emailDelivery`). */
export const ApprovalEmailDelivery = {
  SENT: 'sent',
  FAILED: 'failed',
  EXPIRED: 'expired',
  NOT_SENT: 'not_sent',
  /** A live link emailed before send status was recorded. */
  UNKNOWN: 'unknown',
} as const;
export type ApprovalEmailDelivery = (typeof ApprovalEmailDelivery)[keyof typeof ApprovalEmailDelivery];

/** `POST /finance/approvals/{id}/resend-email`: the link's state afterwards, never the link. */
export interface ApprovalEmailResendResult {
  stepRecordId: string;
  /** False when another re-send had already replaced the link. */
  resent: boolean;
  emailDelivery: ApprovalEmailDelivery | null;
  emailStatusAt: string | null;
  emailLinkVersion: number;
}

/** Why nobody can act on an approval step, from the approver-coverage report. */
export const ApproverCoverageProblem = {
  NO_VALUE: 'no_value',
  NOT_FOUND: 'not_found',
  NO_ACTIVE_MEMBERS: 'no_active_members',
  INVALID_EMAIL: 'invalid_email',
  /** Someone fills the step, but none of them holds finance.approve. */
  NO_APPROVE_PERMISSION: 'no_approve_permission',
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
  /** Held for a second, different approver by the dual-approval threshold. */
  awaitingSecondApproval?: boolean;
  firstApprovedBy?: string | null;
  /** Expense reports: lines submitted after the substantiation deadline. */
  lateLineCount?: number;
  /** Held until an approver acknowledges the late lines. */
  awaitingLateAcknowledgement?: boolean;
  /** How far it would take its restricted funds past what they have left; null when it fits. */
  fundShortfall?: MonetaryAmount | null;
}

export const SubstantiationMode = {
  OFF: 'off',
  WARN: 'warn',
  BLOCK: 'block',
} as const;
export type SubstantiationMode = (typeof SubstantiationMode)[keyof typeof SubstantiationMode];

/** `GET /finance/settings`: the finance rules the server applies. */
export interface FinanceSettings {
  /**
   * Requests of this amount or more need two different approvers; null is off.
   * Changed through organization settings (`settings.manage`), not here.
   */
  dualApprovalThreshold: MonetaryAmount | null;
  /** The accountable-plan deadline for expense reports. */
  substantiationMode: SubstantiationMode;
  /** Days allowed between incurring an expense and submitting it (1-60). */
  substantiationDays: number;
  /** A payment charged to a restricted fund for more than it has left. */
  fundOverspendMode: FundOverspendMode;
}

export const FundOverspendMode = {
  OFF: 'off',
  WARN: 'warn',
  BLOCK: 'block',
} as const;
export type FundOverspendMode = (typeof FundOverspendMode)[keyof typeof FundOverspendMode];

export interface PurchaseRequest extends FunctionalClassFields, FundFields {
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
  /**
   * A first approval held for a second, different approver by the
   * department's dual-approval threshold, and whether the request is waiting
   * on that second approval (detail responses only).
   */
  firstApprovedBy?: string | null;
  firstApprovedAt?: string | null;
  awaitingSecondApproval?: boolean;
  denialReason?: string;
  orderedAt?: string;
  receivedAt?: string;
  paidAt?: string;
  /** When a complete QuickBooks export last carried this payment. */
  qbExportedAt?: string | null;
  notes?: string;
  /** A typed link; the server passes it on only if it is HTTP(S). */
  receiptUrl?: string | null;
  /** The uploaded receipt, opened through `receiptFileUrl`. */
  receiptDocumentId?: string | null;
  receiptFileUrl?: string | null;
  apparatusId?: string;
  facilityId?: string;
  /** The expense report claiming this purchase back for the requester, while one does (detail responses only). */
  reimbursementReportId?: string | null;
  reimbursementReportNumber?: string | null;
  reimbursementReportStatus?: ExpenseReportStatus | null;
  createdAt: string;
  updatedAt: string;
  approvalSteps: ApprovalStepRecord[];
}

/** Claiming back an approved purchase; each field defaults to the request's own. */
export interface ReimbursementReportPayload {
  amount?: MonetaryAmount | undefined;
  dateIncurred?: string | undefined;
  merchant?: string | undefined;
}

/** Paying an approved expense report by check, to the member who filed it. */
export interface ReimbursementCheckPayload {
  payeeAddress?: string | undefined;
  memo?: string | undefined;
}

export interface ExpenseLineItem extends FunctionalClassFields, FundFields {
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
  /** Submitted after the department's substantiation deadline; decided at submission. */
  substantiatedLate?: boolean;
  createdAt: string;
}

/** An edit to a draft report's line: omit a field to leave it, null to clear an optional one. */
export interface ExpenseLineItemUpdatePayload {
  description?: string | undefined;
  amount?: MonetaryAmount | undefined;
  dateIncurred?: string | undefined;
  expenseType?: ExpenseType | undefined;
  merchant?: string | null | undefined;
  fundCampaignId?: string | null | undefined;
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
  /**
   * A first approval held for a second, different approver by the
   * department's dual-approval threshold, and whether the request is waiting
   * on that second approval (detail responses only).
   */
  firstApprovedBy?: string | null;
  firstApprovedAt?: string | null;
  awaitingSecondApproval?: boolean;
  denialReason?: string;
  paidAt?: string;
  paymentMethod?: string;
  /** When a complete QuickBooks export last carried this payment. */
  qbExportedAt?: string | null;
  notes?: string;
  /** When the member submitted it; null before submission was recorded. */
  submittedAt?: string | null;
  /** The member's cash advance this report accounts for. */
  advanceId?: string | null;
  /** How much of the report the advance covers, fixed on submission; the rest is reimbursed. */
  advanceApplied?: MonetaryAmount | null;
  /** Lines submitted after the department's substantiation deadline. */
  lateLineCount?: number;
  /** The first approver who confirmed reviewing the late lines (null for an emailed approval). */
  lateAcknowledgedBy?: string | null;
  lateAcknowledgedAt?: string | null;
  /** Held until an approver acknowledges the late lines (detail responses only). */
  awaitingLateAcknowledgement?: boolean;
  /** How far its lines would take their restricted funds past what they have left, until approved (detail responses only). */
  fundShortfall?: MonetaryAmount | null;
  /** The purchase request this report claims back. */
  purchaseRequestId?: string | null;
  purchaseRequestNumber?: string | null;
  /** The check paying the member, while one does (detail responses only). */
  reimbursementCheckId?: string | null;
  reimbursementCheckNumber?: string | null;
  reimbursementCheckStatus?: CheckRequestStatus | null;
  /** What a check would pay: the total less what a cash advance covered (detail responses only). */
  amountOwed?: MonetaryAmount | null;
  createdAt: string;
  updatedAt: string;
  lineItems: ExpenseLineItem[];
  approvalSteps: ApprovalStepRecord[];
}

export interface CheckRequest extends FunctionalClassFields, FundFields {
  id: string;
  organizationId: string;
  requestNumber: string;
  requestedBy: string;
  fiscalYearId: string;
  budgetId?: string;
  /** Cash advanced to the requester ahead of an expense; charges no budget line or fund. */
  isAdvance?: boolean;
  payeeName: string;
  payeeAddress?: string;
  amount: MonetaryAmount;
  memo?: string;
  purpose?: string;
  status: CheckRequestStatus;
  approvedBy?: string;
  approvedAt?: string;
  /**
   * A first approval held for a second, different approver by the
   * department's dual-approval threshold, and whether the request is waiting
   * on that second approval (detail responses only).
   */
  firstApprovedBy?: string | null;
  firstApprovedAt?: string | null;
  awaitingSecondApproval?: boolean;
  denialReason?: string;
  checkNumber?: string;
  checkDate?: string;
  voidedAt?: string | null;
  /** When a complete QuickBooks export last carried this payment. */
  qbExportedAt?: string | null;
  /** When the reversing entry for a void went to QuickBooks. */
  qbVoidExportedAt?: string | null;
  /** The expense report this check reimburses the member for; it charges no budget line or fund itself. */
  expenseReportId?: string | null;
  expenseReportNumber?: string | null;
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
  /** QuickBooks accounts for its payments; null takes the department's default. */
  qbIncomeAccount?: string | null;
  qbDepositAccount?: string | null;
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
  /** The member's display name. Sent by the list endpoint only. */
  memberName?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /finance/dues-schedules`. Blank optional fields are omitted. */
export interface DuesScheduleCreatePayload {
  name: string;
  amount: string;
  frequency: DuesFrequency;
  /** UTC instant of the due date. */
  dueDate: string;
  notes?: string | undefined;
  qbIncomeAccount?: string | undefined;
  qbDepositAccount?: string | undefined;
}

/** `PUT /finance/dues-schedules/:id`. Omitted leaves a field alone; `null` clears it. */
export interface DuesScheduleUpdatePayload {
  name?: string;
  amount?: string;
  frequency?: DuesFrequency;
  dueDate?: string;
  isActive?: boolean;
  notes?: string | null;
  qbIncomeAccount?: string | null;
  qbDepositAccount?: string | null;
}

/** `PUT /finance/dues/:id` — appends one payment to the member's ledger. */
export interface DuesPaymentPayload {
  amountPaid: string;
  paymentMethod?: string | undefined;
  transactionReference?: string | undefined;
  notes?: string | undefined;
  /** Confirms that what exceeds the balance is recorded as a donation (W66-3). */
  excessAsDonation?: boolean | undefined;
}

/** One payment in a member's dues ledger (`GET /finance/dues/:id/payments`). */
export interface DuesPayment {
  id: string;
  organizationId: string;
  memberDuesId: string;
  amount: MonetaryAmount;
  paymentMethod?: string | null;
  transactionReference?: string | null;
  notes?: string | null;
  receivedAt: string;
  recordedBy?: string | null;
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
  /** Posts to Accounts Payable or Receivable, which QuickBooks' import needs a Name for. */
  PAYABLE_RECEIVABLE: 'payable_receivable',
  /** An account name starts with =, +, - or @, which the export's formula escaping would alter. */
  UNSAFE_ACCOUNT_NAME: 'unsafe_account_name',
  /** An account the uploaded chart of accounts does not list (see `accountsNotInChart`). */
  NOT_IN_CHART: 'not_in_chart',
} as const;
export type ExportReadinessStatus = (typeof ExportReadinessStatus)[keyof typeof ExportReadinessStatus];

export interface ExportReadinessCategory {
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  status: ExportReadinessStatus;
  accountName?: string | null;
  /** `category` when the category names its own account, `mapping` from its mapping, `parent` inherited. */
  accountSource?: 'category' | 'mapping' | 'parent' | null;
  offsetAccountName?: string | null;
  /** The ancestor category each account came from, when this one has none of its own. */
  accountInheritedFrom?: string | null;
  offsetInheritedFrom?: string | null;
  /** With `not_in_chart`: the accounts the uploaded chart of accounts lacks. */
  accountsNotInChart?: string[];
  mappingIds: string[];
}

/** `POST /finance/export/transactions`. */
export interface ExportRunPayload {
  dateRangeStart: string;
  dateRangeEnd: string;
  /** Send again payments an earlier export already carried. */
  includeExported: boolean;
  /** Send them even where their file was confirmed as imported (otherwise a 409, `LB-FIN-001`). */
  confirmReimport?: boolean;
}

export interface ExportReadiness {
  categories: ExportReadinessCategory[];
  /** Mappings whose category name matches no budget category: the export never uses them. */
  unmatchedMappingIds: string[];
  dues?: DuesExportReadiness;
  advances?: AdvanceExportReadiness;
  /** Whether account names are checked against an uploaded chart of accounts. */
  chartUploaded?: boolean;
}

/** One account of the uploaded QuickBooks chart of accounts. */
export interface QuickBooksChartAccount {
  name: string;
  accountType?: string | null;
}

/** `GET /finance/export/chart-of-accounts`; `uploadedAt` is null while none is on file. */
export interface QuickBooksChart {
  uploadedAt?: string | null;
  uploadedByName?: string | null;
  accounts: QuickBooksChartAccount[];
}

export const AdvanceExportStatus = {
  READY: 'ready',
  NO_ADVANCES_ACCOUNT: 'no_advances_account',
  NO_CASH_ACCOUNT: 'no_cash_account',
  PAYABLE_RECEIVABLE: 'payable_receivable',
  UNSAFE_ACCOUNT_NAME: 'unsafe_account_name',
  NOT_IN_CHART: 'not_in_chart',
} as const;
export type AdvanceExportStatus = (typeof AdvanceExportStatus)[keyof typeof AdvanceExportStatus];

/** Where cash advances post in QuickBooks. */
export interface AdvanceExportReadiness {
  status: AdvanceExportStatus;
  /** The asset account an advance is owed on until it is accounted for. */
  advancesAccount?: string | null;
  /** The bank account advances are paid from and returned to. */
  cashAccount?: string | null;
  accountsNotInChart?: string[];
}

/** `PUT /finance/export/advance-accounts`; null clears one. */
export interface AdvanceAccountsPayload {
  advancesAccount: string | null;
  cashAccount: string | null;
}

export const DuesExportStatus = {
  READY: 'ready',
  NO_INCOME: 'no_income',
  NO_DEPOSIT: 'no_deposit',
  PAYABLE_RECEIVABLE: 'payable_receivable',
  UNSAFE_ACCOUNT_NAME: 'unsafe_account_name',
  NOT_IN_CHART: 'not_in_chart',
} as const;
export type DuesExportStatus = (typeof DuesExportStatus)[keyof typeof DuesExportStatus];

/** What an export would post one dues schedule's payments to. */
export interface DuesScheduleExport {
  scheduleId: string;
  name: string;
  isActive: boolean;
  status: DuesExportStatus;
  incomeAccount?: string | null;
  /** `schedule` (its own) or `default` (the department's). */
  incomeSource?: 'schedule' | 'default' | null;
  depositAccount?: string | null;
  depositSource?: 'schedule' | 'default' | null;
  accountsNotInChart?: string[];
}

export interface DuesExportReadiness {
  /** False until the department names a dues account anywhere; until then dues stay out of the export. */
  enabled?: boolean;
  defaultIncomeAccount?: string | null;
  defaultDepositAccount?: string | null;
  schedules: DuesScheduleExport[];
}

/** `PUT /finance/export/dues-accounts`; null clears one. */
export interface DuesDefaultAccountsPayload {
  incomeAccount: string | null;
  depositAccount: string | null;
}

// =============================================================================
// Cash advances
// =============================================================================

/** Days after its check by which an advance must be accounted for (the IRS safe harbor). */
export const ADVANCE_RETURN_DAYS = 120;

/** An issued cash advance and what is left of it. */
export interface AdvanceSummary {
  id: string;
  requestNumber: string;
  memberId: string;
  memberName: string;
  amount: MonetaryAmount;
  purpose?: string | null;
  checkNumber?: string | null;
  issuedAt?: string | null;
  /** 120 days after the check. */
  dueAt?: string | null;
  /** Covered by the member's submitted expense reports. */
  accounted: MonetaryAmount;
  returned: MonetaryAmount;
  outstanding: MonetaryAmount;
  overdue: boolean;
}

/** `GET /finance/reports/advances`: every advance not yet fully accounted for. */
export interface AdvancesReport {
  advances: AdvanceSummary[];
  outstanding: MonetaryAmount;
  overdueOutstanding: MonetaryAmount;
}

export interface AdvanceReportLink {
  id: string;
  reportNumber: string;
  title: string;
  status: ExpenseReportStatus;
  totalAmount: MonetaryAmount;
  /** How much of the report the advance covers; null until submitted. */
  advanceApplied?: MonetaryAmount | null;
  submittedAt?: string | null;
}

export interface AdvanceReturn {
  id: string;
  amount: MonetaryAmount;
  returnedAt: string;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  recordedBy?: string | null;
  qbExportedAt?: string | null;
  createdAt: string;
}

export interface AdvanceDetail extends AdvanceSummary {
  reports: AdvanceReportLink[];
  returns: AdvanceReturn[];
}

/** `POST /finance/advances/{id}/returns`. */
export interface AdvanceReturnPayload {
  amount: string;
  returnedAt?: string | undefined;
  paymentMethod?: string | undefined;
  reference?: string | undefined;
  notes?: string | undefined;
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
  exportedByName?: string | null;
  exportedAt: string;
  /** `pending`, `successful`, `partial` (some rows delivered) or `failed`. */
  status: string;
  errorMessage?: string | null;
  completedAt?: string | null;
  /** When the Treasurer confirmed the file was imported into QuickBooks. */
  importedAt?: string | null;
  importedBy?: string | null;
  importedByName?: string | null;
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

// =============================================================================
// Board reports
// =============================================================================

/** One budget line, through the report's date. */
export interface BudgetVsActualRow {
  budgetId: string;
  categoryName: string;
  stationName?: string | null;
  originalBudget: MonetaryAmount;
  /** Confirmed amendments that had taken effect by the report's date. */
  amendments: MonetaryAmount;
  budget: MonetaryAmount;
  /** Payments dated through the report's date. */
  spent: MonetaryAmount;
  /** Open commitments; reported only for a report run through today. */
  committed?: MonetaryAmount | null;
  remaining: MonetaryAmount;
  percentUsed?: number | null;
  /** Today's report only: the line's running total. */
  runningSpent?: MonetaryAmount | null;
  runningSpentDiffers: boolean;
}

export interface BudgetVsActualTotals {
  originalBudget: MonetaryAmount;
  amendments: MonetaryAmount;
  budget: MonetaryAmount;
  spent: MonetaryAmount;
  committed?: MonetaryAmount | null;
  remaining: MonetaryAmount;
}

export interface BudgetVsActualReport {
  fiscalYearId: string;
  fiscalYearName: string;
  /** `YYYY-MM-DD`, the department's calendar. */
  asOf: string;
  includesCommitted: boolean;
  rows: BudgetVsActualRow[];
  totals: BudgetVsActualTotals;
}

export interface AmendmentLogRow {
  amendmentId: string;
  budgetId: string;
  categoryName: string;
  stationName?: string | null;
  amount: MonetaryAmount;
  isReversal: boolean;
  reason: string;
  approvedBy: string;
  /** `YYYY-MM-DD`. */
  approvedOn: string;
  enteredByName?: string | null;
  enteredAt: string;
  status: string;
  decidedByName?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

export interface AmendmentLogReport {
  fiscalYearId: string;
  fiscalYearName: string;
  rows: AmendmentLogRow[];
  /** Net of the confirmed rows. */
  confirmedNet: MonetaryAmount;
}

export const PaymentKind = {
  PURCHASE_REQUEST: 'purchase_request',
  CHECK_REQUEST: 'check_request',
  CHECK_VOID: 'check_void',
  EXPENSE_REPORT: 'expense_report',
  CASH_ADVANCE: 'cash_advance',
  ADVANCE_RETURN: 'advance_return',
} as const;
export type PaymentKind = (typeof PaymentKind)[keyof typeof PaymentKind];

export interface PaymentsRegisterRow {
  /** `YYYY-MM-DD`, the department's calendar day the money moved. */
  paidOn: string;
  kind: PaymentKind;
  entityId: string;
  number: string;
  payee: string;
  description: string;
  budgetLine?: string | null;
  checkNumber?: string | null;
  /**
   * A void, and cash returned against an advance, are negative. A report
   * accounting for an advance shows only what was paid beyond it.
   */
  amount: MonetaryAmount;
}

export interface PaymentsRegisterReport {
  start: string;
  end: string;
  rows: PaymentsRegisterRow[];
  total: MonetaryAmount;
}

/** An expense line reimbursed outside the accountable plan (claimed after the deadline). */
export interface LateSubstantiationRow {
  /** `YYYY-MM-DD`, the department's calendar day the report was paid. */
  paidOn: string;
  reportId: string;
  reportNumber: string;
  memberName: string;
  description: string;
  budgetLine?: string | null;
  /** `YYYY-MM-DD`. */
  incurredOn: string;
  /** `YYYY-MM-DD`; null for a report submitted before submission was recorded. */
  submittedOn?: string | null;
  daysToSubmit?: number | null;
  amount: MonetaryAmount;
  acknowledgedByName?: string | null;
}

export interface LateSubstantiationReport {
  start: string;
  end: string;
  rows: LateSubstantiationRow[];
  total: MonetaryAmount;
}

/** The restricted fund a payment is charged to (a fundraising campaign marked restricted). */
export interface FundFields {
  fundCampaignId?: string | null;
  /** Detail responses only. */
  fundName?: string | null;
  /** How far it would take its fund past what it has left, until approved; null when it fits (detail responses). */
  fundShortfall?: MonetaryAmount | null;
}

/** `GET /finance/funds`: an active restricted fund a payment may be charged to. */
export interface FundOption {
  campaignId: string;
  name: string;
  purpose?: string | null;
  available: MonetaryAmount;
}

/** One restricted fund's balance today (`GET /finance/reports/fund-balances`). */
export interface FundBalance {
  campaignId: string;
  name: string;
  purpose?: string | null;
  /** False once the campaign is deleted; its charges still count. */
  active: boolean;
  received: MonetaryAmount;
  spent: MonetaryAmount;
  committed: MonetaryAmount;
  /** Submitted and not yet decided; not subtracted from available. */
  awaitingApproval: MonetaryAmount;
  available: MonetaryAmount;
}

export interface FundBalancesReport {
  funds: FundBalance[];
  received: MonetaryAmount;
  spent: MonetaryAmount;
  committed: MonetaryAmount;
  awaitingApproval: MonetaryAmount;
  available: MonetaryAmount;
}

/** One payment's own class, and the one it takes once its category's applies (detail responses). */
export interface FunctionalClassFields {
  functionalClass?: FunctionalClass | null;
  effectiveFunctionalClass?: FunctionalClass | null;
}

export interface FunctionalExpenseCategory {
  /** Null: payments with no budget line. */
  categoryId?: string | null;
  categoryName?: string | null;
  amount: MonetaryAmount;
}

export interface FunctionalExpenseClass {
  /** Null is unclassified. */
  functionalClass: FunctionalClass | null;
  categories: FunctionalExpenseCategory[];
  total: MonetaryAmount;
}

export interface FunctionalExpensesReport {
  start: string;
  end: string;
  classes: FunctionalExpenseClass[];
  total: MonetaryAmount;
}
