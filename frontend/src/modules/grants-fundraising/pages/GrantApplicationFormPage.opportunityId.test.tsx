/**
 * Regression test: the opportunities list's "Apply" link points at
 * `/grants/applications/new?opportunity_id=<id>`, but this page never read
 * the query string — the new-application form always started blank, so the
 * opportunity link was silently dropped and had to be re-selected by hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { GrantOpportunity } from '../types';

const mockListOpportunities = vi.fn();
const mockGetOpportunity = vi.fn();
const mockCreateApplication = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: (...args: unknown[]) => mockListOpportunities(...args) as unknown,
    getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args) as unknown,
    createApplication: (...args: unknown[]) => mockCreateApplication(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) as unknown, success: vi.fn() },
}));

import GrantApplicationFormPage from './GrantApplicationFormPage';

const opportunity: GrantOpportunity = {
  id: 'opp-123',
  organizationId: 'org-1',
  name: 'FEMA AFG',
  agency: 'FEMA',
  description: null,
  eligibleUses: null,
  typicalAwardMin: null,
  typicalAwardMax: null,
  eligibilityCriteria: null,
  applicationUrl: null,
  programUrl: null,
  matchRequired: false,
  matchPercentage: null,
  matchDescription: null,
  deadlineType: null,
  deadlineDate: null,
  recurringSchedule: null,
  requiredDocuments: [],
  tags: [],
  category: 'equipment',
  federalProgramCode: null,
  isActive: true,
  notes: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('GrantApplicationFormPage — opportunityId from the URL', () => {
  beforeEach(() => {
    mockListOpportunities.mockReset();
    mockListOpportunities.mockResolvedValue([opportunity]);
    mockGetOpportunity.mockReset();
    mockGetOpportunity.mockResolvedValue(opportunity);
    mockCreateApplication.mockReset();
    mockCreateApplication.mockResolvedValue({ id: 'app-1' });
    mockToastError.mockReset();
  });

  async function fillRequiredFieldsAndSubmit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/grant program name/i), 'AFG Equipment Grant');
    await user.type(screen.getByLabelText(/grant agency/i), 'FEMA');
    await user.click(screen.getByRole('button', { name: /create application/i }));
  }

  it('seeds opportunityId from ?opportunity_id= when creating a new application', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/applications/new?opportunity_id=opp-123']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );

    const select = await screen.findByLabelText<HTMLSelectElement>(/opportunity id/i);
    expect(select.value).toBe('opp-123');
  });

  it('leaves opportunityId blank when no opportunity_id is in the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/applications/new']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );

    const select = await screen.findByLabelText<HTMLSelectElement>(/opportunity id/i);
    expect(select.value).toBe('');
  });

  it('fetches the linked opportunity directly when it is outside the unfiltered first page', async () => {
    // Simulates an org with >100 opportunities: the dropdown's own
    // unfiltered fetch doesn't include the one the URL links to.
    mockListOpportunities.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/grants/applications/new?opportunity_id=opp-123']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );

    const select = await screen.findByLabelText<HTMLSelectElement>(/opportunity id/i);
    expect(mockGetOpportunity).toHaveBeenCalledWith('opp-123');
    expect(select.value).toBe('opp-123');
  });

  it('clears a stale opportunity id silently on a 404, and never submits it', async () => {
    // The select's own DOM value reads blank the moment no <option> matches
    // formData.opportunityId, whether or not the state was actually
    // cleared — so the real assertion is on what gets submitted, not on
    // the select's rendered value.
    mockListOpportunities.mockResolvedValue([]);
    mockGetOpportunity.mockRejectedValue({ response: { status: 404 } });

    render(
      <MemoryRouter initialEntries={['/grants/applications/new?opportunity_id=opp-gone']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockGetOpportunity).toHaveBeenCalledWith('opp-gone'));

    await fillRequiredFieldsAndSubmit();

    await waitFor(() => expect(mockCreateApplication).toHaveBeenCalled());
    expect(mockCreateApplication.mock.calls[0]?.[0]).toMatchObject({ opportunityId: null });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('clears the opportunity id and warns on a non-404 failure, so the hidden id is never submitted unseen', async () => {
    mockListOpportunities.mockResolvedValue([]);
    mockGetOpportunity.mockRejectedValue(new Error('Network Error'));

    render(
      <MemoryRouter initialEntries={['/grants/applications/new?opportunity_id=opp-123']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockGetOpportunity).toHaveBeenCalledWith('opp-123'));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Could not load the linked funding opportunity — please reselect it.')
    );

    await fillRequiredFieldsAndSubmit();

    await waitFor(() => expect(mockCreateApplication).toHaveBeenCalled());
    expect(mockCreateApplication.mock.calls[0]?.[0]).toMatchObject({ opportunityId: null });
  });
});
