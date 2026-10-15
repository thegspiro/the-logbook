/**
 * Workflow review W68: an opportunity, then an application through to its
 * report, as the treasurer.
 *
 * - The budget dialog sent "Equipment" / "Indirect Costs"; the API takes the
 *   lowercase codes, and the totals concatenated the Decimal strings.
 * - Notes went out as type "comment", which the API does not accept, and
 *   "Mark Complete" sent a UTC instant to a date-only field.
 * - "Assigned To" was a free-text box for a field that stores a member's id,
 *   and the form had no way to record what was awarded or when reports fall due.
 * - The dashboard read a date-only due date as UTC midnight, so a task due
 *   today read Overdue by mid-morning.
 * - "Start Application" was offered to members the application route refuses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { createMockApiError } from '@/test/utils';

const {
  storeState,
  granted,
  addBudgetItem,
  addGrantNote,
  updateComplianceTask,
  getDirectory,
  getApplication,
  createApplication,
  listOpportunities,
  toastError,
} = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  const permissions: { current: string[] } = { current: [] };
  return {
    storeState: state,
    granted: permissions,
    addBudgetItem: vi.fn(),
    addGrantNote: vi.fn(),
    updateComplianceTask: vi.fn(),
    getDirectory: vi.fn(),
    getApplication: vi.fn(),
    createApplication: vi.fn(),
    listOpportunities: vi.fn(),
    toastError: vi.fn(),
  };
});

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.current.includes(p) }),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args) as unknown,
  });
  return { default: toast };
});
vi.mock('../store/grantsStore', () => ({
  useGrantsStore: () => storeState.current,
}));
vi.mock('@/services/memberDirectoryService', () => ({
  memberDirectoryService: { getDirectory: (...args: unknown[]) => getDirectory(...args) as unknown },
}));
vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: (...args: unknown[]) => listOpportunities(...args) as unknown,
    getApplication: (...args: unknown[]) => getApplication(...args) as unknown,
    createApplication: (...args: unknown[]) => createApplication(...args) as unknown,
    updateApplication: vi.fn(),
  },
}));

import GrantDetailPage from './GrantDetailPage';
import GrantApplicationFormPage from './GrantApplicationFormPage';
import GrantsDashboardPage from './GrantsDashboardPage';
import GrantOpportunitiesPage from './GrantOpportunitiesPage';

const TESS = { id: 'u-tess', first_name: 'Tess', last_name: 'Park', full_name: 'Tess Park', status: 'active' };

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    grantProgramName: 'Small Equipment Grant',
    grantAgency: 'SFM',
    applicationStatus: 'active',
    amountRequested: '18500.00',
    amountAwarded: '17000.00',
    matchAmount: null,
    priority: 'medium',
    assignedTo: null,
    budgetItems: [],
    expenditures: [],
    complianceTasks: [],
    grantNotes: [],
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/grants/applications/app-1']}>
      <Routes>
        <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const mock of [
    addBudgetItem,
    addGrantNote,
    updateComplianceTask,
    getDirectory,
    getApplication,
    createApplication,
    listOpportunities,
    toastError,
  ]) {
    mock.mockReset();
  }
  addBudgetItem.mockResolvedValue({});
  addGrantNote.mockResolvedValue({});
  updateComplianceTask.mockResolvedValue({});
  getDirectory.mockResolvedValue([TESS]);
  listOpportunities.mockResolvedValue([]);
  createApplication.mockResolvedValue({ id: 'app-2' });
  granted.current = ['fundraising.view', 'fundraising.manage'];
  storeState.current = {
    currentApplication: application(),
    isLoading: false,
    error: null,
    fetchApplication: () => Promise.resolve(),
    addBudgetItem,
    addExpenditure: vi.fn(),
    addComplianceTask: vi.fn(),
    updateComplianceTask,
    addGrantNote,
  };
});

describe('Grant detail page (W68)', () => {
  it('sends the category code the API stores, and labels it on the way back', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Budget' }));
    await user.click(screen.getByRole('button', { name: 'Add Budget Item' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'Indirect Costs');
    await user.type(within(dialog).getByLabelText('Description'), 'Administration');
    await user.type(within(dialog).getByLabelText('Amount'), '500');
    await user.click(within(dialog).getByRole('button', { name: 'Add Budget Item' }));

    await waitFor(() =>
      expect(addBudgetItem).toHaveBeenCalledWith('app-1', {
        category: 'indirect',
        description: 'Administration',
        amountBudgeted: 500,
      })
    );
  });

  it("shows the server's reason when a budget line is refused", async () => {
    addBudgetItem.mockRejectedValue(createMockApiError('Application not found', 400));
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Budget' }));
    await user.click(screen.getByRole('button', { name: 'Add Budget Item' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'Equipment');
    await user.type(within(dialog).getByLabelText('Description'), 'Cameras');
    await user.type(within(dialog).getByLabelText('Amount'), '16000');
    await user.click(within(dialog).getByRole('button', { name: 'Add Budget Item' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Application not found'));
  });

  it('adds up budget lines served as Decimal strings', async () => {
    storeState.current = {
      ...storeState.current,
      currentApplication: application({
        budgetItems: [
          {
            id: 'b1',
            category: 'equipment',
            description: 'Cameras',
            amountBudgeted: '16000.00',
            amountSpent: '900.00',
          },
          { id: 'b2', category: 'indirect', description: 'Admin', amountBudgeted: '500.00', amountSpent: '0.00' },
        ],
      }),
    };
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Budget' }));
    expect(screen.getAllByText('$16,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Indirect Costs')).toBeInTheDocument();
    // "900.00" > "16000.00" as strings — compared as numbers it is under budget.
    expect(screen.queryByText('-$15,100.00')).not.toBeInTheDocument();
    expect(screen.getByText('$15,100.00')).toBeInTheDocument();
  });

  it('marks a task complete with the status alone, leaving the date to the server', async () => {
    storeState.current = {
      ...storeState.current,
      currentApplication: application({
        complianceTasks: [
          {
            id: 't1',
            title: 'Q4 report',
            taskType: 'performance_report',
            status: 'pending',
            priority: 'medium',
            dueDate: '2027-01-15',
            assignedTo: 'u-tess',
          },
        ],
      }),
    };
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Compliance & Follow-Up' }));
    expect(await screen.findByText('Assigned: Tess Park')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark Complete' }));

    await waitFor(() => expect(updateComplianceTask).toHaveBeenCalledWith('app-1', 't1', { status: 'completed' }));
  });

  it('files a note under a type the API accepts', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Activity Log' }));
    await user.type(screen.getByRole('textbox'), 'Cameras delivered.');
    await user.click(screen.getByRole('button', { name: 'Add Note' }));

    await waitFor(() =>
      expect(addGrantNote).toHaveBeenCalledWith('app-1', { noteType: 'general', content: 'Cameras delivered.' })
    );
  });
});

describe('Grant application form (W68)', () => {
  it('assigns a member by id and records the award and report dates', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/grants/applications/new']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/grant program name/i), 'Small Equipment Grant');
    await user.type(screen.getByLabelText(/grant agency/i), 'SFM');
    await user.selectOptions(
      screen.getByLabelText('Assigned To'),
      await screen.findByRole('option', { name: 'Tess Park' })
    );
    await user.type(screen.getByLabelText('Amount Awarded'), '17000');
    await user.type(screen.getByLabelText('Award Date'), '2026-10-14');
    await user.type(screen.getByLabelText('Next Report Due'), '2027-01-15');
    await user.click(screen.getByRole('button', { name: 'Create Application' }));

    await waitFor(() => expect(createApplication).toHaveBeenCalled());
    expect(createApplication.mock.calls[0]?.[0]).toMatchObject({
      assignedTo: 'u-tess',
      amountAwarded: 17000,
      awardDate: '2026-10-14',
      nextReportDue: '2027-01-15',
    });
  });

  it('keeps a saved assignee the member list cannot show', async () => {
    getDirectory.mockRejectedValue(createMockApiError('Forbidden', 403));
    getApplication.mockResolvedValue({
      ...application({ assignedTo: 'u-archived' }),
      opportunityId: null,
      allowedNextStatuses: ['reporting'],
    });
    render(
      <MemoryRouter initialEntries={['/grants/applications/app-1/edit']}>
        <Routes>
          <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
        </Routes>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Assigned To');
    await waitFor(() => expect(select).toHaveValue('u-archived'));
    expect(within(select).getByRole('option', { name: 'Current assignee' })).toBeInTheDocument();
  });
});

describe('Grants dashboard deadlines (W68)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls a task due today "Due today", counted on the department calendar', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 9:58 in Chicago on 15 October — past UTC midnight by most of a day.
    vi.setSystemTime(new Date('2026-10-15T14:58:00Z'));
    storeState.current = {
      dashboard: {
        activeGrants: 1,
        pendingApplications: 0,
        totalGrantFunding: 17000,
        totalRaisedYtd: 0,
        totalRaised12Mo: 0,
        activeCampaignsCount: 0,
        activeCampaigns: [],
        recentDonations: [],
        upcomingDeadlines: [{ id: 'o1', name: 'Small Equipment Grant', agency: 'SFM', deadlineDate: '2026-11-20' }],
        complianceTasksDue: [
          { id: 't1', applicationId: 'app-1', title: 'Inventory', status: 'pending', dueDate: '2026-10-15' },
        ],
        outstandingPledges: 0,
        totalDonors: 0,
        pipelineSummary: [],
      },
      isLoading: false,
      error: null,
      fetchDashboard: () => Promise.resolve(),
      clearError: () => undefined,
    };
    render(
      <MemoryRouter>
        <GrantsDashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Due today')).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(screen.getByText('36d left')).toBeInTheDocument();
  });
});

describe('Grant opportunities (W68)', () => {
  const opportunity = {
    id: 'o1',
    name: 'Small Equipment Grant',
    agency: 'SFM',
    category: 'equipment',
    deadlineDate: null,
    matchRequired: false,
    typicalAwardMin: null,
    typicalAwardMax: null,
  };

  it('offers Start Application to a member who can create one', async () => {
    listOpportunities.mockResolvedValue([opportunity]);
    render(
      <MemoryRouter>
        <GrantOpportunitiesPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: /start application/i })).toBeInTheDocument();
  });

  it('does not offer it to a member who can only view', async () => {
    granted.current = ['fundraising.view'];
    listOpportunities.mockResolvedValue([opportunity]);
    render(
      <MemoryRouter>
        <GrantOpportunitiesPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Small Equipment Grant')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /start application/i })).not.toBeInTheDocument();
  });
});
