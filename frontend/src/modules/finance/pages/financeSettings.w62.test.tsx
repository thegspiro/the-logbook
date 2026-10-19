/**
 * Workflow review W62: Finance Settings and Approval Chains.
 *
 * - A fiscal year's dates are calendar dates stored at UTC midnight; formatted
 *   as instants, FY2026 read "12/31/2025 - 12/30/2026" west of UTC.
 * - The Create Fiscal Year and budget category panels were not dialogs to
 *   assistive technology, did not close on Escape, and the fiscal year's
 *   fields were not tied to their labels.
 * - None of the six New Approval Chain fields was tied to its label.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { FiscalYear } from '../types';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

const { storeState } = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  return { storeState: state };
});

vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState.current) : storeState.current,
}));

// West of UTC: an instant at UTC midnight falls on the previous local day.
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: () => true, user: { id: 'u-me' } }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../services/api', () => ({
  budgetCategoryService: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  fiscalYearService: { lock: vi.fn() },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
  approvalChainService: {
    approverCoverage: () => Promise.resolve([]),
  },
}));

import FiscalYearSettingsPage from './FiscalYearSettingsPage';
import ApprovalChainsSettingsPage from './ApprovalChainsSettingsPage';

const fy2026: FiscalYear = {
  id: 'fy-1',
  organizationId: 'org',
  name: 'FY2026',
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status: 'draft',
  isLocked: false,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const renderAt = (path: string, Page: React.FC) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route path={path} element={<Page />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('Finance Settings and Approval Chains (W62)', () => {
  beforeEach(() => {
    storeState.current = {
      fiscalYears: [fy2026],
      budgets: [],
      budgetCategories: [],
      approvalChains: [],
      isLoading: false,
      error: null,
      fetchFiscalYears: vi.fn(),
      fetchBudgetCategories: vi.fn(),
      fetchApprovalChains: vi.fn(),
      createFiscalYear: vi.fn(),
      activateFiscalYear: vi.fn(),
    };
  });

  it('shows a fiscal year on the dates it was entered with', () => {
    renderAt('/finance/settings', FiscalYearSettingsPage);
    expect(screen.getByText('1/1/2026 - 12/31/2026')).toBeInTheDocument();
  });

  it('opens Create Fiscal Year as a labelled dialog that Escape closes', async () => {
    const user = userEvent.setup();
    renderAt('/finance/settings', FiscalYearSettingsPage);

    await user.click(screen.getByRole('button', { name: 'New Fiscal Year' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Fiscal Year' });
    expect(dialog).toContainElement(screen.getByLabelText('Name'));
    expect(screen.getByLabelText('Start Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('End Date')).toHaveAttribute('type', 'date');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens the category form as a labelled dialog', async () => {
    const user = userEvent.setup();
    renderAt('/finance/settings', FiscalYearSettingsPage);

    await user.click(screen.getByRole('button', { name: 'New Category' }));
    expect(screen.getByRole('dialog', { name: 'Create Budget Category' })).toBeInTheDocument();
  });

  it('ties every New Approval Chain field to its label', async () => {
    const user = userEvent.setup();
    renderAt('/finance/settings/approval-chains', ApprovalChainsSettingsPage);

    await user.click((await screen.findAllByRole('button', { name: 'New Chain' }))[0] ?? document.body);
    for (const label of [
      'Name *',
      'Description',
      'Applies To *',
      'Budget Category (optional)',
      'Min Amount ($)',
      'Max Amount ($)',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
