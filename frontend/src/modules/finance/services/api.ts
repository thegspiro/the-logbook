/**
 * Finance API Service
 *
 * Handles all API calls for the Finance module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  ApprovalChain,
  ApprovalStepRecord,
  Budget,
  BudgetCategory,
  BudgetSummary,
  CheckRequest,
  DuesSchedule,
  DuesSummary,
  ExpenseLineItem,
  ExpenseReport,
  ExportLog,
  ExportMapping,
  FinanceDashboard,
  FiscalYear,
  MemberDues,
  PendingApproval,
  PurchaseRequest,
} from '../types';

const api = createApiClient();

// =============================================================================
// Fiscal Years
// =============================================================================

export const fiscalYearService = {
  async list(): Promise<FiscalYear[]> {
    const response = await api.get<FiscalYear[]>('/finance/fiscal-years');
    return response.data;
  },

  async get(id: string): Promise<FiscalYear> {
    const response = await api.get<FiscalYear>(`/finance/fiscal-years/${id}`);
    return response.data;
  },

  async create(data: {
    name: string;
    startDate: string;
    endDate: string;
  }): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>('/finance/fiscal-years', data);
    return response.data;
  },

  async update(
    id: string,
    data: Partial<FiscalYear>,
  ): Promise<FiscalYear> {
    const response = await api.put<FiscalYear>(
      `/finance/fiscal-years/${id}`,
      data,
    );
    return response.data;
  },

  async activate(id: string): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(
      `/finance/fiscal-years/${id}/activate`,
    );
    return response.data;
  },

  async lock(id: string): Promise<FiscalYear> {
    const response = await api.post<FiscalYear>(
      `/finance/fiscal-years/${id}/lock`,
    );
    return response.data;
  },
};

// =============================================================================
// Budget Categories
// =============================================================================

export const budgetCategoryService = {
  async list(): Promise<BudgetCategory[]> {
    const response = await api.get<BudgetCategory[]>(
      '/finance/budget-categories',
    );
    return response.data;
  },

  async create(data: {
    name: string;
    description?: string;
    parentCategoryId?: string;
    sortOrder?: number;
    qbAccountName?: string;
  }): Promise<BudgetCategory> {
    const response = await api.post<BudgetCategory>(
      '/finance/budget-categories',
      data,
    );
    return response.data;
  },

  async update(
    id: string,
    data: Partial<BudgetCategory>,
  ): Promise<BudgetCategory> {
    const response = await api.put<BudgetCategory>(
      `/finance/budget-categories/${id}`,
      data,
    );
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
  async list(params?: {
    fiscalYearId?: string;
    categoryId?: string;
  }): Promise<Budget[]> {
    const response = await api.get<Budget[]>('/finance/budgets', {
      params: {
        fiscal_year_id: params?.fiscalYearId,
        category_id: params?.categoryId,
      },
    });
    return response.data;
  },

  async get(id: string): Promise<Budget> {
    const response = await api.get<Budget>(`/finance/budgets/${id}`);
    return response.data;
  },

  async create(data: {
    fiscalYearId: string;
    categoryId: string;
    amountBudgeted: number;
    notes?: string;
    stationId?: string;
  }): Promise<Budget> {
    const response = await api.post<Budget>('/finance/budgets', data);
    return response.data;
  },

  async update(id: string, data: Partial<Budget>): Promise<Budget> {
    const response = await api.put<Budget>(`/finance/budgets/${id}`, data);
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
// Approval Chains
// =============================================================================

export const approvalChainService = {
  async list(): Promise<ApprovalChain[]> {
    const response = await api.get<ApprovalChain[]>(
      '/finance/approval-chains',
    );
    return response.data;
  },

  async get(id: string): Promise<ApprovalChain> {
    const response = await api.get<ApprovalChain>(
      `/finance/approval-chains/${id}`,
    );
    return response.data;
  },

  async create(data: Partial<ApprovalChain>): Promise<ApprovalChain> {
    const response = await api.post<ApprovalChain>(
      '/finance/approval-chains',
      data,
    );
    return response.data;
  },

  async update(
    id: string,
    data: Partial<ApprovalChain>,
  ): Promise<ApprovalChain> {
    const response = await api.put<ApprovalChain>(
      `/finance/approval-chains/${id}`,
      data,
    );
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/finance/approval-chains/${id}`);
  },

  async addStep(
    chainId: string,
    data: Partial<ApprovalChain['steps'][number]>,
  ): Promise<ApprovalChain['steps'][number]> {
    const response = await api.post(
      `/finance/approval-chains/${chainId}/steps`,
      data,
    );
    return response.data;
  },

  async updateStep(
    chainId: string,
    stepId: string,
    data: Partial<ApprovalChain['steps'][number]>,
  ): Promise<ApprovalChain['steps'][number]> {
    const response = await api.put(
      `/finance/approval-chains/${chainId}/steps/${stepId}`,
      data,
    );
    return response.data;
  },

  async deleteStep(chainId: string, stepId: string): Promise<void> {
    await api.delete(
      `/finance/approval-chains/${chainId}/steps/${stepId}`,
    );
  },

  async preview(params: {
    entityType: string;
    amount: number;
    categoryId?: string;
  }): Promise<ApprovalChain> {
    const response = await api.get<ApprovalChain>(
      '/finance/approval-chains/preview',
      {
        params: {
          entity_type: params.entityType,
          amount: params.amount,
          category_id: params.categoryId,
        },
      },
    );
    return response.data;
  },
};

// =============================================================================
// Approvals
// =============================================================================

export const approvalService = {
  async getPending(): Promise<PendingApproval[]> {
    const response = await api.get<PendingApproval[]>(
      '/finance/approvals/pending',
    );
    return response.data;
  },

  async approve(
    stepRecordId: string,
    notes?: string,
  ): Promise<ApprovalStepRecord> {
    const response = await api.post<ApprovalStepRecord>(
      `/finance/approvals/${stepRecordId}/approve`,
      { notes: notes || undefined },
    );
    return response.data;
  },

  async deny(
    stepRecordId: string,
    notes?: string,
  ): Promise<ApprovalStepRecord> {
    const response = await api.post<ApprovalStepRecord>(
      `/finance/approvals/${stepRecordId}/deny`,
      { notes: notes || undefined },
    );
    return response.data;
  },
};

// =============================================================================
// Purchase Requests
// =============================================================================

export const purchaseRequestService = {
  async list(params?: {
    status?: string;
    fiscalYearId?: string;
  }): Promise<PurchaseRequest[]> {
    const response = await api.get<PurchaseRequest[]>(
      '/finance/purchase-requests',
      {
        params: {
          status: params?.status,
          fiscal_year_id: params?.fiscalYearId,
        },
      },
    );
    return response.data;
  },

  async get(id: string): Promise<PurchaseRequest> {
    const response = await api.get<PurchaseRequest>(
      `/finance/purchase-requests/${id}`,
    );
    return response.data;
  },

  async create(
    data: Partial<PurchaseRequest>,
  ): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(
      '/finance/purchase-requests',
      data,
    );
    return response.data;
  },

  async update(
    id: string,
    data: Partial<PurchaseRequest>,
  ): Promise<PurchaseRequest> {
    const response = await api.put<PurchaseRequest>(
      `/finance/purchase-requests/${id}`,
      data,
    );
    return response.data;
  },

  async submit(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(
      `/finance/purchase-requests/${id}/submit`,
    );
    return response.data;
  },

  async markOrdered(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(
      `/finance/purchase-requests/${id}/mark-ordered`,
    );
    return response.data;
  },

  async markReceived(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(
      `/finance/purchase-requests/${id}/mark-received`,
    );
    return response.data;
  },

  async markPaid(
    id: string,
    actualAmount?: number,
  ): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(
      `/finance/purchase-requests/${id}/mark-paid`,
      undefined,
      { params: { actual_amount: actualAmount } },
    );
    return response.data;
  },

  async cancel(id: string): Promise<PurchaseRequest> {
    const response = await api.post<PurchaseRequest>(
      `/finance/purchase-requests/${id}/cancel`,
    );
    return response.data;
  },
};

// =============================================================================
// Expense Reports
// =============================================================================

export const expenseReportService = {
  async list(params?: { status?: string }): Promise<ExpenseReport[]> {
    const response = await api.get<ExpenseReport[]>(
      '/finance/expense-reports',
      { params: { status: params?.status } },
    );
    return response.data;
  },

  async get(id: string): Promise<ExpenseReport> {
    const response = await api.get<ExpenseReport>(
      `/finance/expense-reports/${id}`,
    );
    return response.data;
  },

  async create(data: Partial<ExpenseReport>): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(
      '/finance/expense-reports',
      data,
    );
    return response.data;
  },

  async update(
    id: string,
    data: Partial<ExpenseReport>,
  ): Promise<ExpenseReport> {
    const response = await api.put<ExpenseReport>(
      `/finance/expense-reports/${id}`,
      data,
    );
    return response.data;
  },

  async addLineItem(
    id: string,
    data: Partial<ExpenseLineItem>,
  ): Promise<ExpenseLineItem> {
    const response = await api.post<ExpenseLineItem>(
      `/finance/expense-reports/${id}/items`,
      data,
    );
    return response.data;
  },

  async submit(id: string): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(
      `/finance/expense-reports/${id}/submit`,
    );
    return response.data;
  },

  async markPaid(
    id: string,
    paymentMethod?: string,
  ): Promise<ExpenseReport> {
    const response = await api.post<ExpenseReport>(
      `/finance/expense-reports/${id}/mark-paid`,
      undefined,
      { params: { payment_method: paymentMethod } },
    );
    return response.data;
  },
};

// =============================================================================
// Check Requests
// =============================================================================

export const checkRequestService = {
  async list(params?: { status?: string }): Promise<CheckRequest[]> {
    const response = await api.get<CheckRequest[]>(
      '/finance/check-requests',
      { params: { status: params?.status } },
    );
    return response.data;
  },

  async get(id: string): Promise<CheckRequest> {
    const response = await api.get<CheckRequest>(
      `/finance/check-requests/${id}`,
    );
    return response.data;
  },

  async create(data: Partial<CheckRequest>): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(
      '/finance/check-requests',
      data,
    );
    return response.data;
  },

  async update(
    id: string,
    data: Partial<CheckRequest>,
  ): Promise<CheckRequest> {
    const response = await api.put<CheckRequest>(
      `/finance/check-requests/${id}`,
      data,
    );
    return response.data;
  },

  async submit(id: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(
      `/finance/check-requests/${id}/submit`,
    );
    return response.data;
  },

  async issue(id: string, checkNumber: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(
      `/finance/check-requests/${id}/issue`,
      undefined,
      { params: { check_number: checkNumber } },
    );
    return response.data;
  },

  async void(id: string): Promise<CheckRequest> {
    const response = await api.post<CheckRequest>(
      `/finance/check-requests/${id}/void`,
    );
    return response.data;
  },
};

// =============================================================================
// Dues
// =============================================================================

export const duesService = {
  async listSchedules(): Promise<DuesSchedule[]> {
    const response = await api.get<DuesSchedule[]>(
      '/finance/dues-schedules',
    );
    return response.data;
  },

  async createSchedule(
    data: Partial<DuesSchedule>,
  ): Promise<DuesSchedule> {
    const response = await api.post<DuesSchedule>(
      '/finance/dues-schedules',
      data,
    );
    return response.data;
  },

  async updateSchedule(
    id: string,
    data: Partial<DuesSchedule>,
  ): Promise<DuesSchedule> {
    const response = await api.put<DuesSchedule>(
      `/finance/dues-schedules/${id}`,
      data,
    );
    return response.data;
  },

  async generateDues(
    scheduleId: string,
  ): Promise<{ generated: number }> {
    const response = await api.post<{ generated: number }>(
      `/finance/dues-schedules/${scheduleId}/generate`,
    );
    return response.data;
  },

  async listMemberDues(params?: {
    scheduleId?: string;
    userId?: string;
    status?: string;
  }): Promise<MemberDues[]> {
    const response = await api.get<MemberDues[]>('/finance/dues', {
      params: {
        schedule_id: params?.scheduleId,
        user_id: params?.userId,
        status: params?.status,
      },
    });
    return response.data;
  },

  async recordPayment(
    duesId: string,
    data: {
      amountPaid: number;
      paymentMethod?: string;
      transactionReference?: string;
      notes?: string;
    },
  ): Promise<MemberDues> {
    const response = await api.put<MemberDues>(
      `/finance/dues/${duesId}`,
      data,
    );
    return response.data;
  },

  async waive(
    duesId: string,
    reason: string,
  ): Promise<MemberDues> {
    const response = await api.post<MemberDues>(
      `/finance/dues/${duesId}/waive`,
      { reason },
    );
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

export const exportService = {
  async listMappings(): Promise<ExportMapping[]> {
    const response = await api.get<ExportMapping[]>(
      '/finance/export/mappings',
    );
    return response.data;
  },

  async createMapping(
    data: Partial<ExportMapping>,
  ): Promise<ExportMapping> {
    const response = await api.post<ExportMapping>(
      '/finance/export/mappings',
      data,
    );
    return response.data;
  },

  async updateMapping(
    id: string,
    data: Partial<ExportMapping>,
  ): Promise<ExportMapping> {
    const response = await api.put<ExportMapping>(
      `/finance/export/mappings/${id}`,
      data,
    );
    return response.data;
  },

  async generateExport(data: {
    dateRangeStart: string;
    dateRangeEnd: string;
    fileFormat?: string;
  }): Promise<Blob> {
    const response = await api.post('/finance/export/transactions', data, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  async listLogs(): Promise<ExportLog[]> {
    const response = await api.get<ExportLog[]>('/finance/export/logs');
    return response.data;
  },
};

// =============================================================================
// Dashboard
// =============================================================================

export const financeDashboardService = {
  async getDashboard(): Promise<FinanceDashboard> {
    const response = await api.get<FinanceDashboard>(
      '/finance/dashboard',
    );
    return response.data;
  },
};
