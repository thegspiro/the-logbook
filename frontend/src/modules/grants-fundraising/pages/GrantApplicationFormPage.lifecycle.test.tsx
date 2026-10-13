/**
 * GF-7: editing a grant offers only the statuses its lifecycle allows next —
 * the list the server reports in `allowedNextStatuses` — plus where it is now.
 * A new application may still start at any status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetApplication = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: () => Promise.resolve([]),
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import GrantApplicationFormPage from './GrantApplicationFormPage';

function optionsOf(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

describe('GrantApplicationFormPage — grant lifecycle', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue({
      id: 'app-1',
      grantProgramName: 'AFG',
      grantAgency: 'FEMA',
      opportunityId: null,
      applicationStatus: 'active',
      allowedNextStatuses: ['reporting', 'closed'],
      priority: 'medium',
    });
  });

  it('offers the current status and the allowed next ones when editing', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/applications/app-1/edit']}>
        <Routes>
          <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
        </Routes>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText(/application status/i);
    await waitFor(() => expect(optionsOf(select)).toEqual(['Active', 'Reporting', 'Closed']));
    expect(select).toHaveValue('active');
  });

  it('says so when the status is final', async () => {
    mockGetApplication.mockResolvedValue({
      id: 'app-1',
      grantProgramName: 'AFG',
      grantAgency: 'FEMA',
      opportunityId: null,
      applicationStatus: 'closed',
      allowedNextStatuses: [],
      priority: 'medium',
    });
    render(
      <MemoryRouter initialEntries={['/grants/applications/app-1/edit']}>
        <Routes>
          <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('This status is final.')).toBeInTheDocument();
    expect(optionsOf(screen.getByLabelText(/application status/i))).toEqual(['Closed']);
  });

  it('offers every status on a new application', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/applications/new']}>
        <GrantApplicationFormPage />
      </MemoryRouter>
    );

    const select = await screen.findByLabelText(/application status/i);
    expect(optionsOf(select)).toHaveLength(10);
  });
});
