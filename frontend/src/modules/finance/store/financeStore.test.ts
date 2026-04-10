import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFYList = vi.fn();
const mockFYCreate = vi.fn();
const mockFYActivate = vi.fn();
const mockBudgetCatList = vi.fn();
const mockBudgetList = vi.fn();
const mockBudgetGetSummary = vi.fn();
const mockBudgetCreate = vi.fn();
const mockApprovalChainList = vi.fn();
const mockApprovalChainCreate = vi.fn();
const mockApprovalChainDelete = vi.fn();
const mockApprovalGetPending = vi.fn();
const mockApprovalApprove = vi.fn();
const mockApprovalDeny = vi.fn();
const mockPRList = vi.fn();
const mockPRGet = vi.fn();
const mockPRCreate = vi.fn();
const mockPRSubmit = vi.fn();
const mockERList = vi.fn();
const mockERGet = vi.fn();
const mockERCreate = vi.fn();
const mockERSubmit = vi.fn();
const mockCRList = vi.fn();
const mockCRGet = vi.fn();
const mockCRCreate = vi.fn();
const mockCRSubmit = vi.fn();
const mockDuesListSchedules = vi.fn();
const mockDuesListMemberDues = vi.fn();
const mockDuesGetSummary = vi.fn();
const mockDashboardGet = vi.fn();

vi.mock('../services/api', () => ({
  fiscalYearService: {
    list: (...args: unknown[]) => mockFYList(...args) as unknown,
    create: (...args: unknown[]) => mockFYCreate(...args) as unknown,
    activate: (...args: unknown[]) => mockFYActivate(...args) as unknown,
  },
  budgetCategoryService: {
    list: (...args: unknown[]) => mockBudgetCatList(...args) as unknown,
  },
  budgetService: {
    list: (...args: unknown[]) => mockBudgetList(...args) as unknown,
    getSummary: (...args: unknown[]) => mockBudgetGetSummary(...args) as unknown,
    create: (...args: unknown[]) => mockBudgetCreate(...args) as unknown,
  },
  approvalChainService: {
    list: (...args: unknown[]) => mockApprovalChainList(...args) as unknown,
    create: (...args: unknown[]) => mockApprovalChainCreate(...args) as unknown,
    delete: (...args: unknown[]) => mockApprovalChainDelete(...args) as unknown,
  },
  approvalService: {
    getPending: (...args: unknown[]) => mockApprovalGetPending(...args) as unknown,
    approve: (...args: unknown[]) => mockApprovalApprove(...args) as unknown,
    deny: (...args: unknown[]) => mockApprovalDeny(...args) as unknown,
  },
  purchaseRequestService: {
    list: (...args: unknown[]) => mockPRList(...args) as unknown,
    get: (...args: unknown[]) => mockPRGet(...args) as unknown,
    create: (...args: unknown[]) => mockPRCreate(...args) as unknown,
    submit: (...args: unknown[]) => mockPRSubmit(...args) as unknown,
  },
  expenseReportService: {
    list: (...args: unknown[]) => mockERList(...args) as unknown,
    get: (...args: unknown[]) => mockERGet(...args) as unknown,
    create: (...args: unknown[]) => mockERCreate(...args) as unknown,
    submit: (...args: unknown[]) => mockERSubmit(...args) as unknown,
  },
  checkRequestService: {
    list: (...args: unknown[]) => mockCRList(...args) as unknown,
    get: (...args: unknown[]) => mockCRGet(...args) as unknown,
    create: (...args: unknown[]) => mockCRCreate(...args) as unknown,
    submit: (...args: unknown[]) => mockCRSubmit(...args) as unknown,
  },
  duesService: {
    listSchedules: (...args: unknown[]) => mockDuesListSchedules(...args) as unknown,
    listMemberDues: (...args: unknown[]) => mockDuesListMemberDues(...args) as unknown,
    getSummary: (...args: unknown[]) => mockDuesGetSummary(...args) as unknown,
  },
  financeDashboardService: {
    getDashboard: (...args: unknown[]) => mockDashboardGet(...args) as unknown,
  },
}));

vi.mock('../../../utils/storeHelpers', () => ({
  handleStoreError: (err: unknown, fallback: string) => {
    if (err instanceof Error) return err.message;
    return fallback;
  },
}));

import { useFinanceStore } from './financeStore';

const initialState = {
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
};

