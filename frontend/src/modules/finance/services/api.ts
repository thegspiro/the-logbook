/**
 * Finance API Service
 *
 * Handles all API calls for the Finance module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { fetchFile, filenameFromContentDisposition, type DownloadedFile } from '../../../utils/fileDownload';
import type {
  AdvanceAccountsPayload,
  AdvanceDetail,
  AdvanceExportReadiness,
  AdvanceReturn,
  AdvanceReturnPayload,
  AdvancesReport,
  AdvanceSummary,
  ApprovalChain,
  ApprovalChainCreatePayload,
  ApprovalChainStep,
  ApprovalChainStepCreatePayload,
  ApprovalRoutePreview,
  ApprovalChainStepUpdatePayload,
  ApprovalChainUpdatePayload,
  ApprovalEntityType,
  ApprovalStepRecord,
  ApproverCoverageRow,
  Budget,
  BudgetAmendment,
  BudgetAmendmentCreatePayload,
  BudgetAmendmentCreated,
  BudgetAmendmentRejectPayload,
  BudgetAmendmentReversePayload,
  BudgetCategory,
  BudgetCategoryUpdatePayload,
  BudgetCreatePayload,
  BudgetOption,
  BudgetRequest,
  BudgetRequestCreatePayload,
  BudgetRequestDecisionPayload,
  BudgetRequestReviewPayload,
  BudgetPlanningStage,
  BudgetRequestProposalOptions,
  BudgetRequestStatus,
  BudgetRequestUpdatePayload,
  BudgetSummary,
  BudgetTransactionPage,
  BudgetUpdatePayload,
  ChargeAccess,
  ChargeAccessPayload,
  ChargeAccessSettings,
  CheckRequest,
  DuesPayment,
  DuesPaymentPayload,
  DuesSchedule,
  DuesScheduleCreatePayload,
  DuesScheduleUpdatePayload,
  DuesSummary,
  ExpenseLineItem,
  ExpenseLineItemUpdatePayload,
  ExpenseReport,
  FinanceDashboard,
  FiscalYear,
  ExportMapping,
  ExportMappingCreatePayload,
  ExportMappingUpdatePayload,
  ExportLog,
  ExportReadiness,
  FiscalYearOption,
  FiscalYearAdoptionPayload,
  FiscalYearLockPayload,
  FiscalYearOpenItem,
  FiscalYearUpdatePayload,
  FinanceNamedOption,
  MemberDues,
  MyBudget,
  MyBudgetRequestLines,
  MyBudgetsSummary,
  ApprovalEmailResendResult,
  PendingApproval,
  PurchaseRequest,
  MonetaryAmount,
  ReimbursementCheckPayload,
  ReimbursementReportPayload,
  StartFromLastYearResult,
  UnroutedApproval,
  FinanceSettings,
  AmendmentLogReport,
  BudgetVsActualReport,
  PaymentsRegisterReport,
  LateSubstantiationReport,
  FunctionalClass,
  FunctionalExpensesReport,
  FundBalancesReport,
  FundOption,
  ExportRunPayload,
  DuesDefaultAccountsPayload,
  DuesExportReadiness,
  QuickBooksChart,
} from '../types';
import { asArray } from '../../../utils/asArray';
import { readDeleteOutcome, type DeleteOutcome } from '../../../utils/deleteOutcome';

const api = createApiClient();

function receiptForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

// =============================================================================
// Fiscal Years
// =============================================================================

export const fiscalYearService = {
  async list(): Promise<FiscalYear[]> {
    const response = await api.get<FiscalYear[]>('/finance/fiscal-years');
    return asArray(response.data);
  },

  /** Active and draft years, for the request forms. Open to `finance.request`. */
  async options(): Promise<FiscalYearOption[]> {
    const response = await api.get<FiscalYearOption[]>('/finance/fiscal-years/options');
    return asArray(response.data);
  },

  async get(id: string): Promise<FiscalYear> {
    const response = await api.get<FiscalYear>(`/finance/fiscal-years/${id}`);
    return response.data;
  },

  async create(data: { name: string; startDate: string; endDate: string }): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>('/finance/fiscal-years', data);
    return response.data;
  },

  async update(id: string, data: FiscalYearUpdatePayload): Promise<FiscalYear> {
    const response = await api.put<FiscalYear>(`/finance/fiscal-years/${id}`, data);
    return response.data;
  },

  /** Copy another year's lines into the draft year `draftId` (finance.manage). */
  async startFrom(draftId: string, sourceId: string): Promise<StartFromLastYearResult> {
    const response = await api.post<StartFromLastYearResult>(`/finance/fiscal-years/${draftId}/start-from/${sourceId}`);
    return response.data;
  },

  /** Record the board's vote on a draft in board review; the year stays a draft until started. */
  async adopt(id: string, adoption: FiscalYearAdoptionPayload): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/adopt`, adoption);
    return response.data;
  },

  /** Start an adopted draft on or after its start date, or reopen a year in its year-end close. */
  async activate(id: string): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/activate`);
    return response.data;
  },

  async beginClose(id: string): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/begin-close`);
    return response.data;
  },

  /** What still stops a closing year from locking. */
  async openItems(id: string): Promise<FiscalYearOpenItem[]> {
    const response = await api.get<FiscalYearOpenItem[]>(`/finance/fiscal-years/${id}/open-items`);
    return response.data;
  },

  /** Move a draft year one planning stage forward or back. */
  async setPlanningStage(id: string, stage: BudgetPlanningStage): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/planning-stage`, { stage });
    return response.data;
  },

  async lock(id: string, signOff: FiscalYearLockPayload): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/lock`, signOff);
    return response.data;
  },
};

// =============================================================================
// Budget Categories
// =============================================================================

export const budgetCategoryService = {
  async list(): Promise<BudgetCategory[]> {
    const response = await api.get<BudgetCategory[]>('/finance/budget-categories');
    return asArray(response.data);
  },

  async create(data: {
    name: string;
    description?: string;
    parentCategoryId?: string;
    sortOrder?: number;
    qbAccountName?: string;
    ownerPositionId?: string;
    functionalClass?: FunctionalClass;
    chargeAccess?: ChargeAccess;
    chargePositionIds?: string[];
  }): Promise<BudgetCategory> {
    const response = await api.post<BudgetCategory>('/finance/budget-categories', data);
    return response.data;
  },

  async update(id: string, data: BudgetCategoryUpdatePayload): Promise<BudgetCategory> {
    const response = await api.put<BudgetCategory>(`/finance/budget-categories/${id}`, data);
    return response.data;
  },

  /** Deletes an unused category; one that lines, requests or approval chains use is deactivated instead. */
  async delete(id: string): Promise<DeleteOutcome> {
    const response = await api.delete(`/finance/budget-categories/${id}`);
    return readDeleteOutcome(response);
  },

  /** The categories the caller may set a charge rule on (as owner or Treasurer). */
  async chargeAccessSettings(): Promise<ChargeAccessSettings> {
    const response = await api.get<ChargeAccessSettings>('/finance/charge-access');
    return {
      categories: asArray(response.data.categories),
      positions: asArray(response.data.positions),
    };
  },

  async setChargeAccess(id: string, data: ChargeAccessPayload): Promise<BudgetCategory> {
    const response = await api.put<BudgetCategory>(`/finance/budget-categories/${id}/charge-access`, data);
    return response.data;
  },
};

// =============================================================================
// Budgets
// =============================================================================

export const budgetService = {
  async list(params?: { fiscalYearId?: string; categoryId?: string; stationId?: string }): Promise<Budget[]> {
    const response = await api.get<Budget[]>('/finance/budgets', {
      params: {
        fiscal_year_id: params?.fiscalYearId,
        category_id: params?.categoryId,
        station_id: params?.stationId,
      },
    });
    return asArray(response.data);
  },

  /**
   * A fiscal year's budget lines as label + amount remaining, for the request
   * forms. Open to `finance.request`, unlike the rest of this service.
   */
  async options(fiscalYearId: string): Promise<BudgetOption[]> {
    const response = await api.get<BudgetOption[]>('/finance/budgets/options', {
      params: { fiscal_year_id: fiscalYearId },
    });
    return asArray(response.data);
  },

  async get(id: string): Promise<Budget> {
    const response = await api.get<Budget>(`/finance/budgets/${id}`);
    return response.data;
  },

  async create(data: BudgetCreatePayload): Promise<Budget> {
    const response = await api.post<Budget>('/finance/budgets', data);
    return response.data;
  },

  async update(id: string, data: BudgetUpdatePayload): Promise<Budget> {
    const response = await api.put<Budget>(`/finance/budgets/${id}`, data);
    return response.data;
  },

  /** A line's amendments, newest first. */
  async listAmendments(id: string): Promise<BudgetAmendment[]> {
    const response = await api.get<BudgetAmendment[]>(`/finance/budgets/${id}/amendments`);
    return asArray(response.data);
  },

  /**
   * What moved the line's spent and committed totals, newest first. Open to
   * `finance.view` and to the line's owner, like `get` and `listAmendments`.
   */
  async listTransactions(id: string, params: { limit: number; offset: number }): Promise<BudgetTransactionPage> {
    const response = await api.get<BudgetTransactionPage>(`/finance/budgets/${id}/transactions`, { params });
    return { ...response.data, items: asArray(response.data.items) };
  },

  /** The lines the signed-in member owns, every fiscal year, newest first. */
  async listMine(params?: { fiscalYearId?: string }): Promise<MyBudget[]> {
    const response = await api.get<MyBudget[]>('/finance/my-budgets', {
      params: { fiscal_year_id: params?.fiscalYearId },
    });
    return asArray(response.data);
  },

  /** Whether the signed-in member owns any line — the navigation's signal. */
  async mySummary(): Promise<MyBudgetsSummary> {
    const response = await api.get<MyBudgetsSummary>('/finance/my-budgets/summary');
    return response.data;
  },

  /** Record extra money approved for a line; pending until a second officer confirms it. */
  async addAmendment(id: string, data: BudgetAmendmentCreatePayload): Promise<BudgetAmendmentCreated> {
    const response = await api.post<BudgetAmendmentCreated>(`/finance/budgets/${id}/amendments`, data);
    return response.data;
  },

  /** Cancel a mistaken amendment with a reversing entry, pending like any amendment. */
  async reverseAmendment(
    id: string,
    amendmentId: string,
    data: BudgetAmendmentReversePayload
  ): Promise<BudgetAmendmentCreated> {
    const response = await api.post<BudgetAmendmentCreated>(
      `/finance/budgets/${id}/amendments/${amendmentId}/reverse`,
      data
    );
    return response.data;
  },

  /** Confirm a pending amendment; this is what moves the line's budget. */
  async confirmAmendment(id: string, amendmentId: string): Promise<BudgetAmendmentCreated> {
    const response = await api.post<BudgetAmendmentCreated>(`/finance/budgets/${id}/amendments/${amendmentId}/confirm`);
    return response.data;
  },

  /** Reject a pending amendment, with the reason. The line is left as it was. */
  async rejectAmendment(
    id: string,
    amendmentId: string,
    data: BudgetAmendmentRejectPayload
  ): Promise<BudgetAmendmentCreated> {
    const response = await api.post<BudgetAmendmentCreated>(
      `/finance/budgets/${id}/amendments/${amendmentId}/reject`,
      data
    );
    return response.data;
  },

  async getSummary(fiscalYearId: string): Promise<BudgetSummary> {
    const response = await api.get<BudgetSummary>('/finance/budgets/summary', {
      params: { fiscal_year_id: fiscalYearId },
    });
    return response.data;
  },
};

// =============================================================================
// Budget requests (next year's amounts)
// =============================================================================

export const budgetRequestService = {
  /** finance.manage sees every request; anyone else, their own lines' and positions'. */
  async list(params?: { fiscalYearId?: string; status?: BudgetRequestStatus }): Promise<BudgetRequest[]> {
    const response = await api.get<BudgetRequest[]>('/finance/budget-requests', {
      params: { fiscal_year_id: params?.fiscalYearId, status: params?.status },
    });
    return asArray(response.data);
  },

  /** The caller's lines in one year, each with its request, plus the year's deadline. */
  async myLines(fiscalYearId: string): Promise<MyBudgetRequestLines> {
    const response = await api.get<MyBudgetRequestLines>('/finance/budget-requests/my-lines', {
      params: { fiscal_year_id: fiscalYearId },
    });
    return response.data;
  },

  /** The positions the caller holds, and the categories and stations, for a proposal. */
  async proposalOptions(): Promise<BudgetRequestProposalOptions> {
    const response = await api.get<BudgetRequestProposalOptions>('/finance/budget-requests/proposal-options');
    return {
      positions: asArray(response.data.positions),
      categories: asArray(response.data.categories),
      stations: asArray(response.data.stations),
    };
  },

  async get(id: string): Promise<BudgetRequest> {
    const response = await api.get<BudgetRequest>(`/finance/budget-requests/${id}`);
    return response.data;
  },

  async create(data: BudgetRequestCreatePayload): Promise<BudgetRequest> {
    const response = await api.post<BudgetRequest>('/finance/budget-requests', data);
    return response.data;
  },

  async update(id: string, data: BudgetRequestUpdatePayload): Promise<BudgetRequest> {
    const response = await api.put<BudgetRequest>(`/finance/budget-requests/${id}`, data);
    return response.data;
  },

  async submit(id: string): Promise<BudgetRequest> {
    const response = await api.post<BudgetRequest>(`/finance/budget-requests/${id}/submit`);
    return response.data;
  },

  async withdraw(id: string): Promise<BudgetRequest> {
    const response = await api.post<BudgetRequest>(`/finance/budget-requests/${id}/withdraw`);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/finance/budget-requests/${id}`);
  },

  /** finance.manage only. */
  async decide(id: string, data: BudgetRequestDecisionPayload): Promise<BudgetRequest> {
    const response = await api.post<BudgetRequest>(`/finance/budget-requests/${id}/decide`, data);
    return response.data;
  },

  /** Senior leadership (`finance.budget_review`) changes a decided amount during leadership review. */
  async review(id: string, data: BudgetRequestReviewPayload): Promise<BudgetRequest> {
    const response = await api.post<BudgetRequest>(`/finance/budget-requests/${id}/review`, data);
    return response.data;
  },
};

