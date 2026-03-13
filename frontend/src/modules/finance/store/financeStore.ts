/**
 * Finance Store
 *
 * Zustand store for managing finance module state.
 */

import { create } from 'zustand';
import {
  approvalChainService,
  approvalService,
  budgetCategoryService,
  budgetService,
  checkRequestService,
  duesService,
  expenseReportService,
  financeDashboardService,
  fiscalYearService,
  purchaseRequestService,
} from '../services/api';
import type {
  ApprovalChain,
  Budget,
  BudgetCategory,
  BudgetSummary,
  CheckRequest,
  DuesSchedule,
  DuesSummary,
  ExpenseReport,
  FinanceDashboard,
  FiscalYear,
  MemberDues,
  PendingApproval,
  PurchaseRequest,
} from '../types';
import { handleStoreError } from '../../../utils/storeHelpers';

interface FinanceState {
  // Data
  fiscalYears: FiscalYear[];
  budgetCategories: BudgetCategory[];
  budgets: Budget[];
  budgetSummary: BudgetSummary | null;
  approvalChains: ApprovalChain[];
  pendingApprovals: PendingApproval[];
  purchaseRequests: PurchaseRequest[];
  selectedPurchaseRequest: PurchaseRequest | null;
  expenseReports: ExpenseReport[];
  selectedExpenseReport: ExpenseReport | null;
  checkRequests: CheckRequest[];
  selectedCheckRequest: CheckRequest | null;
  duesSchedules: DuesSchedule[];
  memberDues: MemberDues[];
  duesSummary: DuesSummary | null;
  dashboard: FinanceDashboard | null;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Fiscal Year Actions
  fetchFiscalYears: () => Promise<void>;
  createFiscalYear: (data: {
    name: string;
    startDate: string;
    endDate: string;
  }) => Promise<FiscalYear>;
  activateFiscalYear: (id: string) => Promise<void>;

  // Budget Actions
  fetchBudgetCategories: () => Promise<void>;
  fetchBudgets: (params?: {
    fiscalYearId?: string;
    categoryId?: string;
  }) => Promise<void>;
  fetchBudgetSummary: (fiscalYearId: string) => Promise<void>;
  createBudget: (data: {
    fiscalYearId: string;
    categoryId: string;
    amountBudgeted: number;
    notes?: string;
  }) => Promise<Budget>;

  // Approval Chain Actions
  fetchApprovalChains: () => Promise<void>;
  createApprovalChain: (
    data: Partial<ApprovalChain>,
  ) => Promise<ApprovalChain>;
  deleteApprovalChain: (id: string) => Promise<void>;

  // Approval Actions
  fetchPendingApprovals: () => Promise<void>;
  approveStep: (
    stepRecordId: string,
    notes?: string,
  ) => Promise<void>;
  denyStep: (stepRecordId: string, notes?: string) => Promise<void>;

  // Purchase Request Actions
  fetchPurchaseRequests: (params?: {
    status?: string;
    fiscalYearId?: string;
  }) => Promise<void>;
  fetchPurchaseRequest: (id: string) => Promise<void>;
  createPurchaseRequest: (
    data: Partial<PurchaseRequest>,
  ) => Promise<PurchaseRequest>;
  submitPurchaseRequest: (id: string) => Promise<void>;

  // Expense Report Actions
  fetchExpenseReports: (params?: { status?: string }) => Promise<void>;
  fetchExpenseReport: (id: string) => Promise<void>;
  createExpenseReport: (
    data: Partial<ExpenseReport>,
  ) => Promise<ExpenseReport>;
  submitExpenseReport: (id: string) => Promise<void>;

  // Check Request Actions
  fetchCheckRequests: (params?: { status?: string }) => Promise<void>;
  fetchCheckRequest: (id: string) => Promise<void>;
  createCheckRequest: (
    data: Partial<CheckRequest>,
  ) => Promise<CheckRequest>;
  submitCheckRequest: (id: string) => Promise<void>;

