/**
 * Dues administration on the dues page.
 *
 * A `finance.manage` holder creates and edits schedules, generates member
 * dues, records payments, waives and reverses waivers, and reads a member's
 * payment ledger. Everyone else reads the list and nothing more. Every write
 * re-reads the list and the summary rather than adjusting them locally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { DuesSchedule, MemberDues } from '../types';

const fetchDuesSchedules = vi.fn();
const fetchMemberDues = vi.fn();
const fetchDuesSummary = vi.fn();
let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const createSchedule = vi.fn();
const updateSchedule = vi.fn();
const generateDues = vi.fn();
const recordPayment = vi.fn();
const listPayments = vi.fn();
const waive = vi.fn();
const unwaive = vi.fn();
vi.mock('../services/api', () => ({
  duesService: {
    createSchedule: (...args: unknown[]) => createSchedule(...args) as unknown,
    updateSchedule: (...args: unknown[]) => updateSchedule(...args) as unknown,
    generateDues: (...args: unknown[]) => generateDues(...args) as unknown,
    recordPayment: (...args: unknown[]) => recordPayment(...args) as unknown,
    listPayments: (...args: unknown[]) => listPayments(...args) as unknown,
    waive: (...args: unknown[]) => waive(...args) as unknown,
    unwaive: (...args: unknown[]) => unwaive(...args) as unknown,
  },
}));

import DuesManagementPage from './DuesManagementPage';

const schedule = (overrides: Partial<DuesSchedule> = {}): DuesSchedule => ({
  id: 'sch-2027',
  organizationId: 'org',
  name: '2027 annual dues',
  amount: '120.00',
  frequency: 'annual',
  dueDate: '2027-03-01T00:00:00Z',
  gracePeriodDays: 30,
  isActive: true,
  notes: 'Board vote 10/7',
  createdBy: 'u-t',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

const dues = (overrides: Partial<MemberDues> = {}): MemberDues => ({
  id: 'd-terry',
  organizationId: 'org',
  duesScheduleId: 'sch-2027',
  userId: 'u-terry',
  memberName: 'Terry Heather',
  amountDue: '120.00',
  amountPaid: '20.00',
  status: 'partial',
  dueDate: '2027-03-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/dues']}>
        <DuesManagementPage />
      </MemoryRouter>
    </ConfirmProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [
    fetchDuesSchedules,
    fetchMemberDues,
    fetchDuesSummary,
    createSchedule,
    updateSchedule,
    generateDues,
    recordPayment,
    listPayments,
    waive,
    unwaive,
  ]) {
    m.mockReset();
  }
  fetchDuesSchedules.mockResolvedValue(undefined);
  fetchMemberDues.mockResolvedValue(undefined);
  fetchDuesSummary.mockResolvedValue(undefined);
  granted = new Set(['finance.view', 'finance.manage']);
  storeState = {
    duesSchedules: [schedule()],
    memberDues: [
      dues(),
      dues({ id: 'd-ann', userId: 'u-ann', memberName: 'Ann Lee', status: 'waived', waiveReason: 'Hardship' }),
    ],
    duesSummary: null,
    isLoading: false,
    error: null,
    fetchDuesSchedules,
    fetchMemberDues,
    fetchDuesSummary,
  };
});

describe('reading', () => {
  it('names each member rather than showing their id', () => {
    renderPage();
    expect(screen.getByText('Terry Heather')).toBeInTheDocument();
    expect(screen.queryByText('u-terry')).not.toBeInTheDocument();
  });

  it('offers no administration to a member without finance.manage', () => {
    granted = new Set(['finance.view']);
    renderPage();
    expect(screen.queryByRole('button', { name: /new schedule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record a payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /waive the dues/i })).not.toBeInTheDocument();
    // The ledger is still theirs to read.
    expect(screen.getByRole('button', { name: 'Payment history for Terry Heather' })).toBeInTheDocument();
  });

  // W66: the reflowed table hides a cell without data-label under 768px, so
  // on a phone the row's actions — Record payment included — were not there.
  it('keeps the row actions in the stacked phone layout', () => {
    renderPage();
    const actions = screen
      .getAllByRole('cell')
      .find((cell) => within(cell).queryByRole('button', { name: 'Payment history for Terry Heather' }));
    expect(actions).toHaveAttribute('data-label');
  });
});

describe('schedules', () => {
  it('creates a schedule with blanks omitted and the due date at midnight in the department zone', async () => {
    createSchedule.mockResolvedValue(schedule({ id: 'sch-new' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /new schedule/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), '2028 annual dues');
    await user.type(within(dialog).getByLabelText('Amount per member'), '150');
    await user.selectOptions(within(dialog).getByLabelText('Frequency'), 'quarterly');
    await user.type(within(dialog).getByLabelText('Due date'), '2028-03-01');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(createSchedule).toHaveBeenCalledWith({
      name: '2028 annual dues',
      amount: '150.00',
      frequency: 'quarterly',
      dueDate: '2028-03-01T00:00:00.000Z',
      notes: undefined,
    });
    await waitFor(() => expect(fetchDuesSchedules).toHaveBeenCalledTimes(2));
  });

  it('refuses to save without a name, an amount or a due date', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /new schedule/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create schedule' }));
    expect(screen.getByText(/give the schedule a name/i)).toBeInTheDocument();
    expect(screen.getByText(/enter an amount greater than zero/i)).toBeInTheDocument();
    expect(screen.getByText(/enter the date dues are due/i)).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('edits a schedule sending every field, a cleared note as null', async () => {
    updateSchedule.mockResolvedValue(schedule({ isActive: false }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /2027 annual dues/ }));
    await user.click(screen.getByRole('button', { name: /edit schedule/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Due date')).toHaveValue('2027-03-01');
    await user.clear(within(dialog).getByLabelText(/notes/i));
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));

    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith('sch-2027', {
        name: '2027 annual dues',
        amount: '120.00',
        frequency: 'annual',
        dueDate: '2027-03-01T00:00:00.000Z',
        isActive: false,
        notes: null,
        // Blank: the department's defaults apply.
        qbIncomeAccount: null,
        qbDepositAccount: null,
      })
    );
  });

  it("sends a schedule's own QuickBooks accounts, trimmed", async () => {
    createSchedule.mockResolvedValue(schedule({ id: 'sch-new' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /new schedule/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Fines');
    await user.type(within(dialog).getByLabelText('Amount per member'), '10');
    await user.type(within(dialog).getByLabelText('Due date'), '2028-03-01');
    await user.type(within(dialog).getByLabelText(/Income account/), ' Fines Income ');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() =>
      expect(createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ qbIncomeAccount: 'Fines Income', qbDepositAccount: undefined })
      )
    );
  });

  it('generates dues from the selected schedule after a confirmation', async () => {
    generateDues.mockResolvedValue({ generated: 14 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /2027 annual dues/ }));
    await user.click(screen.getByRole('button', { name: /generate dues/i }));
    const confirmDialog = await screen.findByRole('dialog');
    await user.click(within(confirmDialog).getByRole('button', { name: 'Generate dues' }));

    await waitFor(() => expect(generateDues).toHaveBeenCalledWith('sch-2027'));
    expect(toastSuccess).toHaveBeenCalledWith('Dues generated for 14 members');
    expect(fetchDuesSummary).toHaveBeenLastCalledWith('sch-2027');
  });

  it('does not generate when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /2027 annual dues/ }));
    await user.click(screen.getByRole('button', { name: /generate dues/i }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not now' }));
    expect(generateDues).not.toHaveBeenCalled();
  });
});

describe('member dues', () => {
  it('records a payment, defaulting the amount to what is still owed', async () => {
    recordPayment.mockResolvedValue(dues({ amountPaid: '120.00', status: 'paid' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Record a payment for Terry Heather' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Amount received')).toHaveValue(100);
    await user.selectOptions(within(dialog).getByLabelText(/method/i), 'check');
    await user.type(within(dialog).getByLabelText(/reference/i), '1042');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    await waitFor(() =>
      expect(recordPayment).toHaveBeenCalledWith('d-terry', {
        amountPaid: '100.00',
        paymentMethod: 'check',
        transactionReference: '1042',
        notes: undefined,
      })
    );
    await waitFor(() => expect(fetchMemberDues).toHaveBeenCalledTimes(2));
  });

  it('shows the backend refusal when a payment is rejected', async () => {
    recordPayment.mockRejectedValue(new Error('These dues are marked waived and are not owing.'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Record a payment for Terry Heather' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('These dues are marked waived and are not owing.'));
  });

  it('waives owing dues with a reason', async () => {
    waive.mockResolvedValue(dues({ status: 'waived' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Waive the dues for Terry Heather' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Hardship, board approved');
    await user.click(within(dialog).getByRole('button', { name: 'Waive dues' }));

    await waitFor(() => expect(waive).toHaveBeenCalledWith('d-terry', 'Hardship, board approved'));
    expect(toastSuccess).toHaveBeenCalledWith('Dues waived');
  });

  it('offers a waived record only a reversal, which needs a reason', async () => {
    unwaive.mockResolvedValue(dues({ id: 'd-ann', status: 'pending' }));
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('button', { name: 'Record a payment for Ann Lee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Waive the dues for Ann Lee' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reverse the waiver for Ann Lee' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/why are you reversing/i), 'Waived by mistake');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse waiver' }));

    await waitFor(() => expect(unwaive).toHaveBeenCalledWith('d-ann', 'Waived by mistake'));
    expect(toastSuccess).toHaveBeenCalledWith('Waiver reversed — the dues are Pending again');
  });

  it('lists every payment in the ledger', async () => {
    listPayments.mockResolvedValue([
      {
        id: 'p1',
        organizationId: 'org',
        memberDuesId: 'd-terry',
        amount: '20.00',
        paymentMethod: 'cash',
        transactionReference: null,
        receivedAt: '2026-10-02T15:00:00Z',
        createdAt: '2026-10-02T15:00:00Z',
        updatedAt: '2026-10-02T15:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Payment history for Terry Heather' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Cash')).toBeInTheDocument();
    expect(listPayments).toHaveBeenCalledWith('d-terry');
  });
});