// =============================================================================
// Budget form options (finance.manage)
// =============================================================================

export const financeOptionService = {
  /** The department's positions, for the budget and category owner pickers. */
  async positions(): Promise<FinanceNamedOption[]> {
    const response = await api.get<FinanceNamedOption[]>('/finance/position-options');
    return asArray(response.data);
  },

  /** The department's facilities that are not archived, for the station picker. */
  async stations(): Promise<FinanceNamedOption[]> {
    const response = await api.get<FinanceNamedOption[]>('/finance/station-options');
    return asArray(response.data);
  },
};

// =============================================================================
// Approval Chains
// =============================================================================

export const approvalChainService = {
  async list(): Promise<ApprovalChain[]> {
    const response = await api.get<ApprovalChain[]>('/finance/approval-chains');
    return asArray(response.data);
  },

  async get(id: string): Promise<ApprovalChain> {
    const response = await api.get<ApprovalChain>(`/finance/approval-chains/${id}`);
    return response.data;
  },

  async create(data: ApprovalChainCreatePayload): Promise<ApprovalChain> {
    const response = await api.post<ApprovalChain>('/finance/approval-chains', data);
    return response.data;
  },

  async update(id: string, data: ApprovalChainUpdatePayload): Promise<ApprovalChain> {
    const response = await api.put<ApprovalChain>(`/finance/approval-chains/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/finance/approval-chains/${id}`);
  },

  async addStep(chainId: string, data: ApprovalChainStepCreatePayload): Promise<ApprovalChainStep> {
    const response = await api.post<ApprovalChainStep>(`/finance/approval-chains/${chainId}/steps`, data);
    return response.data;
  },

  async updateStep(chainId: string, stepId: string, data: ApprovalChainStepUpdatePayload): Promise<ApprovalChainStep> {
    const response = await api.put<ApprovalChainStep>(`/finance/approval-chains/${chainId}/steps/${stepId}`, data);
    return response.data;
  },

  async deleteStep(chainId: string, stepId: string): Promise<void> {
    await api.delete(`/finance/approval-chains/${chainId}/steps/${stepId}`);
  },

  /** Every approval step and whether anybody can act on it. Needs `finance.configure_approvals`. */
  async getApproverCoverage(): Promise<ApproverCoverageRow[]> {
    const response = await api.get<ApproverCoverageRow[]>('/finance/approval-chains/approver-coverage');
    return asArray(response.data);
  },

  /** Who a request would wait on if submitted now, for the member raising it. */
  async routePreview(params: {
    entityType: ApprovalEntityType;
    amount: MonetaryAmount;
    budgetId?: string | undefined;
  }): Promise<ApprovalRoutePreview> {
    const response = await api.get<ApprovalRoutePreview>('/finance/approval-chains/route-preview', {
      params: {
        entity_type: params.entityType,
        amount: params.amount,
        budget_id: params.budgetId || undefined,
      },
    });
    return response.data;
  },

  async preview(params: { entityType: string; amount: MonetaryAmount; categoryId?: string }): Promise<ApprovalChain> {
    const response = await api.get<ApprovalChain>('/finance/approval-chains/preview', {
      params: {
        entity_type: params.entityType,
        amount: params.amount,
        category_id: params.categoryId,
      },
    });
    return response.data;
  },
};

