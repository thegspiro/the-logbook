/**
 * Next year's budget — the line owner's request screen.
 *
 * Which lines are the member's, and whether requests are still open, are the
 * backend's answers (`my-lines`, `requestsOpen`); the screen words the deadline,
 * offers only what the API would accept for each status, confirms before
 * withdrawing or deleting, and fetches again after every action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type {
  Budget,
  BudgetRequest,
  BudgetRequestProposalOptions,
  FiscalYearOption,
  MyBudgetRequestLines,
} from '../types';

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'u-me' } }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

const options = vi.fn();
const myLines = vi.fn();
const list = vi.fn();
const proposalOptions = vi.fn();
const create = vi.fn();
const update = vi.fn();
const submit = vi.fn();
const withdraw = vi.fn();
const remove = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: { options: (...args: unknown[]) => options(...args) as unknown },
  budgetRequestService: {
    myLines: (...args: unknown[]) => myLines(...args) as unknown,
    list: (...args: unknown[]) => list(...args) as unknown,
    proposalOptions: (...args: unknown[]) => proposalOptions(...args) as unknown,
    create: (...args: unknown[]) => create(...args) as unknown,
    update: (...args: unknown[]) => update(...args) as unknown,
    submit: (...args: unknown[]) => submit(...args) as unknown,
    withdraw: (...args: unknown[]) => withdraw(...args) as unknown,
    delete: (...args: unknown[]) => remove(...args) as unknown,
  },
}));

import BudgetRequestsPage from './BudgetRequestsPage';
import { useOwnsBudgetsStore } from '../hooks/useOwnsBudgets';

const year = (extra: Partial<FiscalYearOption> = {}): FiscalYearOption => ({
  id: 'fy-27',
  name: 'FY2027',
  status: 'draft',
  requestDeadline: '2026-11-15',
  requestsOpen: true,
  ...extra,
});

const line = (id: string, categoryName: string, extra: Partial<Budget> = {}): Budget => ({
  id,
  organizationId: 'org',
  fiscalYearId: 'fy-27',
  categoryId: `cat-${id}`,
  categoryName,
  amountBudgeted: '0.00',
  amountSpent: '0.00',
  amountEncumbered: '0.00',
  effectiveOwnerPositionName: 'Training Officer',
  createdBy: 'u-t',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...extra,
});

const request = (id: string, status: BudgetRequest['status'], extra: Partial<BudgetRequest> = {}): BudgetRequest => ({
  id,
  organizationId: 'org',
  fiscalYearId: 'fy-27',
  lineLabel: 'Training',
  isProposedLine: false,
  requestedAmount: '2400.00',
  approvedAmount: null,
  status,
  justification: 'Two more academy seats',
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  ...extra,
});

const NO_OPTIONS: BudgetRequestProposalOptions = { positions: [], categories: [], stations: [] };

const linesFor = (fiscalYear: FiscalYearOption, entries: MyBudgetRequestLines['lines']): MyBudgetRequestLines => ({
  fiscalYear,
  lines: entries,
});

const setup = (
  fiscalYear: FiscalYearOption,
  entries: MyBudgetRequestLines['lines'],
  extra: { requests?: BudgetRequest[]; proposal?: BudgetRequestProposalOptions; years?: FiscalYearOption[] } = {}
) => {
  options.mockResolvedValue(extra.years ?? [fiscalYear, { id: 'fy-26', name: 'FY2026', status: 'active' }]);
  myLines.mockResolvedValue(linesFor(fiscalYear, entries));
  list.mockResolvedValue(extra.requests ?? entries.flatMap((e) => (e.request ? [e.request] : [])));
  proposalOptions.mockResolvedValue(extra.proposal ?? NO_OPTIONS);
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/finance/budget-requests']}>
      <ConfirmProvider>
        <BudgetRequestsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const card = async (name: string) => screen.findByRole('listitem', { name });

beforeEach(() => {
  for (const mock of [options, myLines, list, proposalOptions, create, update, submit, withdraw, remove]) {
    mock.mockReset();
  }
  toastError.mockReset();
  toastSuccess.mockReset();
  for (const mock of [create, update, submit, withdraw, remove]) mock.mockResolvedValue({});
  useOwnsBudgetsStore.setState({ userId: null, ownsAny: false, plansNextYear: false, loading: false });
});

describe("Next year's budget — the deadline", () => {
  it('says when requests close', async () => {
    setup(year(), []);
    renderPage();
    expect(await screen.findByText('Requests close Nov 15, 2026')).toBeInTheDocument();
  });

  it('says when there is no deadline', async () => {
    setup(year({ requestDeadline: null }), []);
    renderPage();
    expect(await screen.findByText('No deadline set')).toBeInTheDocument();
  });

  it('says when requests are closed, and what the deadline was', async () => {
    setup(year({ requestsOpen: false, requestDeadline: '2026-10-01' }), []);
    renderPage();
    expect(await screen.findByText('Requests are closed')).toBeInTheDocument();
    expect(screen.getByText(/The deadline for FY2027 was Oct 1, 2026/)).toBeInTheDocument();
  });

  it('explains when no year is being planned', async () => {
    options.mockResolvedValue([{ id: 'fy-26', name: 'FY2026', status: 'active' }]);
    proposalOptions.mockResolvedValue(NO_OPTIONS);
    renderPage();
    expect(await screen.findByText('No budget is being planned')).toBeInTheDocument();
    expect(myLines).not.toHaveBeenCalled();
  });

  it('asks for the chosen draft year when there are several', async () => {
    const second = year({ id: 'fy-28', name: 'FY2028' });
    setup(year(), [], { years: [year(), second] });
    renderPage();
    await screen.findByText('Requests close Nov 15, 2026');
    expect(myLines).toHaveBeenLastCalledWith('fy-27');
    myLines.mockResolvedValue(linesFor(second, []));
    await userEvent.setup().selectOptions(screen.getByLabelText('Fiscal year'), 'fy-28');
    await waitFor(() => expect(myLines).toHaveBeenLastCalledWith('fy-28'));
  });
});

describe("Next year's budget — a line's request", () => {
  it('shows this year, the request and the decision for each line', async () => {
    setup(year(), [
      {
        budget: line('b-1', 'Training'),
        request: request('r-1', 'adjusted', { approvedAmount: '1800.00', decisionNote: 'One seat only' }),
        lastYearFiscalYearName: 'FY2026',
        lastYearBudgeted: '2000.00',
        lastYearSpent: '500.00',
      },
    ]);
    renderPage();
    const item = await card('Training · Department-wide');
    expect(item).toHaveTextContent('Budgeted FY2026$2,000.00');
    expect(item).toHaveTextContent('Spent FY2026$500.00');
    expect(item).toHaveTextContent('Requested$2,400.00');
    expect(item).toHaveTextContent('Approved$1,800.00');
    expect(item).toHaveTextContent('Adjusted');
    expect(item).toHaveTextContent("Treasurer's note: One seat only");
    // Decided: the record, with nothing to press.
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
  });

  it('creates a draft for a line with the amount and justification', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: null }]);
    renderPage();
    const user = userEvent.setup();
    const item = await card('Training · Department-wide');
    await user.click(within(item).getByRole('button', { name: 'Request an amount' }));
    await user.type(screen.getByLabelText('Amount requested'), '2400');
    await user.type(screen.getByLabelText('Justification'), '  Two more seats ');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        fiscalYearId: 'fy-27',
        budgetId: 'b-1',
        requestedAmount: '2400.00',
        justification: 'Two more seats',
      })
    );
    await waitFor(() => expect(myLines).toHaveBeenCalledTimes(2));
  });

  it('will not save without an amount or a justification', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: null }]);
    renderPage();
    const user = userEvent.setup();
    await user.click(
      within(await card('Training · Department-wide')).getByRole('button', { name: 'Request an amount' })
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Enter an amount of zero or more.')).toBeInTheDocument();
    expect(screen.getByText('Say what the money is for.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('edits a draft, sending both fields it owns', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: request('r-1', 'draft') }]);
    renderPage();
    const user = userEvent.setup();
    await user.click(within(await card('Training · Department-wide')).getByRole('button', { name: 'Edit' }));
    const amount = screen.getByLabelText('Amount requested');
    await user.clear(amount);
    await user.type(amount, '2500');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('r-1', {
        requestedAmount: '2500.00',
        justification: 'Two more academy seats',
      })
    );
  });

  it('submits a draft and fetches again', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: request('r-1', 'draft') }]);
    renderPage();
    await userEvent
      .setup()
      .click(within(await card('Training · Department-wide')).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('r-1'));
    await waitFor(() => expect(myLines).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith('Request submitted to the Treasurer');
  });

  it('deletes a draft only after confirming', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: request('r-1', 'draft') }]);
    renderPage();
    const user = userEvent.setup();
    await user.click(within(await card('Training · Department-wide')).getByRole('button', { name: 'Delete draft' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(remove).not.toHaveBeenCalled();

    await user.click(within(await card('Training · Department-wide')).getByRole('button', { name: 'Delete draft' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r-1'));
  });

  it('withdraws a submitted request after confirming', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: request('r-1', 'submitted') }]);
    renderPage();
    const user = userEvent.setup();
    const item = await card('Training · Department-wide');
    expect(within(item).queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    await user.click(within(item).getByRole('button', { name: 'Withdraw' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('r-1'));
  });

  it("shows the API's refusal and still fetches again", async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: request('r-1', 'draft') }]);
    submit.mockRejectedValue(new Error('The request deadline for FY2027 has passed.'));
    renderPage();
    await userEvent
      .setup()
      .click(within(await card('Training · Department-wide')).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('The request deadline for FY2027 has passed.'));
    await waitFor(() => expect(myLines).toHaveBeenCalledTimes(2));
  });

  it('is read-only after the deadline', async () => {
    setup(year({ requestsOpen: false }), [
      { budget: line('b-1', 'Training'), request: request('r-1', 'draft') },
      { budget: line('b-2', 'Gear'), request: null },
    ]);
    renderPage();
    await card('Training · Department-wide');
    expect(
      screen.queryByRole('button', { name: /Submit|Edit|Delete draft|Request an amount/ })
    ).not.toBeInTheDocument();
  });

  it('keeps the navigation entry in step with what it found', async () => {
    setup(year(), [{ budget: line('b-1', 'Training'), request: null }]);
    renderPage();
    await card('Training · Department-wide');
    await waitFor(() => expect(useOwnsBudgetsStore.getState()).toMatchObject({ userId: 'u-me', plansNextYear: true }));
  });
});

describe("Next year's budget — proposing a new line", () => {
  const proposal: BudgetRequestProposalOptions = {
    positions: [{ id: 'pos-cap', name: 'Station 2 Captain' }],
    categories: [{ id: 'cat-haz', name: 'Hazmat' }],
    stations: [{ id: 'st-2', name: 'Station 2' }],
  };

  it('offers only the positions the member holds and sends a create payload', async () => {
    setup(year(), [], { proposal });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Propose a new line' }));
    const position = screen.getByLabelText('For your position');
    expect(
      within(position)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Choose a position', 'Station 2 Captain']);
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-haz');
    await user.type(screen.getByLabelText('Amount requested'), '900');
    await user.type(screen.getByLabelText('Justification'), 'Spill kits');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    // No station chosen: left out of the create payload, not sent as "".
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        fiscalYearId: 'fy-27',
        categoryId: 'cat-haz',
        stationId: undefined,
        ownerPositionId: 'pos-cap',
        requestedAmount: '900.00',
        justification: 'Spill kits',
      })
    );
  });

  it('lists the proposals made, with their actions', async () => {
    setup(year(), [], {
      proposal,
      requests: [
        request('r-p', 'draft', {
          isProposedLine: true,
          lineLabel: 'Hazmat · Station 2',
          ownerPositionName: 'Captain',
        }),
      ],
    });
    renderPage();
    const item = await card('Hazmat · Station 2');
    expect(item).toHaveTextContent('For Captain');
    expect(within(item).getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('is not offered to a member who holds no position, or after the deadline', async () => {
    setup(year({ requestsOpen: false }), [], { proposal });
    renderPage();
    await screen.findByText('Requests are closed');
    expect(screen.queryByRole('button', { name: 'Propose a new line' })).not.toBeInTheDocument();
  });
});
