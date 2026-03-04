/**
 * Grants & Fundraising Module Types
 *
 * TypeScript interfaces and types for the Grants & Fundraising module.
 */

// =============================================================================
// Enumerations (as const pattern)
// =============================================================================

export const ApplicationStatus = {
  RESEARCHING: 'researching',
  PREPARING: 'preparing',
  INTERNAL_REVIEW: 'internal_review',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  AWARDED: 'awarded',
  DENIED: 'denied',
  ACTIVE: 'active',
  REPORTING: 'reporting',
  CLOSED: 'closed',
} as const;
export type ApplicationStatus =
  (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const GrantCategory = {
  EQUIPMENT: 'equipment',
  STAFFING: 'staffing',
  TRAINING: 'training',
  PREVENTION: 'prevention',
  FACILITIES: 'facilities',
  VEHICLES: 'vehicles',
  WELLNESS: 'wellness',
  COMMUNITY: 'community',
  OTHER: 'other',
} as const;
export type GrantCategory =
  (typeof GrantCategory)[keyof typeof GrantCategory];

export const GrantPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type GrantPriority =
  (typeof GrantPriority)[keyof typeof GrantPriority];

export const ComplianceTaskStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  OVERDUE: 'overdue',
  WAIVED: 'waived',
} as const;
export type ComplianceTaskStatus =
  (typeof ComplianceTaskStatus)[keyof typeof ComplianceTaskStatus];

export const ComplianceTaskType = {
  PERFORMANCE_REPORT: 'performance_report',
  FINANCIAL_REPORT: 'financial_report',
  PROGRESS_UPDATE: 'progress_update',
  SITE_VISIT: 'site_visit',
  AUDIT: 'audit',
  EQUIPMENT_INVENTORY: 'equipment_inventory',
  NFIRS_SUBMISSION: 'nfirs_submission',
  CLOSEOUT_REPORT: 'closeout_report',
  OTHER: 'other',
} as const;
export type ComplianceTaskType =
  (typeof ComplianceTaskType)[keyof typeof ComplianceTaskType];

