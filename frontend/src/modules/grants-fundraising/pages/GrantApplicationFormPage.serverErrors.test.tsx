/**
 * A 422 on the grant application form lands under the field it names (forms
 * review F-2). A new application is created only once nothing is refused; an
 * edit saves the rest and keeps the refused field flagged (owner rule of
 * 2026-11-05 for a single-save form).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetApplication = vi.fn();
const mockCreateApplication = vi.fn();
const mockUpdateApplication = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: () => Promise.resolve([]),
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    createApplication: (...args: unknown[]) => mockCreateApplication(...args) as unknown,
    updateApplication: (...args: unknown[]) => mockUpdateApplication(...args) as unknown,
  },
}));
vi.mock('@/services/api', () => ({ userService: { getUsers: () => Promise.resolve([]) } }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => toastError(...args) as unknown, success: vi.fn() },
}));

import GrantApplicationFormPage from './GrantApplicationFormPage';

const refusal = (field: string) => ({
  response: { status: 422, data: { detail: [{ field, message: 'Value is too long.' }] } },
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grants/applications/new" element={<GrantApplicationFormPage />} />
        <Route path="/grants/applications/:id/edit" element={<GrantApplicationFormPage />} />
        <Route path="/grants/applications/:id" element={<div>detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GrantApplicationFormPage — server refusals', () => {
  beforeEach(() => {
    toastError.mockReset();
    mockCreateApplication.mockReset();
    mockUpdateApplication.mockReset();
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue({
      id: 'app-1',
      grantProgramName: 'AFG',
      grantAgency: 'FEMA',
      opportunityId: null,
      applicationStatus: 'preparing',
      allowedNextStatuses: ['internal_review'],
      priority: 'medium',
      matchSource: 'County',
      budgetSummary: null,
      keyContacts: null,
    });
  });

  it("puts a new application's refused agency under the agency and creates nothing", async () => {
    mockCreateApplication.mockRejectedValue(refusal('grantAgency'));
    const user = userEvent.setup();
    renderAt('/grants/applications/new');

    await user.type(screen.getByLabelText(/Grant Program Name/), 'AFG');
    await user.type(screen.getByLabelText(/Grant Agency/), 'FEMA');
    await user.click(screen.getByRole('button', { name: /Create Application/ }));

    const agency = screen.getByLabelText(/Grant Agency/);
    await waitFor(() => expect(agency).toHaveAttribute('aria-invalid', 'true'));
    expect(agency).toHaveAccessibleDescription('Grant Agency is too long — keep it to 255 characters.');
    expect(agency).toHaveFocus();
    expect(screen.queryByText('detail')).not.toBeInTheDocument();
  });

  it('saves the rest of an edit and keeps the refused match source flagged on the page', async () => {
    mockUpdateApplication.mockRejectedValueOnce(refusal('matchSource'));
    mockUpdateApplication.mockResolvedValueOnce({ id: 'app-1' });
    const user = userEvent.setup();
    renderAt('/grants/applications/app-1/edit');

    const source = await screen.findByLabelText(/Match Source/);
    await waitFor(() => expect(source).toHaveValue('County'));
    await user.clear(source);
    await user.type(source, 'State');
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalledTimes(2));
    expect(mockUpdateApplication.mock.calls[1]?.[1]).not.toHaveProperty('matchSource');
    expect(source).toHaveAttribute('aria-invalid', 'true');
    expect(source).toHaveAccessibleDescription('Match Source is too long — keep it to 255 characters.');
    expect(source).toHaveValue('State');
    expect(screen.queryByText('detail')).not.toBeInTheDocument();
  });
});