// =============================================================================
// Approvals
// =============================================================================

const stepDecisionBody = (notes?: string, overrideReason?: string, acknowledgeLate?: boolean) => ({
  notes: notes || undefined,
  ...(overrideReason ? { overrideReason } : {}),
  ...(acknowledgeLate ? { acknowledgeLateSubstantiation: true } : {}),
});

/** Restricted funds: fundraising campaigns marked restricted. */
export const fundService = {
  /** The active funds a payment may be charged to, with what each has left. */
  async list(): Promise<FundOption[]> {
    const response = await api.get<FundOption[]>('/finance/funds');
    return asArray(response.data);
  },
};

export const financeSettingsService = {
  /** The finance rules as the approval path reads them. */
  async get(): Promise<FinanceSettings> {
    const response = await api.get<FinanceSettings>('/finance/settings');
    return response.data;
  },
};

/**
 * Board reports. Each is served as JSON for the screen and as CSV for the
 * download, from the same query, so the file always matches what was shown.
 */
export const financeReportService = {
  /** *asOf* omitted means today in the department's timezone. */
  async budgetVsActual(fiscalYearId: string, asOf?: string): Promise<BudgetVsActualReport> {
    const response = await api.get<BudgetVsActualReport>('/finance/reports/budget-vs-actual', {
      params: { fiscal_year_id: fiscalYearId, as_of: asOf || undefined },
    });
    return response.data;
  },

  async budgetVsActualCsv(fiscalYearId: string, asOf?: string): Promise<DownloadedFile> {
    const query = new URLSearchParams({ fiscal_year_id: fiscalYearId, format: 'csv' });
    if (asOf) query.set('as_of', asOf);
    return fetchFile(api, `/finance/reports/budget-vs-actual?${query.toString()}`, 'budget-vs-actual.csv');
  },

  async amendmentLog(fiscalYearId: string): Promise<AmendmentLogReport> {
    const response = await api.get<AmendmentLogReport>('/finance/reports/amendment-log', {
      params: { fiscal_year_id: fiscalYearId },
    });
    return response.data;
  },

  async amendmentLogCsv(fiscalYearId: string): Promise<DownloadedFile> {
    const query = new URLSearchParams({ fiscal_year_id: fiscalYearId, format: 'csv' });
    return fetchFile(api, `/finance/reports/amendment-log?${query.toString()}`, 'amendment-log.csv');
  },

  async paymentsRegister(start: string, end: string): Promise<PaymentsRegisterReport> {
    const response = await api.get<PaymentsRegisterReport>('/finance/reports/payments-register', {
      params: { start, end },
    });
    return response.data;
  },

  async paymentsRegisterCsv(start: string, end: string): Promise<DownloadedFile> {
    const query = new URLSearchParams({ start, end, format: 'csv' });
    return fetchFile(api, `/finance/reports/payments-register?${query.toString()}`, 'payments-register.csv');
  },

  /** Expense lines paid in the period that were claimed after the substantiation deadline. */
  /** Payments in the period by function (Form 990 Part IX), then by budget category. */
  async functionalExpenses(start: string, end: string): Promise<FunctionalExpensesReport> {
    const response = await api.get<FunctionalExpensesReport>('/finance/reports/functional-expenses', {
      params: { start, end },
    });
    return response.data;
  },

  async functionalExpensesCsv(start: string, end: string): Promise<DownloadedFile> {
    const query = new URLSearchParams({ start, end, format: 'csv' });
    return fetchFile(api, `/finance/reports/functional-expenses?${query.toString()}`, 'functional-expenses.csv');
  },

  async fundBalances(): Promise<FundBalancesReport> {
    const response = await api.get<FundBalancesReport>('/finance/reports/fund-balances');
    return response.data;
  },

  async fundBalancesCsv(): Promise<DownloadedFile> {
    return fetchFile(api, '/finance/reports/fund-balances?format=csv', 'fund-balances.csv');
  },

  async advances(): Promise<AdvancesReport> {
    const response = await api.get<AdvancesReport>('/finance/reports/advances');
    return response.data;
  },

  async advancesCsv(): Promise<DownloadedFile> {
    return fetchFile(api, '/finance/reports/advances?format=csv', 'cash-advances.csv');
  },

  async lateSubstantiation(start: string, end: string): Promise<LateSubstantiationReport> {
    const response = await api.get<LateSubstantiationReport>('/finance/reports/late-substantiation', {
      params: { start, end },
    });
    return response.data;
  },

  async lateSubstantiationCsv(start: string, end: string): Promise<DownloadedFile> {
    const query = new URLSearchParams({ start, end, format: 'csv' });
    return fetchFile(api, `/finance/reports/late-substantiation?${query.toString()}`, 'outside-accountable-plan.csv');
  },
};

