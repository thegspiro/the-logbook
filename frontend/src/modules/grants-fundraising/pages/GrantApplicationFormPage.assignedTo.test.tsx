/**
 * Assigned To was a free-text name box. The API stores a member id — it
 * refused a name on edit and had no field for it on create, which silently
 * dropped it. It is now a member picker sending the member's id, and an edit
 * that picks "Unassigned" sends null so the stored member is cleared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetApplication = vi.fn();
const mockCreateApplication = vi.fn();
const mockUpdateApplication = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    listOpportunities: () => Promise.resolve([]),
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    createApplication: (...args: unknown[]) => mockCreateApplication(...args) as unknown,
    updateApplication: (...args: unknown[]) => mockUpdateApplication(...args) as unknown,
  },
}));
vi.mock('@/services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import GrantApplicationFormPage from './GrantApplicationFormPage';

const members = [
  { id: 'user-pat', username: 'pquinn', first_name: 'Pat', last_name: 'Quinn' },
  { id: 'user-sam', username: 'sreyes', first_name: 'Sam', last_name: 'Reyes', preferred_name: 'Sammy' },
];

const stored = {
  id: 'app-1',
  grantProgramName: 'AFG',
  grantAgency: 'FEMA',
  opportunityId: null,
  applicationStatus: 'preparing',
  allowedNextStatuses: ['internal_review'],
  priority: 'medium',
  assignedTo: 'user-pat',
  budgetSummary: null,
  keyContacts: null,
};

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

const updatePayload = () => mockUpdateApplication.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
const createPayload = () => mockCreateApplication.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

describe('GrantApplicationFormPage — Assigned To', () => {
  beforeEach(() => {
    mockGetUsers.mockReset();
    mockGetUsers.mockResolvedValue(structuredClone(members));
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue(structuredClone(stored));
    mockCreateApplication.mockReset();
    mockCreateApplication.mockResolvedValue({ id: 'app-new' });
    mockUpdateApplication.mockReset();
    mockUpdateApplication.mockResolvedValue({ id: 'app-1' });
  });

  it('is a picker of the members, not a text box', async () => {
    renderAt('/grants/applications/new');

    const picker = await screen.findByRole('combobox', { name: 'Assigned To' });
    expect(await screen.findByRole('option', { name: 'Pat Quinn' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sammy Reyes' })).toBeInTheDocument();
    expect(picker).toHaveValue('');
    expect(mockGetUsers).toHaveBeenCalled();
  });

  it('sends the selected member id on create', async () => {
    const user = userEvent.setup();
    renderAt('/grants/applications/new');

    await user.type(screen.getByLabelText(/Grant Program Name/), 'AFG');
    await user.type(screen.getByLabelText(/Grant Agency/), 'FEMA');
    await screen.findByRole('option', { name: 'Sammy Reyes' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned To' }), 'user-sam');
    await user.click(screen.getByRole('button', { name: /Create Application/ }));

    await waitFor(() => expect(mockCreateApplication).toHaveBeenCalledTimes(1));
    expect(createPayload()?.assignedTo).toBe('user-sam');
  });

  it('leaves it out of a create when nobody is picked', async () => {
    const user = userEvent.setup();
    renderAt('/grants/applications/new');

    await user.type(screen.getByLabelText(/Grant Program Name/), 'AFG');
    await user.type(screen.getByLabelText(/Grant Agency/), 'FEMA');
    await user.click(screen.getByRole('button', { name: /Create Application/ }));

    await waitFor(() => expect(mockCreateApplication).toHaveBeenCalledTimes(1));
    expect(createPayload()).not.toHaveProperty('assignedTo');
  });

  it('preselects the stored member and sends a new pick on edit', async () => {
    const user = userEvent.setup();
    renderAt('/grants/applications/app-1/edit');

    const picker = await screen.findByRole('combobox', { name: 'Assigned To' });
    await screen.findByRole('option', { name: 'Pat Quinn' });
    await waitFor(() => expect(picker).toHaveValue('user-pat'));

    await user.selectOptions(picker, 'user-sam');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalledTimes(1));
    expect(mockUpdateApplication.mock.calls[0]?.[0]).toBe('app-1');
    expect(updatePayload()?.assignedTo).toBe('user-sam');
  });

  it('sends null on edit when the member is cleared', async () => {
    const user = userEvent.setup();
    renderAt('/grants/applications/app-1/edit');

    const picker = await screen.findByRole('combobox', { name: 'Assigned To' });
    await waitFor(() => expect(picker).toHaveValue('user-pat'));

    await user.selectOptions(picker, '');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalledTimes(1));
    expect(updatePayload()).toHaveProperty('assignedTo', null);
  });

  it('keeps a stored assignee who is no longer on the member list', async () => {
    mockGetUsers.mockReset();
    mockGetUsers.mockResolvedValue([members[1]]);
    const user = userEvent.setup();
    renderAt('/grants/applications/app-1/edit');

    const picker = await screen.findByRole('combobox', { name: 'Assigned To' });
    await screen.findByRole('option', { name: 'Sammy Reyes' });
    await waitFor(() => expect(picker).toHaveValue('user-pat'));
    expect(screen.getByRole('option', { name: 'Current assignee' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateApplication).toHaveBeenCalledTimes(1));
    expect(updatePayload()?.assignedTo).toBe('user-pat');
  });
});
