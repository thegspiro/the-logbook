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
export type FiscalYearStatus =
  (typeof FiscalYearStatus)[keyof typeof FiscalYearStatus];

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
export type PurchaseRequestStatus =
  (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];

export const ExpenseReportStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  DENIED: 'denied',
  PAID: 'paid',
  CANCELLED: 'cancelled',
} as const;
export type ExpenseReportStatus =
  (typeof ExpenseReportStatus)[keyof typeof ExpenseReportStatus];

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
export type CheckRequestStatus =
  (typeof CheckRequestStatus)[keyof typeof CheckRequestStatus];

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
export type DuesFrequency =
  (typeof DuesFrequency)[keyof typeof DuesFrequency];

export const PurchaseRequestPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
export type PurchaseRequestPriority =
  (typeof PurchaseRequestPriority)[keyof typeof PurchaseRequestPriority];

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

export const ApprovalStepType = {
  APPROVAL: 'approval',
  NOTIFICATION: 'notification',
} as const;
export type ApprovalStepType =
  (typeof ApprovalStepType)[keyof typeof ApprovalStepType];

export const ApproverType = {
  POSITION: 'position',
  PERMISSION: 'permission',
  SPECIFIC_USER: 'specific_user',
  EMAIL: 'email',
} as const;
export type ApproverType =
  (typeof ApproverType)[keyof typeof ApproverType];

export const ApprovalStepStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  SKIPPED: 'skipped',
  AUTO_APPROVED: 'auto_approved',
  SENT: 'sent',
} as const;
export type ApprovalStepStatus =
  (typeof ApprovalStepStatus)[keyof typeof ApprovalStepStatus];

export const ApprovalEntityType = {
  PURCHASE_REQUEST: 'purchase_request',
  EXPENSE_REPORT: 'expense_report',
  CHECK_REQUEST: 'check_request',
} as const;
export type ApprovalEntityType =
  (typeof ApprovalEntityType)[keyof typeof ApprovalEntityType];

// =============================================================================
// Status Badge Color Mappings (Tailwind classes)
// =============================================================================

export const PURCHASE_REQUEST_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  ordered: 'bg-indigo-100 text-indigo-800',
  received: 'bg-teal-100 text-teal-800',
  paid: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

export const EXPENSE_REPORT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  paid: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

export const CHECK_REQUEST_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-blue-100 text-blue-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  issued: 'bg-emerald-100 text-emerald-800',
  voided: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

export const DUES_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  partial: 'bg-blue-100 text-blue-800',
  overdue: 'bg-red-100 text-red-800',
  waived: 'bg-gray-100 text-gray-800',
  exempt: 'bg-purple-100 text-purple-800',
};

export const APPROVAL_STEP_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  skipped: 'bg-gray-100 text-gray-800',
  auto_approved: 'bg-teal-100 text-teal-800',
  sent: 'bg-blue-100 text-blue-800',
};

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
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  categoryId: string;
  amountBudgeted: number;
  amountSpent: number;
  amountEncumbered: number;
  notes?: string;
  stationId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetSummary {
  totalBudgeted: number;
  totalSpent: number;
  totalEncumbered: number;
  totalRemaining: number;
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
  autoApproveUnder?: number;
  required: boolean;
  createdAt: string;
}

export interface ApprovalChain {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  appliesTo: ApprovalEntityType;
  minAmount?: number;
  maxAmount?: number;
  budgetCategoryId?: string;
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  steps: ApprovalChainStep[];
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
}

export interface PendingApproval {
  stepRecordId: string;
  entityType: ApprovalEntityType;
  entityId: string;
  entityTitle: string;
  entityAmount: number;
  requesterName: string;
  stepName: string;
  stepOrder: number;
  submittedAt: string;
}

export interface PurchaseRequest {
  id: string;
  organizationId: string;
  requestNumber: string;
  fiscalYearId: string;
  budgetId?: string;
  requestedBy: string;
  title: string;
  description?: string;
  vendor?: string;
  estimatedAmount: number;
  actualAmount?: number;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  approvedBy?: string;
  approvedAt?: string;
  denialReason?: string;
  orderedAt?: string;
  receivedAt?: string;
  paidAt?: string;
  notes?: string;
  receiptUrl?: string;
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
  amount: number;
  dateIncurred: string;
  expenseType: ExpenseType;
  receiptUrl?: string;
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
  totalAmount: number;
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
  amount: number;
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
  amount: number;
  frequency: DuesFrequency;
  dueDate: string;
  gracePeriodDays: number;
  lateFeeAmount?: number;
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
  amountDue: number;
  amountPaid: number;
  status: DuesStatus;
  dueDate: string;
  paidDate?: string;
  paymentMethod?: string;
  transactionReference?: string;
  lateFeeApplied?: number;
  waivedBy?: string;
  waivedAt?: string;
  waiveReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuesSummary {
  totalExpected: number;
  totalCollected: number;
  totalOutstanding: number;
  totalWaived: number;
  collectionRate: number;
  membersPaid: number;
  membersOverdue: number;
  membersWaived: number;
}

export interface ExportMapping {
  id: string;
  organizationId: string;
  internalCategory: string;
  qbAccountName: string;
  qbAccountNumber?: string;
  mappingType: string;
  createdAt: string;
  updatedAt: string;
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