/**
 * Overrides one payment's functional class (finance.manage); null returns it
 * to its budget category's class.
 */
export const functionalClassService = {
  async setPurchaseRequest(id: string, functionalClass: FunctionalClass | null): Promise<void> {
    await api.put(`/finance/purchase-requests/${id}/functional-class`, { functionalClass });
  },

  async setCheckRequest(id: string, functionalClass: FunctionalClass | null): Promise<void> {
    await api.put(`/finance/check-requests/${id}/functional-class`, { functionalClass });
  },

  async setExpenseLine(reportId: string, itemId: string, functionalClass: FunctionalClass | null): Promise<void> {
    await api.put(`/finance/expense-reports/${reportId}/items/${itemId}/functional-class`, { functionalClass });
  },
};

export const approvalService = {
  async getPending(): Promise<PendingApproval[]> {
    const response = await api.get<PendingApproval[]>('/finance/approvals/pending');
    return asArray(response.data);
  },

  /**
   * `overrideReason` is for an approvals admin acting on a step they are not
   * the named approver of; it is sent only when given, and recorded in the
   * audit log.
   */
  /**
   * `acknowledgeLate` confirms the approver has reviewed an expense report's
   * lines submitted after the substantiation deadline; the API refuses to
   * approve such a report without it.
   */
  async approve(
    stepRecordId: string,
    notes?: string,
    overrideReason?: string,
    acknowledgeLate?: boolean
  ): Promise<ApprovalStepRecord> {
    const response = await api.post<ApprovalStepRecord>(
      `/finance/approvals/${stepRecordId}/approve`,
      stepDecisionBody(notes, overrideReason, acknowledgeLate)
    );
    return response.data;
  },

  async deny(stepRecordId: string, notes?: string, overrideReason?: string): Promise<ApprovalStepRecord> {
    const response = await api.post<ApprovalStepRecord>(
      `/finance/approvals/${stepRecordId}/deny`,
      stepDecisionBody(notes, overrideReason)
    );
    return response.data;
  },

  /**
   * Email an external approver a fresh link; the old one stops working.
   * `linkVersion` is the `emailLinkVersion` the queue showed, so a repeated
   * click sends nothing (`resent: false`).
   */
  async resendEmail(stepRecordId: string, linkVersion: number): Promise<ApprovalEmailResendResult> {
    const response = await api.post<ApprovalEmailResendResult>(`/finance/approvals/${stepRecordId}/resend-email`, {
      linkVersion,
    });
    return response.data;
  },

  /** Requests waiting for approval that have no approval steps (no chain applied). */
  async getUnrouted(): Promise<UnroutedApproval[]> {
    const response = await api.get<UnroutedApproval[]>('/finance/approvals/unrouted');
    return asArray(response.data);
  },

  /** Approve a request that has no approval steps. Refused (409) for one that has steps. */
  async manualApprove(
    entityType: ApprovalEntityType,
    entityId: string,
    notes?: string,
    acknowledgeLate?: boolean
  ): Promise<void> {
    await api.post(`/finance/approvals/manual/${entityType}/${entityId}/approve`, {
      notes: notes || undefined,
      ...(acknowledgeLate ? { acknowledgeLateSubstantiation: true } : {}),
    });
  },

  /** Deny a request that has no approval steps. The requester sees the reason. */
  async manualDeny(entityType: ApprovalEntityType, entityId: string, reason: string): Promise<void> {
    await api.post(`/finance/approvals/manual/${entityType}/${entityId}/deny`, { reason });
  },
};