export const CampaignStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type CampaignStatus =
  (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const CampaignType = {
  GENERAL: 'general',
  EQUIPMENT: 'equipment',
  TRAINING: 'training',
  COMMUNITY: 'community',
  MEMORIAL: 'memorial',
  EVENT: 'event',
  OTHER: 'other',
} as const;
export type CampaignType =
  (typeof CampaignType)[keyof typeof CampaignType];

export const DonorType = {
  INDIVIDUAL: 'individual',
  BUSINESS: 'business',
  FOUNDATION: 'foundation',
  GOVERNMENT: 'government',
  OTHER: 'other',
} as const;
export type DonorType = (typeof DonorType)[keyof typeof DonorType];

export const PaymentMethod = {
  CASH: 'cash',
  CHECK: 'check',
  CREDIT_CARD: 'credit_card',
  BANK_TRANSFER: 'bank_transfer',
  PAYPAL: 'paypal',
  VENMO: 'venmo',
  OTHER: 'other',
} as const;
export type PaymentMethod =
  (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PledgeStatus = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
  OVERDUE: 'overdue',
} as const;
export type PledgeStatus =
  (typeof PledgeStatus)[keyof typeof PledgeStatus];

// =============================================================================
// Status Badge Color Mappings (Tailwind classes)
// =============================================================================

export const APPLICATION_STATUS_COLORS: Record<string, string> = {
  researching: 'bg-gray-100 text-gray-800',
  preparing: 'bg-blue-100 text-blue-800',
  internal_review: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-indigo-100 text-indigo-800',
  under_review: 'bg-purple-100 text-purple-800',
  awarded: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  active: 'bg-emerald-100 text-emerald-800',
  reporting: 'bg-orange-100 text-orange-800',
  closed: 'bg-gray-200 text-gray-600',
};

export const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

export const COMPLIANCE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  waived: 'bg-gray-100 text-gray-600',
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

// =============================================================================
// Grant Opportunities
// =============================================================================

export interface GrantOpportunity {
  id: string;
  organizationId: string;
  name: string;
  agency: string;
  description: string | null;
  eligibleUses: string | null;
  typicalAwardMin: number | null;
  typicalAwardMax: number | null;
  eligibilityCriteria: string | null;
  applicationUrl: string | null;
  programUrl: string | null;
  matchRequired: boolean;
  matchPercentage: number | null;
  matchDescription: string | null;
  deadlineType: string | null;
  deadlineDate: string | null;
  recurringSchedule: string | null;
  requiredDocuments: string[];
  tags: string[];
  category: GrantCategory;
  federalProgramCode: string | null;
  isActive: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Grant Applications
// =============================================================================

export interface GrantApplication {
  id: string;
  organizationId: string;
  opportunityId: string | null;
  grantProgramName: string;
  grantAgency: string;
  applicationStatus: ApplicationStatus;
  amountRequested: number | null;
  amountAwarded: number | null;
  matchAmount: number | null;
  matchSource: string | null;
  applicationDeadline: string | null;
  submittedDate: string | null;
  awardDate: string | null;
  grantStartDate: string | null;
  grantEndDate: string | null;
  projectDescription: string | null;
  narrativeSummary: string | null;
  budgetSummary: string | null;
  keyContacts: string | null;
  federalAwardId: string | null;
  nfirsCompliant: boolean | null;
  performancePeriodMonths: number | null;
  reportingFrequency: string | null;
  nextReportDue: string | null;
  finalReportDue: string | null;
  assignedTo: string | null;
  priority: GrantPriority;
  linkedCampaignId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  budgetItems?: GrantBudgetItem[];
  complianceTasks?: GrantComplianceTask[];
  expenditures?: GrantExpenditure[];
  grantNotes?: GrantNote[];
}

// =============================================================================
// Grant Budget Items
// =============================================================================

export interface GrantBudgetItem {
  id: string;
  applicationId: string;
  category: string;
  description: string;
  amountBudgeted: number;
  amountSpent: number;
  federalShare: number | null;
  localMatch: number | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Grant Expenditures
// =============================================================================

export interface GrantExpenditure {
  id: string;
  applicationId: string;
  budgetItemId: string | null;
  description: string;
  amount: number;
  expenditureDate: string;
  vendor: string | null;
  invoiceNumber: string | null;
  receiptUrl: string | null;
  paymentMethod: string | null;
  approvedBy: string | null;
  approvalDate: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Grant Compliance Tasks
// =============================================================================

export interface GrantComplianceTask {
  id: string;
  applicationId: string;
  taskType: ComplianceTaskType;
  title: string;
  description: string | null;
  dueDate: string;
  completedDate: string | null;
  status: ComplianceTaskStatus;
  priority: GrantPriority;
  assignedTo: string | null;
  reminderDaysBefore: number;
  lastReminderSent: string | null;
  reportTemplate: string | null;
  submissionUrl: string | null;
  attachments: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Grant Notes
// =============================================================================

export interface GrantNote {
  id: string;
  applicationId: string;
  noteType: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
}

// =============================================================================
// Fundraising Campaigns
// =============================================================================

export interface FundraisingCampaign {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  campaignType: CampaignType;
  goalAmount: number;
  currentAmount: number;
  startDate: string;
  endDate: string | null;
  status: CampaignStatus;
  publicPageEnabled: boolean;
  publicPageUrl: string | null;
  heroImageUrl: string | null;
  thankYouMessage: string | null;
  allowAnonymous: boolean;
  minimumDonation: number | null;
  suggestedAmounts: number[] | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Donors
// =============================================================================

export interface Donor {
  id: string;
  organizationId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  donorType: DonorType;
  companyName: string | null;
  totalDonated: number;
  donationCount: number;
  firstDonationDate: string | null;
  lastDonationDate: string | null;
  notes: string | null;
  tags: string[] | null;
  communicationPreferences: Record<string, unknown> | null;
  isAnonymous: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Donations
// =============================================================================

export interface Donation {
  id: string;
  organizationId: string;
  campaignId: string | null;
  donorId: string | null;
  amount: number;
  currency: string;
  donationDate: string;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  transactionId: string | null;
  checkNumber: string | null;
  isRecurring: boolean;
  recurringFrequency: string | null;
  isAnonymous: boolean;
  donorName: string | null;
  donorEmail: string | null;
  dedicationType: string | null;
  dedicationName: string | null;
  notes: string | null;
  receiptSent: boolean;
  thankYouSent: boolean;
  taxDeductible: boolean;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Pledges
// =============================================================================

export interface Pledge {
  id: string;
  organizationId: string;
  campaignId: string | null;
  donorId: string | null;
  pledgedAmount: number;
  fulfilledAmount: number;
  pledgeDate: string;
  dueDate: string | null;
  status: PledgeStatus;
  paymentSchedule: string | null;
  reminderEnabled: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Fundraising Events
// =============================================================================

export interface FundraisingEvent {
  id: string;
  organizationId: string;
  campaignId: string | null;
  eventId: string | null;
  name: string;
  description: string | null;
  eventType: string;
  eventDate: string;
  location: string | null;
  ticketPrice: number | null;
  maxAttendees: number | null;
  currentAttendees: number;
  revenueGoal: number | null;
  actualRevenue: number;
  expenses: number;
  status: string;
  registrationUrl: string | null;
  sponsors: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Dashboard & Reports
// =============================================================================

export interface PipelineSummaryItem {
  status: string;
  count: number;
  totalRequested: number;
}

export interface GrantsDashboard {
  activeGrants: number;
  pendingApplications: number;
  totalGrantFunding: number;
  totalRaisedYtd: number;
  totalRaised12mo: number;
  activeCampaignsCount: number;
  activeCampaigns: FundraisingCampaign[];
  recentDonations: Donation[];
  upcomingDeadlines: GrantOpportunity[];
  complianceTasksDue: GrantComplianceTask[];
  outstandingPledges: number;
  totalDonors: number;
  pipelineSummary: PipelineSummaryItem[];
}

export interface GrantReport {
  totalApplications: number;
  totalRequested: number;
  totalAwarded: number;
  totalSpent: number;
  successRate: number;
  awardedCount: number;
  deniedCount: number;
  complianceSummary: {
    totalTasks: number;
    completed: number;
    overdue: number;
    pending: number;
  };
  spendingByCategory: Record<string, number>;
}

export interface FundraisingReport {
  totalDonations: number;
  donationCount: number;
  uniqueDonors: number;
  averageGift: number;
  donationsByMethod: Record<string, number>;
  monthlyTotals: { month: string; total: number }[];
}
