/**
 * Lead W68: a grant's budget lines and expenditures had update and delete
 * endpoints but no control on the detail page, and a compliance task could
 * not be given an assignee when it was created.
 *
 * The store is real and the service is mocked, so these assert the exact body
 * that would go over the wire.
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

const { service, getDirectory } = vi.hoisted(() => ({
  service: {
    getApplication: vi.fn(),
    updateBudgetItem: vi.fn(),
    deleteBudgetItem: vi.fn(),
    updateExpenditure: vi.fn(),
    deleteExpenditure: vi.fn(),
    createComplianceTask: vi.fn(),
  },
  getDirectory: vi.fn(),
}));

vi.mock('../services/api', () => ({ grantsService: service }));
vi.mock('@/services/memberDirectoryService', () => ({
  memberDirectoryService: { getDirectory: (...a: unknown[]) => getDirectory(...a) as unknown },
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
  budgetItems: [
    {
      id: 'item-1',
      category: 'equipment',
      description: 'Portable radios',
      amountBudgeted: '1200.00',
      amountSpent: '300.00',
    },
  ],
  expenditures: [
    {
      id: 'exp-1',
      description: 'Radio batteries',
      amount: '300.00',
      expenditureDate: '2026-10-15',
      vendor: 'Acme',
      invoiceNumber: 'INV-1',
      budgetItemId: 'item-1',
      receiptUrl: null,
    },
  ],
  complianceTasks: [],
  grantNotes: [],
};

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

async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('button', { name }));
}

describe('GrantDetailPage budget lines and expenditures (W68)', () => {
  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockReset();
    service.getApplication.mockResolvedValue(structuredClone(application));
    service.updateBudgetItem.mockResolvedValue({ id: 'item-1' });
    service.deleteBudgetItem.mockResolvedValue(undefined);
    service.updateExpenditure.mockResolvedValue({ id: 'exp-1', warnings: [] });
    service.deleteExpenditure.mockResolvedValue(undefined);
    service.createComplianceTask.mockResolvedValue({ id: 'task-1' });
    getDirectory.mockReset();
    getDirectory.mockResolvedValue([{ id: 'u-7', display_name: 'Pat Lee', status: 'active' }]);
  });

  it('edits a budget line in the same dialog it was added with', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /^Budget$/);
    await user.click(screen.getByRole('button', { name: 'Edit budget line Portable radios' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Edit Budget Item' }));
    expect(dialog.getByLabelText(/^Amount/)).toHaveValue(1200);
    await user.clear(dialog.getByLabelText(/^Amount/));
    await user.type(dialog.getByLabelText(/^Amount/), '1500');
    await user.click(dialog.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(service.updateBudgetItem).toHaveBeenCalledTimes(1));
    expect(service.updateBudgetItem).toHaveBeenCalledWith('app-1', 'item-1', {
      category: 'equipment',
      description: 'Portable radios',
      amountBudgeted: 1500,
    });
  });

  it('says what happens to the spending charged to a budget line before deleting it', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /^Budget$/);
    await user.click(screen.getByRole('button', { name: 'Delete budget line Portable radios' }));

    const confirm = within(await screen.findByRole('dialog', { name: /Delete this/ }));
    expect(confirm.getByText(/1 expenditure is charged to it/)).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: 'Delete line' }));

    await waitFor(() => expect(service.deleteBudgetItem).toHaveBeenCalledWith('app-1', 'item-1'));
  });

  it('clears an emptied vendor and budget line when an expenditure is edited', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /Expenditures/);
    await user.click(screen.getByRole('button', { name: 'Edit expenditure Radio batteries' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Edit Expenditure' }));
    await user.clear(dialog.getByLabelText(/^Vendor/));
    await user.selectOptions(dialog.getByLabelText(/^Budget Item/), '');
    await user.click(dialog.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(service.updateExpenditure).toHaveBeenCalledTimes(1));
    expect(service.updateExpenditure).toHaveBeenCalledWith('app-1', 'exp-1', {
      description: 'Radio batteries',
      amount: 300,
      expenditureDate: '2026-10-15',
      vendor: null,
      invoiceNumber: 'INV-1',
      budgetItemId: null,
    });
  });

  it('deletes an expenditure only once it is confirmed', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /Expenditures/);
    await user.click(screen.getByRole('button', { name: 'Delete expenditure Radio batteries' }));

    const confirm = within(await screen.findByRole('dialog', { name: /Delete this/ }));
    await user.click(confirm.getByRole('button', { name: 'Keep it' }));
    expect(service.deleteExpenditure).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete expenditure Radio batteries' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: /Delete this/ })).getByRole('button', {
        name: 'Delete expenditure',
      })
    );
    await waitFor(() => expect(service.deleteExpenditure).toHaveBeenCalledWith('app-1', 'exp-1'));
  });

  it('assigns a compliance task when it is created', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /Compliance/);
    await user.click(screen.getByRole('button', { name: /Add Task|Add Compliance Task/ }));

    const dialog = within(screen.getByRole('dialog', { name: 'Add Compliance Task' }));
    await user.type(dialog.getByLabelText(/^Title/), 'Q4 report');
    await user.type(dialog.getByLabelText(/^Due Date/), '2027-01-15');
    await user.selectOptions(await dialog.findByLabelText(/^Assigned To/), 'u-7');
    await user.click(dialog.getByRole('button', { name: 'Add Task' }));

    await waitFor(() => expect(service.createComplianceTask).toHaveBeenCalledTimes(1));
    expect(service.createComplianceTask).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ title: 'Q4 report', assignedTo: 'u-7' })
    );
  });
});
