/**
 * Searching opportunities: the server filters by name, agency and
 * description. The page used to filter its list a second time in the
 * browser, which threw on an opportunity with no agency (taking the page
 * down) and hid matches found only in the description.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const listOpportunities = vi.fn();
vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: (...args: unknown[]) => listOpportunities(...args) as unknown,
    updateOpportunity: vi.fn(),
  },
}));

import GrantOpportunitiesPage from './GrantOpportunitiesPage';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { GrantOpportunity } from '../types';

const opportunity = (overrides: Partial<GrantOpportunity>): GrantOpportunity => ({
  id: 'opp-1',
  organizationId: 'org-1',
  name: 'Hose Replacement Fund',
  agency: null,
  description: 'Covers supply line and attack hose.',
  eligibleUses: null,
  typicalAwardMin: null,
  typicalAwardMax: null,
  eligibilityCriteria: null,
  applicationUrl: null,
  programUrl: null,
  matchRequired: false,
  matchPercentage: null,
  matchDescription: null,
  deadlineType: 'rolling',
  deadlineDate: null,
  recurringSchedule: null,
  requiredDocuments: [],
  tags: [],
  category: 'equipment',
  federalProgramCode: null,
  isActive: true,
  notes: null,
  createdBy: null,
  createdAt: '2026-11-06T00:00:00Z',
  updatedAt: '2026-11-06T00:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <GrantOpportunitiesPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('GrantOpportunitiesPage search', () => {
  beforeEach(() => {
    granted = new Set();
    listOpportunities.mockReset();
  });

  it('shows what the server matched, including an opportunity with no agency', async () => {
    const hose = opportunity({});
    listOpportunities.mockResolvedValue([hose]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Hose Replacement Fund');

    // "supply" matches only the description, which the server searches.
    await user.type(screen.getByRole('textbox', { name: 'Search opportunities by name or agency' }), 'supply');

    expect(await screen.findByText('Hose Replacement Fund')).toBeInTheDocument();
    expect(listOpportunities).toHaveBeenLastCalledWith({ activeOnly: true, search: 'supply' });
  });
});
