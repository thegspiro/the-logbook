/**
 * Next-year planning on the Finance Settings page (Treasurer only).
 *
 * A draft fiscal year offers "Start from last year" — copy another year's
 * lines in, confirmed first — and the request deadline line owners' budget
 * requests close on. Whether requests are open is the backend's
 * `requestsOpen`; the page only words it. A cleared deadline goes as `null`
 * so it is actually cleared (CLAUDE.md pitfall #1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { FiscalYear } from '../types';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const startFrom = vi.fn();
const updateYear = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: {
    lock: vi.fn(),
    startFrom: (...args: unknown[]) => startFrom(...args) as unknown,
    update: (...args: unknown[]) => updateYear(...args) as unknown,
  },
  budgetCategoryService: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import FiscalYearSettingsPage from './FiscalYearSettingsPage';

const year = (id: string, name: string, status: FiscalYear['status'], extra: Partial<FiscalYear> = {}): FiscalYear => ({
  id,
  organizationId: 'org',
  name,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status,
  isLocked: status === 'closed',
  requestDeadline: null,
  requestsOpen: false,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const fetchFiscalYears = vi.fn();

const renderPage = (fiscalYears: FiscalYear[]) => {
  storeState = {
    fiscalYears,
    budgetCategories: [],
    isLoading: false,
    error: null,
    fetchFiscalYears,
    fetchBudgetCategories: vi.fn(),
    activateFiscalYear: vi.fn(),
    createFiscalYear: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/finance/settings']}>
      <ConfirmProvider>
        <FiscalYearSettingsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );
};

const draft = (extra: Partial<FiscalYear> = {}) =>
  year('fy-draft', 'FY2027', 'draft', { requestsOpen: true, ...extra });
const years = (extra: Partial<FiscalYear> = {}) => [
  draft(extra),
  year('fy-active', 'FY2026', 'active'),
  year('fy-closed', 'FY2025', 'closed'),
];

beforeEach(() => {
  vi.clearAllMocks();
  startFrom.mockReset();
  updateYear.mockReset();
  startFrom.mockResolvedValue({ created: 2, skipped: 1 });
  updateYear.mockResolvedValue(draft());
});

describe('the request window on a fiscal year row', () => {
  it('shows a draft year’s deadline and that requests are open', () => {
    renderPage(years({ requestDeadline: '2026-11-15' }));

    expect(screen.getByText('Requests close Nov 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Requests open')).toBeInTheDocument();
    // Only the draft year carries a request window.
    expect(screen.getAllByText(/Requests (open|closed)/)).toHaveLength(1);
  });

  it('says so when the deadline has passed or there is none', () => {
    renderPage(years({ requestsOpen: false }));

    expect(screen.getByText('No request deadline')).toBeInTheDocument();
    expect(screen.getByText('Requests closed')).toBeInTheDocument();
  });

  it('offers no planning controls on an active or closed year', () => {
    renderPage([year('fy-active', 'FY2026', 'active')]);

    expect(screen.queryByLabelText('Start from last year')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Request deadline')).not.toBeInTheDocument();
  });
});

describe('Start from last year', () => {
  it('copies from the active year after confirming, and reports what it did', async () => {
    const user = userEvent.setup();
    renderPage(years());

    expect(screen.getByLabelText('Start from last year')).toHaveValue('fy-active');
    await user.click(screen.getByRole('button', { name: 'Copy lines' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Copy every budget line from FY2026 into FY2027\?/)).toBeInTheDocument();
    expect(startFrom).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Copy lines' }));

    await waitFor(() => expect(startFrom).toHaveBeenCalledWith('fy-draft', 'fy-active'));
    expect(toastSuccess).toHaveBeenCalledWith('2 lines copied, 1 already there');
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('copies from another year when one is chosen', async () => {
    const user = userEvent.setup();
    startFrom.mockResolvedValue({ created: 1, skipped: 0 });
    renderPage(years());

    await user.selectOptions(screen.getByLabelText('Start from last year'), 'fy-closed');
    await user.click(screen.getByRole('button', { name: 'Copy lines' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Copy lines' }));

    await waitFor(() => expect(startFrom).toHaveBeenCalledWith('fy-draft', 'fy-closed'));
    expect(toastSuccess).toHaveBeenCalledWith('1 line copied, 0 already there');
  });

  it('does nothing when the Treasurer backs out', async () => {
    const user = userEvent.setup();
    renderPage(years());

    await user.click(screen.getByRole('button', { name: 'Copy lines' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(startFrom).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    startFrom.mockRejectedValue(new Error('Lines can only be copied into a draft fiscal year that is not locked.'));
    renderPage(years());

    await user.click(screen.getByRole('button', { name: 'Copy lines' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Copy lines' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Lines can only be copied into a draft fiscal year that is not locked.')
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('the request deadline', () => {
  it('saves a deadline', async () => {
    const user = userEvent.setup();
    renderPage(years());

    await user.type(screen.getByLabelText('Request deadline'), '2026-11-15');
    await user.click(screen.getByRole('button', { name: 'Save deadline' }));

    await waitFor(() => expect(updateYear).toHaveBeenCalledWith('fy-draft', { requestDeadline: '2026-11-15' }));
    expect(toastSuccess).toHaveBeenCalledWith('Request deadline saved');
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('clears a deadline with null', async () => {
    const user = userEvent.setup();
    renderPage(years({ requestDeadline: '2026-11-15' }));

    expect(screen.getByLabelText('Request deadline')).toHaveValue('2026-11-15');
    await user.click(screen.getByRole('button', { name: 'Clear deadline' }));

    await waitFor(() => expect(updateYear).toHaveBeenCalledWith('fy-draft', { requestDeadline: null }));
    expect(toastSuccess).toHaveBeenCalledWith('Request deadline cleared');
  });
});