// =============================================================================
// Purchase Requests
// =============================================================================

export const purchaseRequestService = {
  async list(params?: { status?: string; fiscalYearId?: string }): Promise<PurchaseRequest[]> {
    const response = await api.get<PurchaseRequest[]>('/finance/purchase-requests', {
      params: {
        status: params?.status,
        fiscal_year_id: params?.fiscalYearId,
      },
    });
    return asArray(response.data);
  },

  async get(id: string): Promise<PurchaseRequest> {
    const response = await api.get<PurchaseRequest>(`/finance/purchase-requests/${id}`);
    return response.data;
  },

  async create(data: Partial<PurchaseRequest>): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>('/finance/purchase-requests', data);
    return response.data;
  },

  async update(id: string, data: Partial<PurchaseRequest>): Promise<PurchaseRequest> {
    const response = await api.put<PurchaseRequest>(`/finance/purchase-requests/${id}`, data);
    return response.data;
  },

  async submit(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(`/finance/purchase-requests/${id}/submit`);
    return response.data;
  },

  async markOrdered(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(`/finance/purchase-requests/${id}/mark-ordered`);
    return response.data;
  },

  async markReceived(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(`/finance/purchase-requests/${id}/mark-received`);
    return response.data;
  },

  async markPaid(id: string, actualAmount?: MonetaryAmount): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(`/finance/purchase-requests/${id}/mark-paid`, undefined, {
      params: { actual_amount: actualAmount },
    });
    return response.data;
  },

  async cancel(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(`/finance/purchase-requests/${id}/cancel`);
    return response.data;
  },

  async uploadReceipt(id: string, file: File): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(`/finance/purchase-requests/${id}/receipt`, receiptForm(file), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  downloadReceipt(id: string): Promise<DownloadedFile> {
    return fetchFile(api, `/finance/purchase-requests/${id}/receipt`, 'receipt');
  },

  /** Claim back an approved purchase the requester paid for: raises a draft expense report linked to it. */
  async claimReimbursement(id: string, data: ReimbursementReportPayload): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(`/finance/purchase-requests/${id}/reimbursement-report`, data);
    return response.data;
  },
};

