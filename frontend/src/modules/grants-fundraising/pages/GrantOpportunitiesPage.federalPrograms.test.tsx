/**
 * The four Federal Programs are opportunities, not fixed cards (owner
 * decision, 2026-11-01). The page used to draw AFG, SAFER, FP&S and Firehouse
 * Subs as text with no way to start an application; each department now
 * holds them as records, and the page lists them like any other — startable,
 * editable and retirable — with nothing drawn that the API did not return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const afg: GrantOpportunity = {
  id: 'opp-afg',
  organizationId: 'org-1',
  name: 'Assistance to Firefighters Grant (AFG)',
  agency: 'FEMA',
  description: 'Provides funding for critically needed resources.',
  eligibleUses: null,
  typicalAwardMin: null,
  typicalAwardMax: null,
  eligibilityCriteria: null,
  applicationUrl: null,
  programUrl: null,
  matchRequired: false,
  matchPercentage: null,
  matchDescription: null,
  deadlineType: 'recurring',
  deadlineDate: null,
  recurringSchedule: null,
  requiredDocuments: [],
  tags: [],
  category: 'equipment',
  federalProgramCode: 'AFG',
  isActive: true,
  notes: null,
  createdBy: null,
  createdAt: '2026-11-06T00:00:00Z',
  updatedAt: '2026-11-06T00:00:00Z',
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/grants/opportunities']}>
      <ConfirmProvider>
        <GrantOpportunitiesPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  listOpportunities.mockReset();
  listOpportunities.mockResolvedValue([afg]);
  granted = new Set(['fundraising.view', 'fundraising.manage']);
});

describe('Federal Programs on the opportunities page', () => {
  it('starts an application from the seeded program like any other', async () => {
    renderPage();

    // The only opportunity on the page, so its controls are the page's.
    await screen.findByRole('heading', { name: afg.name });
    expect(screen.getByRole('link', { name: /start application/i })).toHaveAttribute(
      'href',
      '/grants/applications/new?opportunity_id=opp-afg'
    );
    expect(screen.getByRole('link', { name: `Edit ${afg.name}` })).toBeInTheDocument();
    expect(screen.getByText('Recurring deadline')).toBeInTheDocument();
  });

  it('draws no fixed program cards of its own', async () => {
    listOpportunities.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No grant opportunities found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Federal Programs' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Staffing for Adequate Fire and Emergency Response/)).not.toBeInTheDocument();
  });

  it('offers no Start Application for a program the department retired', async () => {
    listOpportunities.mockResolvedValue([{ ...afg, isActive: false }]);
    renderPage();

    await screen.findByRole('heading', { name: afg.name });
    expect(screen.getByRole('button', { name: `Reinstate ${afg.name}` })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /start application/i })).not.toBeInTheDocument();
  });
});
