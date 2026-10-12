/**
 * Adding a grant opportunity. "Add Opportunity" used to navigate to a route
 * that did not exist; the form now creates the program through POST /grants
 * with blank optional fields omitted, and only a fundraising manager is
 * offered the button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const createOpportunity = vi.fn();
const listOpportunities = vi.fn();
vi.mock('../services/api', () => ({
  grantsService: {
    createOpportunity: (...args: unknown[]) => createOpportunity(...args) as unknown,
    listOpportunities: (...args: unknown[]) => listOpportunities(...args) as unknown,
  },
}));

import GrantOpportunityFormPage from './GrantOpportunityFormPage';
import GrantOpportunitiesPage from './GrantOpportunitiesPage';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grants/opportunities" element={<GrantOpportunitiesPage />} />
        <Route path="/grants/opportunities/new" element={<GrantOpportunityFormPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  createOpportunity.mockReset();
  listOpportunities.mockReset();
  createOpportunity.mockResolvedValue({ id: 'opp-1' });
  listOpportunities.mockResolvedValue([]);
  granted = new Set(['fundraising.view', 'fundraising.manage']);
});

describe('Add Opportunity button', () => {
  it('opens the create form for a fundraising manager', async () => {
    const user = userEvent.setup();
    renderAt('/grants/opportunities');

    await user.click(await screen.findByRole('button', { name: /add opportunity/i }));

    expect(await screen.findByRole('heading', { name: 'Add Grant Opportunity' })).toBeInTheDocument();
  });

  it('is not offered to a viewer who cannot create one', async () => {
    granted = new Set(['fundraising.view']);
    renderAt('/grants/opportunities');

    await waitFor(() => expect(listOpportunities).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /add opportunity/i })).not.toBeInTheDocument();
  });
});

describe('GrantOpportunityFormPage', () => {
  it('creates the opportunity with blanks omitted and returns to the library', async () => {
    const user = userEvent.setup();
    renderAt('/grants/opportunities/new');

    await user.type(screen.getByLabelText('Program name'), 'State Fire Equipment Grant');
    await user.type(screen.getByLabelText(/agency or funder/i), 'State Fire Marshal');
    await user.selectOptions(screen.getByLabelText('Category'), 'equipment');
    await user.type(screen.getByLabelText(/largest typical award/i), '50000');
    await user.selectOptions(screen.getByLabelText('Deadline'), 'fixed');
    await user.type(screen.getByLabelText(/deadline date/i), '2027-02-15');
    await user.click(screen.getByRole('button', { name: 'Add opportunity' }));

    await waitFor(() =>
      expect(createOpportunity).toHaveBeenCalledWith({
        name: 'State Fire Equipment Grant',
        agency: 'State Fire Marshal',
        category: 'equipment',
        description: undefined,
        eligibleUses: undefined,
        eligibilityCriteria: undefined,
        typicalAwardMin: undefined,
        typicalAwardMax: '50000',
        matchRequired: false,
        matchPercentage: undefined,
        matchDescription: undefined,
        deadlineType: 'fixed',
        deadlineDate: '2027-02-15',
        applicationUrl: undefined,
        programUrl: undefined,
        federalProgramCode: undefined,
        notes: undefined,
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Opportunity added');
    expect(await screen.findByRole('heading', { name: 'Grant Opportunities' })).toBeInTheDocument();
  });

  it('requires a name, and a date for a fixed deadline', async () => {
    const user = userEvent.setup();
    renderAt('/grants/opportunities/new');

    await user.selectOptions(screen.getByLabelText('Deadline'), 'fixed');
    await user.click(screen.getByRole('button', { name: 'Add opportunity' }));

    expect(screen.getByText('Enter the program name.')).toBeInTheDocument();
    expect(screen.getByText('A fixed deadline needs its date.')).toBeInTheDocument();
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it('refuses an award range that runs backwards', async () => {
    const user = userEvent.setup();
    renderAt('/grants/opportunities/new');

    await user.type(screen.getByLabelText('Program name'), 'Foundation grant');
    await user.type(screen.getByLabelText(/smallest typical award/i), '9000');
    await user.type(screen.getByLabelText(/largest typical award/i), '1000');
    await user.click(screen.getByRole('button', { name: 'Add opportunity' }));

    expect(screen.getByText('The largest award cannot be below the smallest.')).toBeInTheDocument();
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it('sends the match only when one is required, and no date for a rolling deadline', async () => {
    const user = userEvent.setup();
    renderAt('/grants/opportunities/new');

    await user.type(screen.getByLabelText('Program name'), 'SAFER');
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText(/match percentage/i), '10');
    await user.selectOptions(screen.getByLabelText('Deadline'), 'rolling');
    expect(screen.queryByLabelText(/deadline date/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add opportunity' }));

    await waitFor(() => expect(createOpportunity).toHaveBeenCalledTimes(1));
    const payload = createOpportunity.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.matchRequired).toBe(true);
    expect(payload.matchPercentage).toBe('10');
    expect(payload.deadlineType).toBe('rolling');
    expect(payload.deadlineDate).toBeUndefined();
  });

  it("shows the backend's refusal and stays on the form", async () => {
    createOpportunity.mockRejectedValue(new Error('Only http and https links are allowed'));
    const user = userEvent.setup();
    renderAt('/grants/opportunities/new');

    await user.type(screen.getByLabelText('Program name'), 'Foundation grant');
    await user.click(screen.getByRole('button', { name: 'Add opportunity' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Only http and https links are allowed'));
    expect(screen.getByRole('heading', { name: 'Add Grant Opportunity' })).toBeInTheDocument();
  });
});
