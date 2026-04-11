import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock declarations (must precede vi.mock) ----

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

// ---- Import store AFTER mocks are in place ----
import { useFinanceStore } from './financeStore';

// ---- Helpers ----

function getState() {
  return useFinanceStore.getState();
}

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

// ---- Tests ----

describe('financeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFinanceStore.setState(initialState);
  });

  // =========================================================================
  // Initial State
  // =========================================================================

  describe('initial state', () => {
    it('should have correct default values', () => {
      const state = getState();
      expect(state.fiscalYears).toEqual([]);
      expect(state.budgetCategories).toEqual([]);
      expect(state.budgets).toEqual([]);
      expect(state.budgetSummary).toBeNull();
      expect(state.approvalChains).toEqual([]);
      expect(state.pendingApprovals).toEqual([]);
      expect(state.purchaseRequests).toEqual([]);
      expect(state.selectedPurchaseRequest).toBeNull();
      expect(state.expenseReports).toEqual([]);
      expect(state.selectedExpenseReport).toBeNull();
      expect(state.checkRequests).toEqual([]);
      expect(state.selectedCheckRequest).toBeNull();
      expect(state.duesSchedules).toEqual([]);
      expect(state.memberDues).toEqual([]);
      expect(state.duesSummary).toBeNull();
      expect(state.dashboard).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // =========================================================================
  // Fiscal Year Operations
  // =========================================================================

  describe('fetchFiscalYears', () => {
    it('should load fiscal years successfully', async () => {
      const years = [{ id: 'fy1', name: 'FY2026', status: 'active' }];
      mockFYList.mockResolvedValue(years);

      const promise = getState().fetchFiscalYears();

      expect(getState().isLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.fiscalYears).toEqual(years);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockFYList.mockRejectedValue(new Error('Connection refused'));

      await getState().fetchFiscalYears();

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Connection refused');
    });
  });

  describe('createFiscalYear', () => {
    it('should create and prepend to list', async () => {
      const existing = { id: 'fy-old', name: 'FY2025', status: 'closed' };
      useFinanceStore.setState({ fiscalYears: [existing] as never[] });

      const fy = { id: 'fy-new', name: 'FY2027', status: 'draft' };
      mockFYCreate.mockResolvedValue(fy);

      const result = await getState().createFiscalYear({
        name: 'FY2027',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      });

      expect(result).toEqual(fy);
      const state = getState();
      expect(state.fiscalYears[0]).toEqual(fy);
      expect(state.fiscalYears).toHaveLength(2);
      expect(state.isLoading).toBe(false);
    });

    it('should throw and set error on creation failure', async () => {
      mockFYCreate.mockRejectedValue(new Error('Duplicate name'));

      await expect(
        getState().createFiscalYear({
          name: 'FY2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      ).rejects.toThrow('Duplicate name');

      expect(getState().error).toBe('Duplicate name');
      expect(getState().isLoading).toBe(false);
    });
  });

  describe('activateFiscalYear', () => {
    it('should activate and refresh list', async () => {
      const refreshed = [{ id: 'fy1', name: 'FY2026', status: 'active' }];
      mockFYActivate.mockResolvedValue(undefined);
      mockFYList.mockResolvedValue(refreshed);

      await getState().activateFiscalYear('fy1');

      expect(mockFYActivate).toHaveBeenCalledWith('fy1');
      expect(mockFYList).toHaveBeenCalledWith();
      expect(getState().fiscalYears).toEqual(refreshed);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error during activation', async () => {
      mockFYActivate.mockRejectedValue(new Error('Cannot activate'));

      await getState().activateFiscalYear('fy1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Cannot activate');
    });
  });

  // =========================================================================
  // Budget Operations
  // =========================================================================

  describe('fetchBudgetCategories', () => {
    it('should load categories', async () => {
      const cats = [{ id: 'cat1', name: 'Operations' }];
      mockBudgetCatList.mockResolvedValue(cats);

      await getState().fetchBudgetCategories();

      expect(getState().budgetCategories).toEqual(cats);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockBudgetCatList.mockRejectedValue(new Error('Failed to load'));

      await getState().fetchBudgetCategories();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Failed to load');
    });
  });

  describe('fetchBudgets', () => {
    it('should load budgets with optional params', async () => {
      const budgets = [{ id: 'b1', amountBudgeted: 50000 }];
      mockBudgetList.mockResolvedValue(budgets);

      await getState().fetchBudgets({ fiscalYearId: 'fy1' });

      expect(mockBudgetList).toHaveBeenCalledWith({ fiscalYearId: 'fy1' });
      expect(getState().budgets).toEqual(budgets);
    });

    it('should load budgets without params', async () => {
      mockBudgetList.mockResolvedValue([]);

      await getState().fetchBudgets();

      expect(mockBudgetList).toHaveBeenCalledWith(undefined);
      expect(getState().budgets).toEqual([]);
    });

    it('should handle error', async () => {
      mockBudgetList.mockRejectedValue(new Error('Server error'));

      await getState().fetchBudgets();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Server error');
    });
  });

  describe('fetchBudgetSummary', () => {
    it('should load budget summary', async () => {
      const summary = { totalBudgeted: 100000, totalSpent: 45000 };
      mockBudgetGetSummary.mockResolvedValue(summary);

      await getState().fetchBudgetSummary('fy1');

      expect(mockBudgetGetSummary).toHaveBeenCalledWith('fy1');
      expect(getState().budgetSummary).toEqual(summary);
    });

    it('should handle error', async () => {
      mockBudgetGetSummary.mockRejectedValue(new Error('Not found'));

      await getState().fetchBudgetSummary('bad-id');

      expect(getState().error).toBe('Not found');
    });
  });

  describe('createBudget', () => {
    it('should create and append to list', async () => {
      const existing = { id: 'b-old', amountBudgeted: 5000 };
      useFinanceStore.setState({ budgets: [existing] as never[] });

      const budget = { id: 'b-new', amountBudgeted: 10000 };
      mockBudgetCreate.mockResolvedValue(budget);

      const result = await getState().createBudget({
        fiscalYearId: 'fy1',
        categoryId: 'cat1',
        amountBudgeted: 10000,
      });

      expect(result).toEqual(budget);
      const state = getState();
      expect(state.budgets).toHaveLength(2);
      expect(state.budgets).toContainEqual(budget);
      expect(state.isLoading).toBe(false);
    });

    it('should throw and set error on failure', async () => {
      mockBudgetCreate.mockRejectedValue(new Error('Budget exists'));

      await expect(
        getState().createBudget({
          fiscalYearId: 'fy1',
          categoryId: 'cat1',
          amountBudgeted: 10000,
        }),
      ).rejects.toThrow('Budget exists');

      expect(getState().error).toBe('Budget exists');
      expect(getState().isLoading).toBe(false);
    });
  });

  // =========================================================================
  // Approval Chain Operations
  // =========================================================================

  describe('fetchApprovalChains', () => {
    it('should load approval chains', async () => {
      const chains = [{ id: 'ac1', name: 'Standard' }];
      mockApprovalChainList.mockResolvedValue(chains);

      await getState().fetchApprovalChains();

      expect(getState().approvalChains).toEqual(chains);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockApprovalChainList.mockRejectedValue(new Error('Timeout'));

      await getState().fetchApprovalChains();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Timeout');
    });
  });

  describe('createApprovalChain', () => {
    it('should create and append to list', async () => {
      const chain = { id: 'ac-new', name: 'New Chain' };
      mockApprovalChainCreate.mockResolvedValue(chain);

      const result = await getState().createApprovalChain({
        name: 'New Chain',
      } as never);

      expect(result).toEqual(chain);
      expect(getState().approvalChains).toContainEqual(chain);
      expect(getState().isLoading).toBe(false);
    });

    it('should throw and set error on failure', async () => {
      mockApprovalChainCreate.mockRejectedValue(new Error('Invalid'));

      await expect(
        getState().createApprovalChain({ name: 'Bad' } as never),
      ).rejects.toThrow('Invalid');

      expect(getState().error).toBe('Invalid');
    });
  });

  describe('deleteApprovalChain', () => {
    it('should delete and remove from list locally', async () => {
      mockApprovalChainDelete.mockResolvedValue(undefined);

      useFinanceStore.setState({
        approvalChains: [
          { id: 'ac1', name: 'First' },
          { id: 'ac2', name: 'Second' },
        ] as never[],
      });

      await getState().deleteApprovalChain('ac1');

      expect(mockApprovalChainDelete).toHaveBeenCalledWith('ac1');
      const state = getState();
      expect(state.approvalChains).toHaveLength(1);
      expect(state.approvalChains[0]).toEqual({ id: 'ac2', name: 'Second' });
      expect(state.isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockApprovalChainDelete.mockRejectedValue(new Error('Forbidden'));

      useFinanceStore.setState({
        approvalChains: [{ id: 'ac1', name: 'Chain' }] as never[],
      });

      await getState().deleteApprovalChain('ac1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Forbidden');
    });
  });

  // =========================================================================
  // Approval Operations
  // =========================================================================

  describe('fetchPendingApprovals', () => {
    it('should load pending approvals', async () => {
      const pending = [
        { stepRecordId: 'sr1', entityType: 'purchase_request', entityTitle: 'New Hose' },
      ];
      mockApprovalGetPending.mockResolvedValue(pending);

      await getState().fetchPendingApprovals();

      expect(getState().pendingApprovals).toEqual(pending);
    });

    it('should handle error', async () => {
      mockApprovalGetPending.mockRejectedValue(new Error('Unauthorized'));

      await getState().fetchPendingApprovals();

      expect(getState().error).toBe('Unauthorized');
    });
  });

  describe('approveStep', () => {
    it('should approve and refresh pending list', async () => {
      mockApprovalApprove.mockResolvedValue(undefined);
      mockApprovalGetPending.mockResolvedValue([]);

      await getState().approveStep('step1', 'Looks good');

      expect(mockApprovalApprove).toHaveBeenCalledWith('step1', 'Looks good');
      expect(mockApprovalGetPending).toHaveBeenCalledWith();
      expect(getState().pendingApprovals).toEqual([]);
      expect(getState().isLoading).toBe(false);
    });

    it('should approve without notes', async () => {
      mockApprovalApprove.mockResolvedValue(undefined);
      mockApprovalGetPending.mockResolvedValue([]);

      await getState().approveStep('step1');

      expect(mockApprovalApprove).toHaveBeenCalledWith('step1', undefined);
    });

    it('should handle error', async () => {
      mockApprovalApprove.mockRejectedValue(new Error('Already processed'));

      await getState().approveStep('step1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Already processed');
    });
  });

  describe('denyStep', () => {
    it('should deny and refresh pending list', async () => {
      mockApprovalDeny.mockResolvedValue(undefined);
      mockApprovalGetPending.mockResolvedValue([]);

      await getState().denyStep('step1', 'Over budget');

      expect(mockApprovalDeny).toHaveBeenCalledWith('step1', 'Over budget');
      expect(mockApprovalGetPending).toHaveBeenCalledWith();
      expect(getState().pendingApprovals).toEqual([]);
      expect(getState().isLoading).toBe(false);
    });

    it('should deny without notes', async () => {
      mockApprovalDeny.mockResolvedValue(undefined);
      mockApprovalGetPending.mockResolvedValue([]);

      await getState().denyStep('step1');

      expect(mockApprovalDeny).toHaveBeenCalledWith('step1', undefined);
    });

    it('should handle error', async () => {
      mockApprovalDeny.mockRejectedValue(new Error('Not authorized'));

      await getState().denyStep('step1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Not authorized');
    });
  });

  // =========================================================================
  // Purchase Request Operations
  // =========================================================================

  describe('fetchPurchaseRequests', () => {
    it('should load purchase requests with filters', async () => {
      const prs = [{ id: 'pr1', status: 'pending' }];
      mockPRList.mockResolvedValue(prs);

      await getState().fetchPurchaseRequests({ status: 'pending' });

      expect(mockPRList).toHaveBeenCalledWith({ status: 'pending' });
      expect(getState().purchaseRequests).toEqual(prs);
      expect(getState().isLoading).toBe(false);
    });

    it('should load purchase requests without filters', async () => {
      mockPRList.mockResolvedValue([]);

      await getState().fetchPurchaseRequests();

      expect(mockPRList).toHaveBeenCalledWith(undefined);
      expect(getState().purchaseRequests).toEqual([]);
    });

    it('should handle error', async () => {
      mockPRList.mockRejectedValue(new Error('Network error'));

      await getState().fetchPurchaseRequests();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Network error');
    });
  });

  describe('fetchPurchaseRequest', () => {
    it('should load single purchase request into selectedPurchaseRequest', async () => {
      const pr = { id: 'pr1', title: 'New radio', status: 'draft' };
      mockPRGet.mockResolvedValue(pr);

      await getState().fetchPurchaseRequest('pr1');

      expect(mockPRGet).toHaveBeenCalledWith('pr1');
      expect(getState().selectedPurchaseRequest).toEqual(pr);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockPRGet.mockRejectedValue(new Error('Not found'));

      await getState().fetchPurchaseRequest('bad-id');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Not found');
    });
  });

  describe('createPurchaseRequest', () => {
    it('should create and prepend to list', async () => {
      const existing = { id: 'pr-old', title: 'Old request', status: 'draft' };
      useFinanceStore.setState({ purchaseRequests: [existing] as never[] });

      const pr = { id: 'pr-new', title: 'Helmets', status: 'draft' };
      mockPRCreate.mockResolvedValue(pr);

      const result = await getState().createPurchaseRequest({
        title: 'Helmets',
      } as never);

      expect(result).toEqual(pr);
      const state = getState();
      expect(state.purchaseRequests[0]).toEqual(pr);
      expect(state.purchaseRequests).toHaveLength(2);
      expect(state.isLoading).toBe(false);
    });

    it('should throw and set error on failure', async () => {
      mockPRCreate.mockRejectedValue(new Error('Missing fields'));

      await expect(
        getState().createPurchaseRequest({ title: '' } as never),
      ).rejects.toThrow('Missing fields');

      expect(getState().error).toBe('Missing fields');
    });
  });

  describe('submitPurchaseRequest', () => {
    it('should submit and update the PR in the list inline', async () => {
      const existing = { id: 'pr1', title: 'Helmets', status: 'draft' };
      useFinanceStore.setState({
        purchaseRequests: [existing] as never[],
      });

      const submitted = { id: 'pr1', title: 'Helmets', status: 'submitted' };
      mockPRSubmit.mockResolvedValue(submitted);

      await getState().submitPurchaseRequest('pr1');

      expect(mockPRSubmit).toHaveBeenCalledWith('pr1');
      const state = getState();
      expect(state.purchaseRequests[0]).toEqual(submitted);
      expect(state.isLoading).toBe(false);
    });

    it('should update selectedPurchaseRequest if it matches', async () => {
      const pr = { id: 'pr1', title: 'Helmets', status: 'draft' };
      useFinanceStore.setState({
        purchaseRequests: [pr] as never[],
        selectedPurchaseRequest: pr as never,
      });

      const submitted = { id: 'pr1', title: 'Helmets', status: 'submitted' };
      mockPRSubmit.mockResolvedValue(submitted);

      await getState().submitPurchaseRequest('pr1');

      expect(getState().selectedPurchaseRequest).toEqual(submitted);
    });

    it('should not update selectedPurchaseRequest if it does not match', async () => {
      const selected = { id: 'pr-other', title: 'Other', status: 'draft' };
      const pr = { id: 'pr1', title: 'Helmets', status: 'draft' };
      useFinanceStore.setState({
        purchaseRequests: [pr] as never[],
        selectedPurchaseRequest: selected as never,
      });

      const submitted = { id: 'pr1', title: 'Helmets', status: 'submitted' };
      mockPRSubmit.mockResolvedValue(submitted);

      await getState().submitPurchaseRequest('pr1');

      expect(getState().selectedPurchaseRequest).toEqual(selected);
    });

    it('should handle error', async () => {
      mockPRSubmit.mockRejectedValue(new Error('Cannot submit'));

      await getState().submitPurchaseRequest('pr1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Cannot submit');
    });
  });

  // =========================================================================
  // Expense Report Operations
  // =========================================================================

  describe('fetchExpenseReports', () => {
    it('should load expense reports with params', async () => {
      const reports = [{ id: 'er1', status: 'draft' }];
      mockERList.mockResolvedValue(reports);

      await getState().fetchExpenseReports({ status: 'draft' });

      expect(mockERList).toHaveBeenCalledWith({ status: 'draft' });
      expect(getState().expenseReports).toEqual(reports);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockERList.mockRejectedValue(new Error('Server error'));

      await getState().fetchExpenseReports();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Server error');
    });
  });

  describe('fetchExpenseReport', () => {
    it('should load single expense report into selectedExpenseReport', async () => {
      const report = { id: 'er1', title: 'Training expenses', status: 'draft' };
      mockERGet.mockResolvedValue(report);

      await getState().fetchExpenseReport('er1');

      expect(mockERGet).toHaveBeenCalledWith('er1');
      expect(getState().selectedExpenseReport).toEqual(report);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockERGet.mockRejectedValue(new Error('Not found'));

      await getState().fetchExpenseReport('bad-id');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Not found');
    });
  });

  describe('createExpenseReport', () => {
    it('should create and prepend to list', async () => {
      const report = { id: 'er-new', title: 'Conference', status: 'draft' };
      mockERCreate.mockResolvedValue(report);

      const result = await getState().createExpenseReport({
        title: 'Conference',
      } as never);

      expect(result).toEqual(report);
      expect(getState().expenseReports[0]).toEqual(report);
      expect(getState().isLoading).toBe(false);
    });

    it('should throw and set error on failure', async () => {
      mockERCreate.mockRejectedValue(new Error('Validation error'));

      await expect(
        getState().createExpenseReport({ title: '' } as never),
      ).rejects.toThrow('Validation error');

      expect(getState().error).toBe('Validation error');
    });
  });

  describe('submitExpenseReport', () => {
    it('should submit and update the report in the list inline', async () => {
      const existing = { id: 'er1', title: 'Travel', status: 'draft' };
      useFinanceStore.setState({
        expenseReports: [existing] as never[],
      });

      const submitted = { id: 'er1', title: 'Travel', status: 'submitted' };
      mockERSubmit.mockResolvedValue(submitted);

      await getState().submitExpenseReport('er1');

      expect(mockERSubmit).toHaveBeenCalledWith('er1');
      expect(getState().expenseReports[0]).toEqual(submitted);
      expect(getState().isLoading).toBe(false);
    });

    it('should update selectedExpenseReport if it matches', async () => {
      const report = { id: 'er1', title: 'Travel', status: 'draft' };
      useFinanceStore.setState({
        expenseReports: [report] as never[],
        selectedExpenseReport: report as never,
      });

      const submitted = { id: 'er1', title: 'Travel', status: 'submitted' };
      mockERSubmit.mockResolvedValue(submitted);

      await getState().submitExpenseReport('er1');

      expect(getState().selectedExpenseReport).toEqual(submitted);
    });

    it('should not update selectedExpenseReport if it does not match', async () => {
      const selected = { id: 'er-other', title: 'Other', status: 'draft' };
      useFinanceStore.setState({
        expenseReports: [{ id: 'er1', title: 'Travel', status: 'draft' }] as never[],
        selectedExpenseReport: selected as never,
      });

      mockERSubmit.mockResolvedValue({ id: 'er1', title: 'Travel', status: 'submitted' });

      await getState().submitExpenseReport('er1');

      expect(getState().selectedExpenseReport).toEqual(selected);
    });

    it('should handle error', async () => {
      mockERSubmit.mockRejectedValue(new Error('Cannot submit'));

      await getState().submitExpenseReport('er1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Cannot submit');
    });
  });

  // =========================================================================
  // Check Request Operations
  // =========================================================================

  describe('fetchCheckRequests', () => {
    it('should load check requests with params', async () => {
      const crs = [{ id: 'cr1', status: 'draft' }];
      mockCRList.mockResolvedValue(crs);

      await getState().fetchCheckRequests({ status: 'draft' });

      expect(mockCRList).toHaveBeenCalledWith({ status: 'draft' });
      expect(getState().checkRequests).toEqual(crs);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockCRList.mockRejectedValue(new Error('Server error'));

      await getState().fetchCheckRequests();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Server error');
    });
  });

  describe('fetchCheckRequest', () => {
    it('should load single check request into selectedCheckRequest', async () => {
      const cr = { id: 'cr1', payeeName: 'Vendor Inc', status: 'draft' };
      mockCRGet.mockResolvedValue(cr);

      await getState().fetchCheckRequest('cr1');

      expect(mockCRGet).toHaveBeenCalledWith('cr1');
      expect(getState().selectedCheckRequest).toEqual(cr);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockCRGet.mockRejectedValue(new Error('Not found'));

      await getState().fetchCheckRequest('bad-id');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Not found');
    });
  });

  describe('createCheckRequest', () => {
    it('should create and prepend to list', async () => {
      const cr = { id: 'cr-new', payeeName: 'Supplier Co', status: 'draft' };
      mockCRCreate.mockResolvedValue(cr);

      const result = await getState().createCheckRequest({
        payeeName: 'Supplier Co',
      } as never);

      expect(result).toEqual(cr);
      expect(getState().checkRequests[0]).toEqual(cr);
      expect(getState().isLoading).toBe(false);
    });

    it('should throw and set error on failure', async () => {
      mockCRCreate.mockRejectedValue(new Error('Missing payee'));

      await expect(
        getState().createCheckRequest({ payeeName: '' } as never),
      ).rejects.toThrow('Missing payee');

      expect(getState().error).toBe('Missing payee');
    });
  });

  describe('submitCheckRequest', () => {
    it('should submit and update the check request in the list inline', async () => {
      const existing = { id: 'cr1', payeeName: 'Vendor', status: 'draft' };
      useFinanceStore.setState({
        checkRequests: [existing] as never[],
      });

      const submitted = { id: 'cr1', payeeName: 'Vendor', status: 'submitted' };
      mockCRSubmit.mockResolvedValue(submitted);

      await getState().submitCheckRequest('cr1');

      expect(mockCRSubmit).toHaveBeenCalledWith('cr1');
      expect(getState().checkRequests[0]).toEqual(submitted);
      expect(getState().isLoading).toBe(false);
    });

    it('should update selectedCheckRequest if it matches', async () => {
      const cr = { id: 'cr1', payeeName: 'Vendor', status: 'draft' };
      useFinanceStore.setState({
        checkRequests: [cr] as never[],
        selectedCheckRequest: cr as never,
      });

      const submitted = { id: 'cr1', payeeName: 'Vendor', status: 'submitted' };
      mockCRSubmit.mockResolvedValue(submitted);

      await getState().submitCheckRequest('cr1');

      expect(getState().selectedCheckRequest).toEqual(submitted);
    });

    it('should not update selectedCheckRequest if it does not match', async () => {
      const selected = { id: 'cr-other', payeeName: 'Other', status: 'draft' };
      useFinanceStore.setState({
        checkRequests: [{ id: 'cr1', payeeName: 'Vendor', status: 'draft' }] as never[],
        selectedCheckRequest: selected as never,
      });

      mockCRSubmit.mockResolvedValue({ id: 'cr1', payeeName: 'Vendor', status: 'submitted' });

      await getState().submitCheckRequest('cr1');

      expect(getState().selectedCheckRequest).toEqual(selected);
    });

    it('should handle error', async () => {
      mockCRSubmit.mockRejectedValue(new Error('Not allowed'));

      await getState().submitCheckRequest('cr1');

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Not allowed');
    });
  });

  // =========================================================================
  // Dues Operations
  // =========================================================================

  describe('fetchDuesSchedules', () => {
    it('should load dues schedules', async () => {
      const schedules = [{ id: 'ds1', name: 'Annual Dues', amount: 100 }];
      mockDuesListSchedules.mockResolvedValue(schedules);

      await getState().fetchDuesSchedules();

      expect(getState().duesSchedules).toEqual(schedules);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle error', async () => {
      mockDuesListSchedules.mockRejectedValue(new Error('Connection lost'));

      await getState().fetchDuesSchedules();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Connection lost');
    });
  });

  describe('fetchMemberDues', () => {
    it('should load member dues with params', async () => {
      const dues = [{ id: 'md1', userId: 'u1', status: 'paid' }];
      mockDuesListMemberDues.mockResolvedValue(dues);

      await getState().fetchMemberDues({ scheduleId: 'ds1', status: 'paid' });

      expect(mockDuesListMemberDues).toHaveBeenCalledWith({
        scheduleId: 'ds1',
        status: 'paid',
      });
      expect(getState().memberDues).toEqual(dues);
      expect(getState().isLoading).toBe(false);
    });

    it('should load member dues without params', async () => {
      mockDuesListMemberDues.mockResolvedValue([]);

      await getState().fetchMemberDues();

      expect(mockDuesListMemberDues).toHaveBeenCalledWith(undefined);
    });

    it('should handle error', async () => {
      mockDuesListMemberDues.mockRejectedValue(new Error('Failed'));

      await getState().fetchMemberDues();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Failed');
    });
  });

  describe('fetchDuesSummary', () => {
    it('should load dues summary with scheduleId', async () => {
      const summary = { totalExpected: 5000, totalCollected: 3000 };
      mockDuesGetSummary.mockResolvedValue(summary);

      await getState().fetchDuesSummary('ds1');

      expect(mockDuesGetSummary).toHaveBeenCalledWith('ds1');
      expect(getState().duesSummary).toEqual(summary);
    });

    it('should load dues summary without scheduleId', async () => {
      const summary = { totalExpected: 10000, totalCollected: 8000 };
      mockDuesGetSummary.mockResolvedValue(summary);

      await getState().fetchDuesSummary();

      expect(mockDuesGetSummary).toHaveBeenCalledWith(undefined);
      expect(getState().duesSummary).toEqual(summary);
    });

    it('should handle error', async () => {
      mockDuesGetSummary.mockRejectedValue(new Error('Unavailable'));

      await getState().fetchDuesSummary();

      expect(getState().error).toBe('Unavailable');
    });
  });

  // =========================================================================
  // Dashboard
  // =========================================================================

  describe('fetchDashboard', () => {
    it('should load dashboard data', async () => {
      const dashboard = {
        budgetHealth: { totalBudgeted: 500000, totalSpent: 200000 },
        pendingApprovalsCount: 3,
      };
      mockDashboardGet.mockResolvedValue(dashboard);

      await getState().fetchDashboard();

      expect(getState().dashboard).toEqual(dashboard);
      expect(getState().isLoading).toBe(false);
    });

    it('should handle dashboard error', async () => {
      mockDashboardGet.mockRejectedValue(new Error('Timeout'));

      await getState().fetchDashboard();

      expect(getState().dashboard).toBeNull();
      expect(getState().error).toBe('Timeout');
      expect(getState().isLoading).toBe(false);
    });
  });

  // =========================================================================
  // General Error Handling
  // =========================================================================

  describe('error handling', () => {
    it('sets isLoading to false on any fetch error', async () => {
      mockFYList.mockRejectedValue(new Error('fail'));

      await getState().fetchFiscalYears();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBeTypeOf('string');
    });

    it('clears previous error before new fetch', async () => {
      useFinanceStore.setState({ error: 'old error' });
      mockFYList.mockResolvedValue([]);

      await getState().fetchFiscalYears();

      expect(getState().error).toBeNull();
    });

    it('sets isLoading true at start of fetch', async () => {
      mockBudgetList.mockImplementation(
        () => new Promise(() => {}),
      );

      void getState().fetchBudgets();

      expect(getState().isLoading).toBe(true);
    });

    it('handles non-Error thrown values using fallback message', async () => {
      mockPRList.mockRejectedValue('string error');

      await getState().fetchPurchaseRequests();

      expect(getState().isLoading).toBe(false);
      expect(getState().error).toBe('Failed to load purchase requests');
    });
  });
});
