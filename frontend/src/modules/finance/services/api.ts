/**
 * Finance API Service
 *
 * Handles all API calls for the Finance module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { fetchFile, type DownloadedFile } from '../../../utils/fileDownload';
import type {
  ApprovalChain,
  ApprovalChainCreatePayload,
  ApprovalChainStep,
  ApprovalChainStepCreatePayload,
  ApprovalChainStepUpdatePayload,
  ApprovalChainUpdatePayload,
  ApprovalEntityType,
  ApprovalStepRecord,
  ApproverCoverageRow,
  Budget,
  BudgetAmendment,
  BudgetAmendmentCreatePayload,
  BudgetAmendmentCreated,
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
  CheckRequest,
  DuesSchedule,
  DuesSummary,
  ExpenseLineItem,
  ExpenseReport,
  FinanceDashboard,
  FiscalYear,
  ExportMapping,
  ExportMappingCreatePayload,
  ExportMappingUpdatePayload,
  ExportReadiness,
  FiscalYearOption,
  FiscalYearAdoptionPayload,
  FiscalYearUpdatePayload,
  FinanceNamedOption,
  MemberDues,
  MyBudget,
  MyBudgetRequestLines,
  MyBudgetsSummary,
  PendingApproval,
  PurchaseRequest,
  MonetaryAmount,
  StartFromLastYearResult,
  UnroutedApproval,
} from '../types';
import { asArray } from '../../../utils/asArray';

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

  /** A draft is adopted: it must be in board review, and `adoption` is the board's vote. */
  async activate(id: string, adoption?: FiscalYearAdoptionPayload): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/activate`, adoption);
    return response.data;
  },

  /** Move a draft year one planning stage forward or back. */
  async setPlanningStage(id: string, stage: BudgetPlanningStage): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/planning-stage`, { stage });
    return response.data;
  },

  async lock(id: string): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(`/finance/fiscal-years/${id}/lock`);
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
  }): Promise<BudgetCategory> {
    const response = await api.post<BudgetCategory>('/finance/budget-categories', data);
    return response.data;
  },

  async update(id: string, data: BudgetCategoryUpdatePayload): Promise<BudgetCategory> {
    const response = await api.put<BudgetCategory>(`/finance/budget-categories/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/finance/budget-categories/${id}`);
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

  /** Record extra money approved for a line; raises its budget by the amount. */
  async addAmendment(id: string, data: BudgetAmendmentCreatePayload): Promise<BudgetAmendmentCreated> {
    const response = await api.post<BudgetAmendmentCreated>(`/finance/budgets/${id}/amendments`, data);
    return response.data;
  },

  /** Cancel a mistaken amendment with a reversing entry; lowers the budget by it. */
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

const stepDecisionBody = (notes?: string, overrideReason?: string) => ({
  notes: notes || undefined,
  ...(overrideReason ? { overrideReason } : {}),
});

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
  async approve(stepRecordId: string, notes?: string, overrideReason?: string): Promise<ApprovalStepRecord> {
    const response = await api.post<ApprovalStepRecord>(
      `/finance/approvals/${stepRecordId}/approve`,
      stepDecisionBody(notes, overrideReason)
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

  /** Requests waiting for approval that have no approval steps (no chain applied). */
  async getUnrouted(): Promise<UnroutedApproval[]> {
    const response = await api.get<UnroutedApproval[]>('/finance/approvals/unrouted');
    return asArray(response.data);
  },

  /** Approve a request that has no approval steps. Refused (409) for one that has steps. */
  async manualApprove(entityType: ApprovalEntityType, entityId: string, notes?: string): Promise<void> {
    await api.post(`/finance/approvals/manual/${entityType}/${entityId}/approve`, {
      notes: notes || undefined,
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
};

// =============================================================================
// Check Requests
// =============================================================================

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

  async createSchedule(data: Partial<DuesSchedule>): Promise<DuesSchedule> {
    const response = await api.post<DuesSchedule>('/finance/dues-schedules', data);
    return response.data;
  },

  async updateSchedule(id: string, data: Partial<DuesSchedule>): Promise<DuesSchedule> {
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

  async recordPayment(
    duesId: string,
    data: {
      amountPaid: MonetaryAmount;
      paymentMethod?: string;
      transactionReference?: string;
      notes?: string;
    }
  ): Promise<MemberDues> {
    const response = await api.put<MemberDues>(`/finance/dues/${duesId}`, data);
    return response.data;
  },

  async waive(duesId: string, reason: string): Promise<MemberDues> {
    const response = await api.post<MemberDues>(`/finance/dues/${duesId}/waive`, { reason });
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
// Export
// =============================================================================

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
};
