/**
 * App-review FIN6-F10 / FIN6-F11: a failed load showed "No purchase requests
 * found" beside the error, and the dashboard linked viewers to settings pages
 * that open Access Denied.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

import FinanceDashboardPage from './FinanceDashboardPage';
import PurchaseRequestsPage from './PurchaseRequestsPage';

describe('the purchase request list after a failed load', () => {
  beforeEach(() => {
    granted = new Set(['finance.view', 'finance.request']);
  });

  it('shows the error without an empty-list invitation', () => {
    storeState = { purchaseRequests: [], isLoading: false, error: 'Network Error', fetchPurchaseRequests: vi.fn() };
    render(
      <MemoryRouter>
        <PurchaseRequestsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByText('No purchase requests found')).not.toBeInTheDocument();
  });

  it('still says the list is empty when nothing failed', () => {
    storeState = { purchaseRequests: [], isLoading: false, error: null, fetchPurchaseRequests: vi.fn() };
    render(
      <MemoryRouter>
        <PurchaseRequestsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('No purchase requests found')).toBeInTheDocument();
  });
});

describe('the finance dashboard quick links', () => {
  beforeEach(() => {
    storeState = { dashboard: null, isLoading: false, error: null, fetchDashboard: vi.fn() };
  });

  it('offers a viewer no link to pages their grants cannot open', () => {
    granted = new Set(['finance.view']);
    render(
      <MemoryRouter>
        <FinanceDashboardPage />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('link', { name: /Dues/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Approval Chains/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /QuickBooks Export/ })).not.toBeInTheDocument();
  });

  it('offers each to the grant it needs', () => {
    granted = new Set(['finance.view', 'finance.manage', 'finance.configure_approvals']);
    render(
      <MemoryRouter>
        <FinanceDashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Approval Chains/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /QuickBooks Export/ })).toBeInTheDocument();
  });
});