// =============================================================================
// Expense Reports
// =============================================================================

export const expenseReportService = {
  async list(params?: { status?: string }): Promise<ExpenseReport[]> {
    const response = await api.get<ExpenseReport[]>('/finance/expense-reports', { params: { status: params?.status } });
    return asArray(response.data);
  },

  async get(id: string): Promise<ExpenseReport> {
    const response = await api.get<ExpenseReport>(`/finance/expense-reports/${id}`);
    return response.data;
  },

  async create(data: Partial<ExpenseReport>): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>('/finance/expense-reports', data);
    return response.data;
  },

  async update(id: string, data: Partial<ExpenseReport>): Promise<ExpenseReport> {
    const response = await api.put<ExpenseReport>(`/finance/expense-reports/${id}`, data);
    return response.data;
  },

  async addLineItem(id: string, data: Partial<ExpenseLineItem>): Promise<ExpenseLineItem> {
    const response = await api.post<ExpenseLineItem>(`/finance/expense-reports/${id}/items`, data);
    return response.data;
  },

  /** Edit a line on a draft report: omitted fields stay, null clears an optional one. */
  async updateLineItem(id: string, itemId: string, data: ExpenseLineItemUpdatePayload): Promise<ExpenseLineItem> {
    const response = await api.put<ExpenseLineItem>(`/finance/expense-reports/${id}/items/${itemId}`, data);
    return response.data;
  },

  async deleteLineItem(id: string, itemId: string): Promise<void> {
    await api.delete(`/finance/expense-reports/${id}/items/${itemId}`);
  },

  /** Withdraw a draft (the member) or cancel a report further along (the finance office). */
  async cancel(id: string): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(`/finance/expense-reports/${id}/cancel`);
    return response.data;
  },

  async uploadLineItemReceipt(reportId: string, itemId: string, file: File): Promise<ExpenseLineItem> {
    const response = await api.post<ExpenseLineItem>(
      `/finance/expense-reports/${reportId}/items/${itemId}/receipt`,
      receiptForm(file),
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  downloadLineItemReceipt(reportId: string, itemId: string): Promise<DownloadedFile> {
    return fetchFile(api, `/finance/expense-reports/${reportId}/items/${itemId}/receipt`, 'receipt');
  },

  async submit(id: string): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(`/finance/expense-reports/${id}/submit`);
    return response.data;
  },

  async markPaid(id: string, paymentMethod?: string): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(`/finance/expense-reports/${id}/mark-paid`, undefined, {
      params: { payment_method: paymentMethod },
    });
    return response.data;
  },

  /** Pay an approved report by check: raises the member's check request and submits it for approval. */
  async payByCheck(id: string, data: ReimbursementCheckPayload): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(`/finance/expense-reports/${id}/reimbursement-check`, data);
    return response.data;
  },
};