describe('financeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFinanceStore.setState(initialState);
  });

  // ── Fiscal Year ────────────────────────────────────────────────────

  describe('fetchFiscalYears', () => {
    it('should load fiscal years successfully', async () => {
      const years = [{ id: 'fy1', name: 'FY2026', status: 'active' }];
      mockFYList.mockResolvedValue(years);

      await useFinanceStore.getState().fetchFiscalYears();
      const state = useFinanceStore.getState();

      expect(state.fiscalYears).toEqual(years);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockFYList.mockRejectedValue(new Error('Connection refused'));

      await useFinanceStore.getState().fetchFiscalYears();
      const state = useFinanceStore.getState();

      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Connection refused');
    });
  });

  describe('createFiscalYear', () => {
    it('should create and prepend to list', async () => {
      const fy = { id: 'fy-new', name: 'FY2027', status: 'draft' };
      mockFYCreate.mockResolvedValue(fy);

      const result = await useFinanceStore.getState().createFiscalYear({
        name: 'FY2027',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      });

      expect(result).toEqual(fy);
      expect(useFinanceStore.getState().fiscalYears[0]).toEqual(fy);
      expect(useFinanceStore.getState().isLoading).toBe(false);
    });

    it('should throw on creation failure', async () => {
      mockFYCreate.mockRejectedValue(new Error('Duplicate name'));

      await expect(
        useFinanceStore.getState().createFiscalYear({
          name: 'FY2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      ).rejects.toThrow('Duplicate name');

      expect(useFinanceStore.getState().error).toBe('Duplicate name');
    });
  });

  describe('activateFiscalYear', () => {
    it('should activate and refresh list', async () => {
      const refreshed = [{ id: 'fy1', name: 'FY2026', status: 'active' }];
      mockFYActivate.mockResolvedValue(undefined);
      mockFYList.mockResolvedValue(refreshed);

      await useFinanceStore.getState().activateFiscalYear('fy1');

      expect(mockFYActivate).toHaveBeenCalledWith('fy1');
      expect(mockFYList).toHaveBeenCalled();
      expect(useFinanceStore.getState().fiscalYears).toEqual(refreshed);
    });
  });

  // ── Budget ─────────────────────────────────────────────────────────

  describe('fetchBudgetCategories', () => {
    it('should load categories', async () => {
      const cats = [{ id: 'cat1', name: 'Operations' }];
      mockBudgetCatList.mockResolvedValue(cats);

      await useFinanceStore.getState().fetchBudgetCategories();

      expect(useFinanceStore.getState().budgetCategories).toEqual(cats);
    });
  });

  describe('fetchBudgets', () => {
    it('should load budgets with optional params', async () => {
      const budgets = [{ id: 'b1', amount_budgeted: 50000 }];
      mockBudgetList.mockResolvedValue(budgets);

      await useFinanceStore.getState().fetchBudgets({ fiscalYearId: 'fy1' });

      expect(mockBudgetList).toHaveBeenCalledWith({ fiscalYearId: 'fy1' });
      expect(useFinanceStore.getState().budgets).toEqual(budgets);
    });
  });

  describe('fetchBudgetSummary', () => {
    it('should load budget summary', async () => {
      const summary = { total_budgeted: 100000, total_spent: 45000 };
      mockBudgetGetSummary.mockResolvedValue(summary);

      await useFinanceStore.getState().fetchBudgetSummary('fy1');

      expect(mockBudgetGetSummary).toHaveBeenCalledWith('fy1');
      expect(useFinanceStore.getState().budgetSummary).toEqual(summary);
    });
  });

  describe('createBudget', () => {
    it('should create and append to list', async () => {
      const budget = { id: 'b-new', amount_budgeted: 10000 };
      mockBudgetCreate.mockResolvedValue(budget);

      const result = await useFinanceStore.getState().createBudget({
        fiscalYearId: 'fy1',
        categoryId: 'cat1',
        amountBudgeted: 10000,
      });

      expect(result).toEqual(budget);
      expect(useFinanceStore.getState().budgets).toContainEqual(budget);
    });
  });

  // ── Approval Chains ────────────────────────────────────────────────

  describe('fetchApprovalChains', () => {
    it('should load approval chains', async () => {
      const chains = [{ id: 'ac1', name: 'Standard' }];
      mockApprovalChainList.mockResolvedValue(chains);

      await useFinanceStore.getState().fetchApprovalChains();

      expect(useFinanceStore.getState().approvalChains).toEqual(chains);
    });
  });

  describe('createApprovalChain', () => {
    it('should create and append to list', async () => {
      const chain = { id: 'ac-new', name: 'New Chain' };
      mockApprovalChainCreate.mockResolvedValue(chain);

      const result = await useFinanceStore.getState().createApprovalChain({
        name: 'New Chain',
      } as never);

      expect(result).toEqual(chain);
      expect(useFinanceStore.getState().approvalChains).toContainEqual(chain);
    });
  });

  describe('deleteApprovalChain', () => {
    it('should delete and refresh list', async () => {
      mockApprovalChainDelete.mockResolvedValue(undefined);
      mockApprovalChainList.mockResolvedValue([]);

      useFinanceStore.setState({
        approvalChains: [{ id: 'ac1', name: 'Old' }] as never[],
      });

      await useFinanceStore.getState().deleteApprovalChain('ac1');

      expect(mockApprovalChainDelete).toHaveBeenCalledWith('ac1');
      expect(mockApprovalChainList).toHaveBeenCalled();
    });
  });

  // ── Approvals ──────────────────────────────────────────────────────

  describe('fetchPendingApprovals', () => {
    it('should load pending approvals', async () => {
      const pending = [{ id: 'pa1', status: 'pending' }];
      mockApprovalGetPending.mockResolvedValue(pending);

      await useFinanceStore.getState().fetchPendingApprovals();

      expect(useFinanceStore.getState().pendingApprovals).toEqual(pending);
    });
  });

  describe('approveStep', () => {
    it('should approve and refresh pending list', async () => {
      mockApprovalApprove.mockResolvedValue(undefined);
      mockApprovalGetPending.mockResolvedValue([]);

      await useFinanceStore.getState().approveStep('step1', 'Looks good');

      expect(mockApprovalApprove).toHaveBeenCalledWith('step1', 'Looks good');
      expect(mockApprovalGetPending).toHaveBeenCalled();
    });
  });

  describe('denyStep', () => {
    it('should deny and refresh pending list', async () => {
      mockApprovalDeny.mockResolvedValue(undefined);
      mockApprovalGetPending.mockResolvedValue([]);

      await useFinanceStore.getState().denyStep('step1', 'Over budget');

      expect(mockApprovalDeny).toHaveBeenCalledWith('step1', 'Over budget');
      expect(mockApprovalGetPending).toHaveBeenCalled();
    });
  });

  // ── Purchase Requests ──────────────────────────────────────────────

  describe('fetchPurchaseRequests', () => {
    it('should load purchase requests with filters', async () => {
      const prs = [{ id: 'pr1', status: 'pending' }];
      mockPRList.mockResolvedValue(prs);

      await useFinanceStore.getState().fetchPurchaseRequests({ status: 'pending' });

      expect(mockPRList).toHaveBeenCalledWith({ status: 'pending' });
      expect(useFinanceStore.getState().purchaseRequests).toEqual(prs);
    });
  });

  describe('fetchPurchaseRequest', () => {
    it('should load single purchase request', async () => {
      const pr = { id: 'pr1', title: 'New radio', status: 'draft' };
      mockPRGet.mockResolvedValue(pr);

      await useFinanceStore.getState().fetchPurchaseRequest('pr1');

      expect(mockPRGet).toHaveBeenCalledWith('pr1');
      expect(useFinanceStore.getState().selectedPurchaseRequest).toEqual(pr);
    });
  });

  describe('createPurchaseRequest', () => {
    it('should create and prepend to list', async () => {
      const pr = { id: 'pr-new', title: 'Helmets', status: 'draft' };
      mockPRCreate.mockResolvedValue(pr);

      const result = await useFinanceStore.getState().createPurchaseRequest({
        title: 'Helmets',
      } as never);

      expect(result).toEqual(pr);
      expect(useFinanceStore.getState().purchaseRequests).toContainEqual(pr);
    });
  });

  describe('submitPurchaseRequest', () => {
    it('should submit and refresh list', async () => {
      mockPRSubmit.mockResolvedValue(undefined);
      mockPRList.mockResolvedValue([]);

      await useFinanceStore.getState().submitPurchaseRequest('pr1');

      expect(mockPRSubmit).toHaveBeenCalledWith('pr1');
      expect(mockPRList).toHaveBeenCalled();
    });
  });

  // ── Expense Reports ────────────────────────────────────────────────

  describe('fetchExpenseReports', () => {
    it('should load expense reports', async () => {
      const reports = [{ id: 'er1', status: 'draft' }];
      mockERList.mockResolvedValue(reports);

      await useFinanceStore.getState().fetchExpenseReports({ status: 'draft' });

      expect(mockERList).toHaveBeenCalledWith({ status: 'draft' });
      expect(useFinanceStore.getState().expenseReports).toEqual(reports);
    });
  });

  describe('createExpenseReport', () => {
    it('should create expense report', async () => {
      const report = { id: 'er-new', status: 'draft' };
      mockERCreate.mockResolvedValue(report);

      const result = await useFinanceStore.getState().createExpenseReport({
        description: 'Training materials',
      } as never);

      expect(result).toEqual(report);
    });
  });

  // ── Dashboard ──────────────────────────────────────────────────────

  describe('fetchDashboard', () => {
    it('should load dashboard data', async () => {
      const dashboard = { total_budget: 500000, total_spent: 200000 };
      mockDashboardGet.mockResolvedValue(dashboard);

      await useFinanceStore.getState().fetchDashboard();

      expect(useFinanceStore.getState().dashboard).toEqual(dashboard);
      expect(useFinanceStore.getState().isLoading).toBe(false);
    });

    it('should handle dashboard error', async () => {
      mockDashboardGet.mockRejectedValue(new Error('Timeout'));

      await useFinanceStore.getState().fetchDashboard();

      expect(useFinanceStore.getState().dashboard).toBeNull();
      expect(useFinanceStore.getState().error).toBe('Timeout');
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('sets isLoading to false on any fetch error', async () => {
      mockFYList.mockRejectedValue(new Error('fail'));

      await useFinanceStore.getState().fetchFiscalYears();

      expect(useFinanceStore.getState().isLoading).toBe(false);
      expect(useFinanceStore.getState().error).toBeTruthy();
    });

    it('clears previous error before new fetch', async () => {
      useFinanceStore.setState({ error: 'old error' });
      mockFYList.mockResolvedValue([]);

      await useFinanceStore.getState().fetchFiscalYears();

      expect(useFinanceStore.getState().error).toBeNull();
    });
  });
});
