/**
 * Forms review F-2 to F-7 on the detail page's four forms — budget line,
 * expenditure, compliance task and note: a missing value is named under its
 * field and focused with nothing sent, a 422 lands on the field it names, a
 * failure no field answers for is said inside the form, Enter submits, and a
 * dialog asks before throwing typed values away.
 *
 * The store is real and the service is mocked, as in the create-forms suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { createMockApiError } from '@/test/utils';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast };
});

const { service } = vi.hoisted(() => ({
  service: {
    getApplication: vi.fn(),
    createBudgetItem: vi.fn(),
    updateBudgetItem: vi.fn(),
    createExpenditure: vi.fn(),
    createComplianceTask: vi.fn(),
    createNote: vi.fn(),
  },
}));
vi.mock('../services/api', () => ({ grantsService: service }));

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
      amountSpent: '0.00',
    },
  ],
  expenditures: [],
  complianceTasks: [],
  grantNotes: [],
};

const refusal = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

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

async function openDialog(user: ReturnType<typeof userEvent.setup>, tab: RegExp, button: RegExp, name: string) {
  await user.click(await screen.findByRole('button', { name: tab }));
  await user.click(screen.getByRole('button', { name: button }));
  return screen.getByRole('dialog', { name });
}

function expectRefused(control: HTMLElement, message: string) {
  expect(control).toHaveAttribute('aria-invalid', 'true');
  expect(control).toHaveAccessibleDescription(message);
}

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.getApplication.mockResolvedValue(structuredClone(application));
  service.createBudgetItem.mockResolvedValue({ id: 'item-2' });
  service.updateBudgetItem.mockResolvedValue({ id: 'item-1' });
  service.createExpenditure.mockResolvedValue({ id: 'exp-1', warnings: [] });
  service.createComplianceTask.mockResolvedValue({ id: 'task-1' });
  service.createNote.mockResolvedValue({ id: 'note-1' });
});

describe('budget line dialog', () => {
  it('names every missing value under its field, focuses the first and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /^Budget$/, /Add Budget Item/, 'Add Budget Item'));

    const submit = dialog.getByRole('button', { name: 'Add Budget Item' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    const category = dialog.getByLabelText(/^Category/);
    expectRefused(category, 'Choose a category.');
    expect(category).toHaveFocus();
    expectRefused(dialog.getByLabelText(/^Description/), 'Describe what this line pays for.');
    expectRefused(dialog.getByLabelText(/^Amount/), 'Enter the amount budgeted.');
    expect(service.createBudgetItem).not.toHaveBeenCalled();
  });

  it('refuses an amount over the schema limit on the amount field', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /^Budget$/, /Add Budget Item/, 'Add Budget Item'));

    await user.selectOptions(dialog.getByLabelText(/^Category/), 'equipment');
    await user.type(dialog.getByLabelText(/^Description/), 'Engine');
    await user.type(dialog.getByLabelText(/^Amount/), '100000001');
    await user.click(dialog.getByRole('button', { name: 'Add Budget Item' }));

    const amount = dialog.getByLabelText(/^Amount/);
    expectRefused(amount, 'Keep the amount to $100,000,000 or less.');
    expect(amount).toHaveFocus();
    expect(service.createBudgetItem).not.toHaveBeenCalled();
  });

  it('submits on Enter and puts a 422 on the field it names', async () => {
    service.createBudgetItem.mockRejectedValue(refusal('amountBudgeted', 'Input should be greater than or equal to 0'));
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /^Budget$/, /Add Budget Item/, 'Add Budget Item'));

    await user.selectOptions(dialog.getByLabelText(/^Category/), 'equipment');
    await user.type(dialog.getByLabelText(/^Amount/), '10');
    await user.type(dialog.getByLabelText(/^Description/), 'Radios{Enter}');

    await waitFor(() => expect(service.createBudgetItem).toHaveBeenCalledTimes(1));
    const amount = dialog.getByLabelText(/^Amount/);
    await waitFor(() => expectRefused(amount, 'Amount must be 0 or more.'));
    expect(amount).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Add Budget Item' })).toBeInTheDocument();
  });

  it('says a failure no field answers for inside the dialog, which stays open', async () => {
    service.createBudgetItem.mockRejectedValue(createMockApiError('Application not found', 404));
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /^Budget$/, /Add Budget Item/, 'Add Budget Item'));

    await user.selectOptions(dialog.getByLabelText(/^Category/), 'equipment');
    await user.type(dialog.getByLabelText(/^Description/), 'Radios');
    await user.type(dialog.getByLabelText(/^Amount/), '10');
    await user.click(dialog.getByRole('button', { name: 'Add Budget Item' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Application not found');
    expect(dialog.getByLabelText(/^Description/)).toHaveValue('Radios');
  });

  it('refuses a whole edit on a 422 rather than saving the rest without the field', async () => {
    service.updateBudgetItem.mockRejectedValue(refusal('description', 'String should have at most 500 characters'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Budget$/ }));
    await user.click(screen.getByRole('button', { name: 'Edit budget line Portable radios' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit Budget Item' }));

    await user.click(dialog.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expectRefused(dialog.getByLabelText(/^Description/), 'Description is too long — keep it to 500 characters.')
    );
    expect(service.updateBudgetItem).toHaveBeenCalledTimes(1);
  });

  it('asks before Cancel throws typed values away', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /^Budget$/, /Add Budget Item/, 'Add Budget Item'));

    await user.type(dialog.getByLabelText(/^Description/), 'Radios');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    const ask = within(await screen.findByRole('dialog', { name: /Discard/ }));
    await user.click(ask.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Add Budget Item' })).toBeInTheDocument();
    expect(dialog.getByLabelText(/^Description/)).toHaveValue('Radios');
  });
});

describe('expenditure dialog', () => {
  it('names the missing description, amount and date and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /Expenditures/, /Record Expenditure/, 'Record Expenditure'));

    await user.click(dialog.getByRole('button', { name: 'Record Expenditure' }));

    const description = dialog.getByLabelText(/^Description/);
    expectRefused(description, 'Describe the expenditure.');
    expect(description).toHaveFocus();
    expectRefused(dialog.getByLabelText(/^Amount/), 'Enter the amount spent.');
    expectRefused(dialog.getByLabelText(/^Date/), 'Enter the date of the expenditure.');
    expect(service.createExpenditure).not.toHaveBeenCalled();
  });

  it('puts a refused vendor under the vendor field', async () => {
    service.createExpenditure.mockRejectedValue(refusal('vendor', 'String should have at most 255 characters'));
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /Expenditures/, /Record Expenditure/, 'Record Expenditure'));

    await user.type(dialog.getByLabelText(/^Description/), 'Radio order');
    await user.type(dialog.getByLabelText(/^Amount/), '400');
    await user.type(dialog.getByLabelText(/^Date/), '2026-09-01');
    await user.type(dialog.getByLabelText(/^Vendor/), 'Acme');
    await user.click(dialog.getByRole('button', { name: 'Record Expenditure' }));

    const vendor = dialog.getByLabelText(/^Vendor/);
    await waitFor(() => expectRefused(vendor, 'Vendor is too long — keep it to 255 characters.'));
    expect(vendor).toHaveFocus();
    expect(vendor).toHaveAttribute('maxLength', '255');
  });
});

describe('compliance task dialog', () => {
  it('names the missing title and due date and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /Compliance & Follow-Up/, /Add Task/, 'Add Compliance Task'));

    await user.click(dialog.getByRole('button', { name: 'Add Task' }));

    const title = dialog.getByLabelText(/^Title/);
    expectRefused(title, 'Give the task a title.');
    expect(title).toHaveFocus();
    expectRefused(dialog.getByLabelText(/^Due Date/), 'Enter the date the task is due.');
    expect(service.createComplianceTask).not.toHaveBeenCalled();
  });

  it('puts a 422 on its field and says anything else inside the dialog', async () => {
    service.createComplianceTask.mockRejectedValueOnce(refusal('dueDate', 'Invalid date format'));
    service.createComplianceTask.mockRejectedValueOnce(createMockApiError('Not allowed', 403));
    const user = userEvent.setup();
    renderPage();
    const dialog = within(await openDialog(user, /Compliance & Follow-Up/, /Add Task/, 'Add Compliance Task'));

    await user.type(dialog.getByLabelText(/^Title/), 'Quarterly report');
    await user.type(dialog.getByLabelText(/^Due Date/), '2026-12-31');
    await user.click(dialog.getByRole('button', { name: 'Add Task' }));

    await waitFor(() => expectRefused(dialog.getByLabelText(/^Due Date/), 'Due date needs a valid date.'));

    await user.click(dialog.getByRole('button', { name: 'Add Task' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Not allowed');
  });
});

describe('note card', () => {
  it('names a blank note on the field and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Activity Log/ }));

    const submit = screen.getByRole('button', { name: /^Add Note$/ });
    expect(submit).toBeEnabled();
    await user.click(submit);

    const note = screen.getByLabelText(/^Add Note/);
    expectRefused(note, 'Write the note before adding it.');
    expect(note).toHaveFocus();
    expect(service.createNote).not.toHaveBeenCalled();
  });

  it('says a failed save inside the card and keeps the text', async () => {
    service.createNote.mockRejectedValue(createMockApiError('Application not found', 404));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Activity Log/ }));

    await user.type(screen.getByLabelText(/^Add Note/), 'Called the program officer.');
    await user.click(screen.getByRole('button', { name: /^Add Note$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Application not found');
    expect(screen.getByLabelText(/^Add Note/)).toHaveValue('Called the program officer.');
  });
});
