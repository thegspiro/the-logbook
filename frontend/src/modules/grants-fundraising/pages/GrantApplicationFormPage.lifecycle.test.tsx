/**
 * GF-7: editing a grant offers only the statuses its lifecycle allows next —
 * the list the server reports in `allowedNextStatuses` — plus where it is now.
 * A new application may still start at any status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetApplication = vi.fn();
const mockUpdateApplication = vi.fn();
const mockCreateApplication = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: () => Promise.resolve([]),
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    updateApplication: (...args: unknown[]) => mockUpdateApplication(...args) as unknown,
    createApplication: (...args: unknown[]) => mockCreateApplication(...args) as unknown,
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

describe('GrantApplicationFormPage — amount awarded', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue({
      id: 'app-1',
      grantProgramName: 'AFG',
      grantAgency: 'FEMA',
      opportunityId: null,
      applicationStatus: 'awarded',
      allowedNextStatuses: ['active', 'closed'],
      amountRequested: '50000.00',
      // Decimal columns arrive as strings on the wire.
      amountAwarded: '42000.00',
      priority: 'medium',
    });
    mockUpdateApplication.mockReset();
    mockUpdateApplication.mockResolvedValue({ id: 'app-1' });
    mockCreateApplication.mockReset();
    mockCreateApplication.mockResolvedValue({ id: 'app-new' });
  });

  function renderEdit() {
    render(
      <MemoryRouter initialEntries={['/grants/applications/app-1/edit']}>
        <Routes>
          <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
          <Route path="/grants/applications/:id" element={<p>detail</p>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('loads the recorded award into the form when editing', async () => {
    renderEdit();
    expect(await screen.findByLabelText(/amount awarded/i)).toHaveValue(42000);
  });

  it('sends the edited award on save', async () => {
    const user = userEvent.setup();
    renderEdit();
    const input = await screen.findByLabelText(/amount awarded/i);
    await waitFor(() => expect(input).toHaveValue(42000));
    await user.clear(input);
    await user.type(input, '45000.50');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalledTimes(1));
    expect(mockUpdateApplication).toHaveBeenCalledWith('app-1', expect.objectContaining({ amountAwarded: 45000.5 }));
  });

  it('sends null when the award is cleared, so the stored value is removed', async () => {
    const user = userEvent.setup();
    renderEdit();
    const input = await screen.findByLabelText(/amount awarded/i);
    await waitFor(() => expect(input).toHaveValue(42000));
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalledTimes(1));
    expect(mockUpdateApplication).toHaveBeenCalledWith('app-1', expect.objectContaining({ amountAwarded: null }));
  });

  it('omits a blank award on create', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/grants/applications/new']}>
        <Routes>
          <Route path="/grants/applications/new" element={<GrantApplicationFormPage />} />
          <Route path="/grants/applications/:id" element={<p>detail</p>} />
        </Routes>
      </MemoryRouter>
    );
    await user.type(await screen.findByLabelText(/grant program name/i), 'AFG');
    await user.type(screen.getByLabelText(/grant agency/i), 'FEMA');
    await user.click(screen.getByRole('button', { name: /create application/i }));

    await waitFor(() => expect(mockCreateApplication).toHaveBeenCalledTimes(1));
    expect(mockCreateApplication.mock.calls[0]?.[0]).not.toHaveProperty('amountAwarded');
  });

  it('sends an award entered on create', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/grants/applications/new']}>
        <Routes>
          <Route path="/grants/applications/new" element={<GrantApplicationFormPage />} />
          <Route path="/grants/applications/:id" element={<p>detail</p>} />
        </Routes>
      </MemoryRouter>
    );
    await user.type(await screen.findByLabelText(/grant program name/i), 'AFG');
    await user.type(screen.getByLabelText(/grant agency/i), 'FEMA');
    await user.type(screen.getByLabelText(/amount awarded/i), '1000');
    await user.click(screen.getByRole('button', { name: /create application/i }));

    await waitFor(() => expect(mockCreateApplication).toHaveBeenCalledTimes(1));
    expect(mockCreateApplication).toHaveBeenCalledWith(expect.objectContaining({ amountAwarded: 1000 }));
  });
});
