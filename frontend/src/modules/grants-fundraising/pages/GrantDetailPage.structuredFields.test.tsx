/**
 * The detail page shows an application's budget summary and key contacts as
 * structured data — and must not break on a stored value of another shape,
 * since both are untyped JSON columns. Its add-budget-item picker sends the
 * backend's category codes: it used to send the labels, which were refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));

const mockAddBudgetItem = vi.fn();
let currentApplication: Record<string, unknown> = {};
vi.mock('../store/grantsStore', () => ({
  useGrantsStore: () => ({
    currentApplication,
    isLoading: false,
    error: null,
    fetchApplication: () => Promise.resolve(),
    addBudgetItem: (...args: unknown[]) => mockAddBudgetItem(...args) as unknown,
    addExpenditure: vi.fn(),
    addComplianceTask: vi.fn(),
    updateComplianceTask: vi.fn(),
    addGrantNote: vi.fn(),
  }),
}));

import GrantDetailPage from './GrantDetailPage';

function application(overrides: Record<string, unknown>) {
  return {
    id: 'app-1',
    grantProgramName: 'AFG',
    grantAgency: 'FEMA',
    applicationStatus: 'active',
    amountRequested: '1000',
    amountAwarded: null,
    matchAmount: null,
    priority: 'medium',
    budgetItems: [],
    expenditures: [],
    complianceTasks: [],
    grantNotes: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/grants/applications/app-1']}>
      <Routes>
        <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GrantDetailPage — budget summary and key contacts', () => {
  beforeEach(() => {
    currentApplication = application({});
    mockAddBudgetItem.mockReset();
    mockAddBudgetItem.mockResolvedValue(undefined);
  });

  it('lists the contacts and the budget by category with a total', () => {
    currentApplication = application({
      budgetSummary: { equipment: 85000, training: 12500, notes: 'SCBA replacement' },
      keyContacts: [{ name: 'Dana Ruiz', role: 'Program officer', email: 'dana@afg.gov' }],
    });
    renderPage();

    expect(screen.getByText('Dana Ruiz')).toBeInTheDocument();
    expect(screen.getByText(/Program officer/)).toBeInTheDocument();
    expect(screen.getByText('dana@afg.gov')).toBeInTheDocument();
    expect(screen.getByText('Equipment')).toBeInTheDocument();
    expect(screen.getByText('$97,500.00')).toBeInTheDocument();
    expect(screen.getByText('SCBA replacement')).toBeInTheDocument();
  });

  it('renders a stored value of another shape without breaking', () => {
    currentApplication = application({
      budgetSummary: { total: 'about 90k' },
      keyContacts: [{ contact: 'Dana' }],
    });
    renderPage();

    expect(screen.getByText('No contacts recorded.')).toBeInTheDocument();
    expect(screen.queryByText('Budget Summary')).not.toBeInTheDocument();
  });

  it('adds a budget item with the category code the backend accepts', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Budget$/ }));
    await user.click(screen.getByRole('button', { name: /Add Budget Item/ }));
    await user.selectOptions(screen.getByLabelText('Category'), 'Indirect Costs');
    await user.type(screen.getByLabelText(/^Description/), 'Admin overhead');
    await user.type(screen.getByLabelText(/^Amount/), '500');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Add Budget Item/ }));

    await waitFor(() =>
      expect(mockAddBudgetItem).toHaveBeenCalledWith('app-1', {
        category: 'indirect',
        description: 'Admin overhead',
        amountBudgeted: 500,
      })
    );
  });
});
