/**
 * The detail page's four create forms — budget item, expenditure, compliance
 * task and note — post to `/grants/applications/{id}/…` with the application
 * id in the path only, which is the body the backend accepts. The note form
 * used to send `noteType: 'comment'`, a type the API does not have.
 *
 * The store is real and the service is mocked, so these assert the exact body
 * that would go over the wire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

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
const mockCreateBudgetItem = vi.fn();
const mockCreateExpenditure = vi.fn();
const mockCreateComplianceTask = vi.fn();
const mockCreateNote = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
    createBudgetItem: (...args: unknown[]) => mockCreateBudgetItem(...args) as unknown,
    createExpenditure: (...args: unknown[]) => mockCreateExpenditure(...args) as unknown,
    createComplianceTask: (...args: unknown[]) => mockCreateComplianceTask(...args) as unknown,
    createNote: (...args: unknown[]) => mockCreateNote(...args) as unknown,
  },
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

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/grants/applications/app-1']}>
      <Routes>
        <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('button', { name }));
}

describe('GrantDetailPage create forms', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    mockGetApplication.mockResolvedValue(structuredClone(application));
    mockCreateBudgetItem.mockReset();
    mockCreateBudgetItem.mockResolvedValue({ id: 'item-1' });
    mockCreateExpenditure.mockReset();
    mockCreateExpenditure.mockResolvedValue({ id: 'exp-1', warnings: [] });
    mockCreateComplianceTask.mockReset();
    mockCreateComplianceTask.mockResolvedValue({ id: 'task-1' });
    mockCreateNote.mockReset();
    mockCreateNote.mockResolvedValue({ id: 'note-1' });
  });

  it('adds a budget item with the id in the path only', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /^Budget$/);
    await user.click(screen.getByRole('button', { name: /Add Budget Item/ }));

    const dialog = within(screen.getByRole('dialog', { name: 'Add Budget Item' }));
    await user.selectOptions(dialog.getByLabelText(/^Category/), 'equipment');
    await user.type(dialog.getByLabelText(/^Description/), 'Portable radios');
    await user.type(dialog.getByLabelText(/^Amount/), '1200.50');
    await user.click(dialog.getByRole('button', { name: /Add Budget Item/ }));

    await waitFor(() => expect(mockCreateBudgetItem).toHaveBeenCalledTimes(1));
    expect(mockCreateBudgetItem).toHaveBeenCalledWith('app-1', {
      category: 'equipment',
      description: 'Portable radios',
      amountBudgeted: 1200.5,
    });
  });

  it('records an expenditure with the id in the path only', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /Expenditures/);
    await user.click(screen.getByRole('button', { name: /Record Expenditure/ }));

    const dialog = within(screen.getByRole('dialog', { name: 'Record Expenditure' }));
    await user.type(dialog.getByLabelText(/^Description/), 'Radio order');
    await user.type(dialog.getByLabelText(/^Amount/), '400');
    await user.type(dialog.getByLabelText(/^Date/), '2026-09-01');
    await user.click(dialog.getByRole('button', { name: /Record Expenditure/ }));

    await waitFor(() => expect(mockCreateExpenditure).toHaveBeenCalledTimes(1));
    expect(mockCreateExpenditure).toHaveBeenCalledWith('app-1', {
      description: 'Radio order',
      amount: 400,
      expenditureDate: '2026-09-01',
      vendor: null,
      invoiceNumber: null,
      budgetItemId: null,
    });
  });

  it('adds a compliance task with the id in the path only', async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /Compliance & Follow-Up/);
    await user.click(screen.getByRole('button', { name: /Add Task/ }));

    const dialog = within(screen.getByRole('dialog', { name: /Compliance Task/ }));
    await user.type(dialog.getByLabelText(/^Title/), 'Quarterly report');
    await user.type(dialog.getByLabelText(/^Due Date/), '2026-12-31');
    await user.click(dialog.getByRole('button', { name: /Add Task/ }));

    await waitFor(() => expect(mockCreateComplianceTask).toHaveBeenCalledTimes(1));
    expect(mockCreateComplianceTask).toHaveBeenCalledWith('app-1', {
      taskType: 'performance_report',
      title: 'Quarterly report',
      description: null,
      dueDate: '2026-12-31',
      priority: 'medium',
      reportTemplate: null,
    });
  });

  it("adds a note as type 'general', which the API accepts", async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(user, /Activity Log/);

    await user.type(screen.getByLabelText('Add Note'), '  Spoke with the program officer.  ');
    await user.click(screen.getByRole('button', { name: /^Add Note$/ }));

    await waitFor(() => expect(mockCreateNote).toHaveBeenCalledTimes(1));
    expect(mockCreateNote).toHaveBeenCalledWith('app-1', {
      noteType: 'general',
      content: 'Spoke with the program officer.',
    });
  });
});
