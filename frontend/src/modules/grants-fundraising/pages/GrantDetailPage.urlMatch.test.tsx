/**
 * The page writes to the grant in its URL, so it shows only that grant. A
 * record for another id (the last grant opened, before this one has loaded)
 * reads as not found rather than standing in for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));

let currentApplication: Record<string, unknown> = {};
vi.mock('../store/grantsStore', () => ({
  useGrantsStore: () => ({
    currentApplication,
    isLoading: false,
    error: null,
    fetchApplication: () => Promise.resolve(),
    addBudgetItem: vi.fn(),
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
    amountAwarded: '1000',
    matchAmount: null,
    priority: 'medium',
    budgetItems: [],
    expenditures: [],
    complianceTasks: [],
    grantNotes: [],
    ...overrides,
  };
}

function renderAt(url: string) {
  return render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );
}

describe('GrantDetailPage shows only the grant in the URL', () => {
  beforeEach(() => {
    currentApplication = application({ id: 'app-1', grantProgramName: 'Alpha Grant' });
  });

  it('does not show another grant under this URL', () => {
    renderAt('/grants/applications/app-2');

    expect(screen.getByText('Application Not Found')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Grant')).not.toBeInTheDocument();
  });

  it('shows the grant whose URL it is', () => {
    renderAt('/grants/applications/app-1');

    expect(screen.getAllByText('Alpha Grant').length).toBeGreaterThan(0);
  });
});