// =============================================================================
// Check Requests
// =============================================================================

export const advanceService = {
  /**
   * Issued cash advances, oldest first. *mine* narrows a finance officer to
   * their own; *outstandingOnly* leaves out the ones fully accounted for.
   */
  async list(params?: { mine?: boolean; outstandingOnly?: boolean }): Promise<AdvanceSummary[]> {
    const response = await api.get<AdvanceSummary[]>('/finance/advances', {
      params: {
        mine: params?.mine || undefined,
        outstanding_only: params?.outstandingOnly || undefined,
      },
    });
    return asArray(response.data);
  },

  async get(id: string): Promise<AdvanceDetail> {
    const response = await api.get<AdvanceDetail>(`/finance/advances/${id}`);
    return response.data;
  },

  async recordReturn(id: string, data: AdvanceReturnPayload): Promise<AdvanceReturn> {
    const response = await api.post<AdvanceReturn>(`/finance/advances/${id}/returns`, data);
    return response.data;
  },

  async deleteReturn(id: string, returnId: string): Promise<void> {
    await api.delete(`/finance/advances/${id}/returns/${returnId}`);
  },
};

export const checkRequestService = {
  async list(params?: { status?: string }): Promise<CheckRequest[]> {
    const response = await api.get<CheckRequest[]>('/finance/check-requests', { params: { status: params?.status } });
    return asArray(response.data);
  },

  async get(id: string): Promise<CheckRequest> {
    const response = await api.get<CheckRequest>(`/finance/check-requests/${id}`);
    return response.data;
  },

  async create(data: Partial<CheckRequest>): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>('/finance/check-requests', data);
    return response.data;
  },

  async update(id: string, data: Partial<CheckRequest>): Promise<CheckRequest> {
    const response = await api.put<CheckRequest>(`/finance/check-requests/${id}`, data);
    return response.data;
  },

  async submit(id: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(`/finance/check-requests/${id}/submit`);
    return response.data;
  },

  async issue(id: string, checkNumber: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(`/finance/check-requests/${id}/issue`, undefined, {
      params: { check_number: checkNumber },
    });
    return response.data;
  },

  /** Withdraw a draft (the member) or cancel an unissued request (the finance office). */
  async cancel(id: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(`/finance/check-requests/${id}/cancel`);
    return response.data;
  },

  async void(id: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(`/finance/check-requests/${id}/void`);
    return response.data;
  },
};

// =============================================================================
// Dues
// =============================================================================

