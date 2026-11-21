/**
 * The compliance-task "Assigned To" picker offered every member the
 * directory returns, including a former one — the matching backend guard
 * (`assert_current_members` in `grant_service.py`) refuses a newly chosen
 * former member, but the picker itself did not filter them out, unlike the
 * sibling application assignee picker (`GrantApplicationFormPage.tsx`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast };
});

const mockGetApplication = vi.fn();
const mockCreateComplianceTask = vi.fn();
const mockGetDirectory = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    createComplianceTask: (...args: unknown[]) => mockCreateComplianceTask(...args) as unknown,
  },
}));
vi.mock('@/services/memberDirectoryService', () => ({
  memberDirectoryService: { getDirectory: (...args: unknown[]) => mockGetDirectory(...args) as unknown },
}));

import GrantDetailPage from './GrantDetailPage';

const application = {
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
};

const members = [
  { id: 'user-pat', first_name: 'Pat', last_name: 'Quinn', status: 'active' },
  { id: 'user-lee', first_name: 'Lee', last_name: 'Park', status: 'retired' },
];

function renderPage() {
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/grants/applications/app-1']}>
        <Routes>
          <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );
}

describe('GrantDetailPage — compliance task Assigned To', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue(structuredClone(application));
    mockCreateComplianceTask.mockReset();
    mockCreateComplianceTask.mockResolvedValue({ id: 'task-1' });
    mockGetDirectory.mockReset();
    mockGetDirectory.mockResolvedValue(structuredClone(members));
  });

  it('does not offer a former member as a new assignee', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Compliance & Follow-Up/ }));
    await user.click(screen.getByRole('button', { name: /Add Task/ }));

    const dialog = within(screen.getByRole('dialog', { name: /Compliance Task/ }));
    expect(await dialog.findByRole('option', { name: 'Pat Quinn' })).toBeInTheDocument();
    expect(dialog.queryByRole('option', { name: /Lee Park/ })).not.toBeInTheDocument();
  });

  it('sends the selected current member id', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Compliance & Follow-Up/ }));
    await user.click(screen.getByRole('button', { name: /Add Task/ }));

    const dialog = within(screen.getByRole('dialog', { name: /Compliance Task/ }));
    await user.type(dialog.getByLabelText(/^Title/), 'Quarterly report');
    await user.type(dialog.getByLabelText(/^Due Date/), '2026-12-31');
    await dialog.findByRole('option', { name: 'Pat Quinn' });
    await user.selectOptions(dialog.getByLabelText(/Assigned To/), 'user-pat');
    await user.click(dialog.getByRole('button', { name: /Add Task/ }));

    await waitFor(() => expect(mockCreateComplianceTask).toHaveBeenCalledTimes(1));
    expect(mockCreateComplianceTask.mock.calls[0]?.[1]).toMatchObject({ assignedTo: 'user-pat' });
  });
});
