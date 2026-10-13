/**
 * GF-7: a grant whose spending exceeds its award shows a warning — the amount
 * comes from the server's `overspentBy`, not from adding up the page — and the
 * expenditures stay recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/grants/applications/app-1']}>
      <Routes>
        <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GrantDetailPage overspend warning', () => {
  beforeEach(() => {
    currentApplication = application({});
  });

  it('warns with the server-reported amount over the award', () => {
    currentApplication = application({ overspentBy: '250.00', totalExpended: '1250.00' });
    renderPage();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/\$250\.00 over the \$1,000\.00 awarded/);
    expect(status).toHaveTextContent(/still recorded/i);
  });

  it('shows nothing when spending is within the award', () => {
    currentApplication = application({ overspentBy: null, totalExpended: '400.00' });
    renderPage();

    expect(screen.queryByText(/over the .* awarded/)).not.toBeInTheDocument();
  });
});