export const duesService = {
  async listSchedules(): Promise<DuesSchedule[]> {
    const response = await api.get<DuesSchedule[]>('/finance/dues-schedules');
    return asArray(response.data);
  },

  async createSchedule(data: DuesScheduleCreatePayload): Promise<DuesSchedule> {
    const response = await api.post<DuesSchedule>('/finance/dues-schedules', data);
    return response.data;
  },

  async updateSchedule(id: string, data: DuesScheduleUpdatePayload): Promise<DuesSchedule> {
    const response = await api.put<DuesSchedule>(`/finance/dues-schedules/${id}`, data);
    return response.data;
  },

  async generateDues(scheduleId: string): Promise<{ generated: number }> {
    const response = await api.post<{ generated: number }>(`/finance/dues-schedules/${scheduleId}/generate`);
    return response.data;
  },

  async listMemberDues(params?: { scheduleId?: string; userId?: string; status?: string }): Promise<MemberDues[]> {
    const response = await api.get<MemberDues[]>('/finance/dues', {
      params: {
        schedule_id: params?.scheduleId,
        user_id: params?.userId,
        status: params?.status,
      },
    });
    return asArray(response.data);
  },

  async recordPayment(duesId: string, data: DuesPaymentPayload): Promise<MemberDues> {
    const response = await api.put<MemberDues>(`/finance/dues/${duesId}`, data);
    return response.data;
  },

  async listPayments(duesId: string): Promise<DuesPayment[]> {
    const response = await api.get<DuesPayment[]>(`/finance/dues/${duesId}/payments`);
    return asArray(response.data);
  },

  async waive(duesId: string, reason: string): Promise<MemberDues> {
    const response = await api.post<MemberDues>(`/finance/dues/${duesId}/waive`, { reason });
    return response.data;
  },

  async unwaive(duesId: string, reason: string): Promise<MemberDues> {
    const response = await api.post<MemberDues>(`/finance/dues/${duesId}/unwaive`, { reason });
    return response.data;
  },

  async getSummary(scheduleId?: string): Promise<DuesSummary> {
    const response = await api.get<DuesSummary>('/finance/dues/summary', {
      params: { schedule_id: scheduleId },
    });
    return response.data;
  },
};

// =============================================================================
// Dashboard
// =============================================================================

export const financeDashboardService = {
  async getDashboard(): Promise<FinanceDashboard> {
    const response = await api.get<FinanceDashboard>('/finance/dashboard');
    return response.data;
  },
};

// =============================================================================
// QuickBooks Export
// =============================================================================

export const exportMappingService = {
  async list(): Promise<ExportMapping[]> {
    // The API pages at 100 by default; a department's chart of accounts is
    // far smaller than its 1000 ceiling, and a truncated list would hide a
    // duplicate mapping the readiness report is pointing at.
    const response = await api.get<ExportMapping[]>('/finance/export/mappings', { params: { limit: 1000 } });
    return asArray(response.data);
  },

  async create(data: ExportMappingCreatePayload): Promise<ExportMapping> {
    const response = await api.post<ExportMapping>('/finance/export/mappings', data);
    return response.data;
  },

  async update(id: string, data: ExportMappingUpdatePayload): Promise<ExportMapping> {
    const response = await api.put<ExportMapping>(`/finance/export/mappings/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/finance/export/mappings/${id}`);
  },

  async readiness(): Promise<ExportReadiness> {
    const response = await api.get<ExportReadiness>('/finance/export/readiness');
    return response.data;
  },

  /** Export history, newest first. */
  async logs(params?: { skip?: number; limit?: number }): Promise<ExportLog[]> {
    const response = await api.get<ExportLog[]>('/finance/export/logs', { params });
    return asArray(response.data);
  },

  /** Set the department's default QuickBooks accounts for dues payments. */
  async setDuesDefaults(data: DuesDefaultAccountsPayload): Promise<DuesExportReadiness> {
    const response = await api.put<DuesExportReadiness>('/finance/export/dues-accounts', data);
    return response.data;
  },

  async setAdvanceAccounts(data: AdvanceAccountsPayload): Promise<AdvanceExportReadiness> {
    const response = await api.put<AdvanceExportReadiness>('/finance/export/advance-accounts', data);
    return response.data;
  },

  /** Record that an export's file was imported into QuickBooks. */
  async confirmImported(logId: string): Promise<ExportLog> {
    const response = await api.post<ExportLog>(`/finance/export/logs/${encodeURIComponent(logId)}/imported`);
    return response.data;
  },

  /** Undo a confirmation made by mistake. */
  async withdrawImported(logId: string): Promise<ExportLog> {
    const response = await api.delete<ExportLog>(`/finance/export/logs/${encodeURIComponent(logId)}/imported`);
    return response.data;
  },

  async chart(): Promise<QuickBooksChart> {
    const response = await api.get<QuickBooksChart>('/finance/export/chart-of-accounts');
    return response.data;
  },

  /** Replace the chart of accounts with QuickBooks' exported Account List report. */
  async uploadChart(file: File): Promise<QuickBooksChart> {
    const response = await api.post<QuickBooksChart>('/finance/export/chart-of-accounts', receiptForm(file), {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /** Remove the uploaded chart, which stops the account name check. */
  async clearChart(): Promise<void> {
    await api.delete('/finance/export/chart-of-accounts');
  },

  /** Run the QuickBooks export for a period, as the file the server names. */
  async run(data: ExportRunPayload): Promise<DownloadedFile> {
    const response = await api.post<Blob>('/finance/export/transactions', data, { responseType: 'blob' });
    const header: unknown = response.headers['content-disposition'];
    return {
      blob: response.data,
      filename:
        filenameFromContentDisposition(typeof header === 'string' ? header : undefined) ?? 'quickbooks-journal.csv',
    };
  },
};