  // Dues Actions
  fetchDuesSchedules: () => Promise<void>;
  fetchMemberDues: (params?: {
    scheduleId?: string;
    userId?: string;
    status?: string;
  }) => Promise<void>;
  fetchDuesSummary: (scheduleId?: string) => Promise<void>;

  // Dashboard
  fetchDashboard: () => Promise<void>;
}

export const useFinanceStore = create<FinanceState>((set) => ({
  // Initial state
  fiscalYears: [],
  budgetCategories: [],
  budgets: [],
  budgetSummary: null,
  approvalChains: [],
  pendingApprovals: [],
  purchaseRequests: [],
  selectedPurchaseRequest: null,
  expenseReports: [],
  selectedExpenseReport: null,
  checkRequests: [],
  selectedCheckRequest: null,
  duesSchedules: [],
  memberDues: [],
  duesSummary: null,
  dashboard: null,
  isLoading: false,
  error: null,

  // Fiscal Year Actions
  fetchFiscalYears: async () => {
    set({ isLoading: true, error: null });
    try {
      const fiscalYears = await fiscalYearService.list();
      set({ fiscalYears, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load fiscal years'), isLoading: false });
    }
  },

  createFiscalYear: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const fy = await fiscalYearService.create(data);
      set((state) => ({
        fiscalYears: [fy, ...state.fiscalYears],
        isLoading: false,
      }));
      return fy;
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to create fiscal year'), isLoading: false });
      throw err;
    }
  },

  activateFiscalYear: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await fiscalYearService.activate(id);
      const fiscalYears = await fiscalYearService.list();
      set({ fiscalYears, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to activate fiscal year'), isLoading: false });
    }
  },

  // Budget Actions
  fetchBudgetCategories: async () => {
    set({ isLoading: true, error: null });
    try {
      const budgetCategories = await budgetCategoryService.list();
      set({ budgetCategories, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load budget categories'), isLoading: false });
    }
  },

  fetchBudgets: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const budgets = await budgetService.list(params);
      set({ budgets, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load budgets'), isLoading: false });
    }
  },

  fetchBudgetSummary: async (fiscalYearId) => {
    try {
      const budgetSummary = await budgetService.getSummary(fiscalYearId);
      set({ budgetSummary });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load budget summary'), isLoading: false });
    }
  },

  createBudget: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const budget = await budgetService.create(data);
      set((state) => ({
        budgets: [...state.budgets, budget],
        isLoading: false,
      }));
      return budget;
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to create budget'), isLoading: false });
      throw err;
    }
  },

  // Approval Chain Actions
  fetchApprovalChains: async () => {
    set({ isLoading: true, error: null });
    try {
      const approvalChains = await approvalChainService.list();
      set({ approvalChains, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load approval chains'), isLoading: false });
    }
  },

  createApprovalChain: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const chain = await approvalChainService.create(data);
      set((state) => ({
        approvalChains: [...state.approvalChains, chain],
        isLoading: false,
      }));
      return chain;
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to create approval chain'), isLoading: false });
      throw err;
    }
  },

  deleteApprovalChain: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await approvalChainService.delete(id);
      set((state) => ({
        approvalChains: state.approvalChains.filter((c) => c.id !== id),
        isLoading: false,
      }));
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to delete approval chain'), isLoading: false });
    }
  },

  // Approval Actions
  fetchPendingApprovals: async () => {
    try {
      const pendingApprovals = await approvalService.getPending();
      set({ pendingApprovals });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load pending approvals'), isLoading: false });
    }
  },

  approveStep: async (stepRecordId, notes) => {
    set({ isLoading: true, error: null });
    try {
      await approvalService.approve(stepRecordId, notes);
      const pendingApprovals = await approvalService.getPending();
      set({ pendingApprovals, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to approve'), isLoading: false });
    }
  },

  denyStep: async (stepRecordId, notes) => {
    set({ isLoading: true, error: null });
    try {
      await approvalService.deny(stepRecordId, notes);
      const pendingApprovals = await approvalService.getPending();
      set({ pendingApprovals, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to deny'), isLoading: false });
    }
  },

  // Purchase Request Actions
  fetchPurchaseRequests: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const purchaseRequests = await purchaseRequestService.list(params);
      set({ purchaseRequests, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load purchase requests'), isLoading: false });
    }
  },

  fetchPurchaseRequest: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const selectedPurchaseRequest = await purchaseRequestService.get(id);
      set({ selectedPurchaseRequest, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load purchase request'), isLoading: false });
    }
  },

  createPurchaseRequest: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const pr = await purchaseRequestService.create(data);
      set((state) => ({
        purchaseRequests: [pr, ...state.purchaseRequests],
        isLoading: false,
      }));
      return pr;
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to create purchase request'), isLoading: false });
      throw err;
    }
  },

  submitPurchaseRequest: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const pr = await purchaseRequestService.submit(id);
      set((state) => ({
        purchaseRequests: state.purchaseRequests.map((p) =>
          p.id === id ? pr : p,
        ),
        selectedPurchaseRequest:
          state.selectedPurchaseRequest?.id === id
            ? pr
            : state.selectedPurchaseRequest,
        isLoading: false,
      }));
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to submit purchase request'), isLoading: false });
    }
  },

  // Expense Report Actions
  fetchExpenseReports: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const expenseReports = await expenseReportService.list(params);
      set({ expenseReports, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load expense reports'), isLoading: false });
    }
  },

  fetchExpenseReport: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const selectedExpenseReport = await expenseReportService.get(id);
      set({ selectedExpenseReport, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load expense report'), isLoading: false });
    }
  },

  createExpenseReport: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const er = await expenseReportService.create(data);
      set((state) => ({
        expenseReports: [er, ...state.expenseReports],
        isLoading: false,
      }));
      return er;
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to create expense report'), isLoading: false });
      throw err;
    }
  },

  submitExpenseReport: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const er = await expenseReportService.submit(id);
      set((state) => ({
        expenseReports: state.expenseReports.map((e) =>
          e.id === id ? er : e,
        ),
        selectedExpenseReport:
          state.selectedExpenseReport?.id === id
            ? er
            : state.selectedExpenseReport,
        isLoading: false,
      }));
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to submit expense report'), isLoading: false });
    }
  },

  // Check Request Actions
  fetchCheckRequests: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const checkRequests = await checkRequestService.list(params);
      set({ checkRequests, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load check requests'), isLoading: false });
    }
  },

  fetchCheckRequest: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const selectedCheckRequest = await checkRequestService.get(id);
      set({ selectedCheckRequest, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load check request'), isLoading: false });
    }
  },

  createCheckRequest: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const cr = await checkRequestService.create(data);
      set((state) => ({
        checkRequests: [cr, ...state.checkRequests],
        isLoading: false,
      }));
      return cr;
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to create check request'), isLoading: false });
      throw err;
    }
  },

  submitCheckRequest: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const cr = await checkRequestService.submit(id);
      set((state) => ({
        checkRequests: state.checkRequests.map((c) =>
          c.id === id ? cr : c,
        ),
        selectedCheckRequest:
          state.selectedCheckRequest?.id === id
            ? cr
            : state.selectedCheckRequest,
        isLoading: false,
      }));
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to submit check request'), isLoading: false });
    }
  },

  // Dues Actions
  fetchDuesSchedules: async () => {
    set({ isLoading: true, error: null });
    try {
      const duesSchedules = await duesService.listSchedules();
      set({ duesSchedules, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load dues schedules'), isLoading: false });
    }
  },

  fetchMemberDues: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const memberDues = await duesService.listMemberDues(params);
      set({ memberDues, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load member dues'), isLoading: false });
    }
  },

  fetchDuesSummary: async (scheduleId) => {
    try {
      const duesSummary = await duesService.getSummary(scheduleId);
      set({ duesSummary });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load dues summary'), isLoading: false });
    }
  },

  // Dashboard
  fetchDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const dashboard = await financeDashboardService.getDashboard();
      set({ dashboard, isLoading: false });
    } catch (err) {
      set({ error: handleStoreError(err, 'Failed to load finance dashboard'), isLoading: false });
    }
  },
}));
