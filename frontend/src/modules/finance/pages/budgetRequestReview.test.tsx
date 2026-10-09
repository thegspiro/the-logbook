/**
 * Budget requests — the Treasurer's review screen.
 *
 * A draft year at a time, Submitted by default, a count per status, a totals
 * row, and a decision dialog whose note rules match the API's. The list is
 * fetched again after a decision, because a decision writes the draft line.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { BudgetRequest, FiscalYearOption } from '../types';

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

const options = vi.fn();
const list = vi.fn();
const decide = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: { options: (...args: unknown[]) => options(...args) as unknown },
  budgetRequestService: {
    list: (...args: unknown[]) => list(...args) as unknown,
    decide: (...args: unknown[]) => decide(...args) as unknown,
  },
}));

import BudgetRequestReviewPage from './BudgetRequestReviewPage';

const draftYear: FiscalYearOption = {
  id: 'fy-27',
  name: 'FY2027',
  status: 'draft',
  requestDeadline: '2026-11-15',
  requestsOpen: true,
};

const request = (id: string, status: BudgetRequest['status'], extra: Partial<BudgetRequest> = {}): BudgetRequest => ({
  id,
  organizationId: 'org',
  fiscalYearId: 'fy-27',
  lineLabel: `Line ${id}`,
  isProposedLine: false,
  ownerPositionName: 'Training Officer',
  requestedAmount: '1000.00',
  approvedAmount: null,
  status,
  justification: `Because ${id}`,
  submittedByName: 'Pat Trainer',
  submittedAt: '2026-10-05T15:00:00Z',
  lastYearFiscalYearName: 'FY2026',
  lastYearBudgeted: '800.00',
  lastYearSpent: '300.00',
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  ...extra,
});

const requests = [
  request('a', 'submitted', { requestedAmount: '2400.00', lastYearBudgeted: '2000.00' }),
  request('b', 'submitted', { requestedAmount: '100.10', lastYearBudgeted: null, lastYearSpent: null }),
  request('c', 'approved', { requestedAmount: '500.00', approvedAmount: '500.00' }),
  request('d', 'declined', { decisionNote: 'Not this year' }),
  request('e', 'draft', { submittedAt: null, submittedByName: null }),
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/finance/budget-requests/review']}>
      <BudgetRequestReviewPage />
    </MemoryRouter>
  );

const row = (label: string) => screen.findByRole('row', { name: new RegExp(`^${label}\\b`) });

beforeEach(() => {
  for (const mock of [options, list, decide, toastError, toastSuccess]) mock.mockReset();
  options.mockResolvedValue([draftYear, { id: 'fy-26', name: 'FY2026', status: 'active' }]);
  list.mockResolvedValue(requests);
  decide.mockResolvedValue({});
});

describe('Budget request review — the list', () => {
  it('opens on the submitted requests of the draft year, with counts and the deadline', async () => {
    renderPage();
    await row('Line a');
    expect(list).toHaveBeenCalledWith({ fiscalYearId: 'fy-27' });
    expect(screen.getByText('Line b')).toBeInTheDocument();
    expect(screen.queryByText('Line c')).not.toBeInTheDocument();
    const counts = screen.getByRole('list', { name: 'Requests by status' });
    expect(counts).toHaveTextContent('Submitted: 2');
    expect(counts).toHaveTextContent('Approved: 1');
    expect(counts).toHaveTextContent('Declined: 1');
    expect(counts).toHaveTextContent('Draft: 1');
    expect(screen.getByText('Requests close Nov 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Owners can still change requests')).toBeInTheDocument();
  });

  it('shows who submitted, this year, the request and the status on each row', async () => {
    renderPage();
    const tr = await row('Line a');
    expect(tr).toHaveTextContent('Training Officer');
    expect(tr).toHaveTextContent('Pat Trainer');
    expect(tr).toHaveTextContent('$2,000.00');
    expect(tr).toHaveTextContent('$300.00');
    expect(tr).toHaveTextContent('$2,400.00');
    expect(tr).toHaveTextContent('Submitted');
  });

  it('totals what is shown, in cents', async () => {
    renderPage();
    await row('Line a');
    const totals = screen.getByRole('row', { name: 'Totals' });
    expect(totals).toHaveTextContent('Total (2 requests)');
    expect(totals).toHaveTextContent('$2,500.10');
    expect(totals).toHaveTextContent('$2,000.00');
    expect(totals).toHaveTextContent('$0.00');
  });

  it('filters by status', async () => {
    renderPage();
    await row('Line a');
    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'approved');
    expect(screen.getByText('Line c')).toBeInTheDocument();
    expect(screen.queryByText('Line a')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Totals' })).toHaveTextContent('Total (1 request)');
  });

  it('says when nothing is waiting', async () => {
    list.mockResolvedValue([request('c', 'approved')]);
    renderPage();
    expect(await screen.findByText('No submitted requests for FY2027.')).toBeInTheDocument();
  });

  it('explains when there is no draft year', async () => {
    options.mockResolvedValue([{ id: 'fy-26', name: 'FY2026', status: 'active' }]);
    renderPage();
    expect(await screen.findByText('No draft fiscal year')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});

describe('Budget request review — deciding', () => {
  const openReview = async (label = 'Line a') => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await row(label)).getByRole('button', { name: `Review ${label}` }));
    return { user, dialog: await screen.findByRole('dialog') };
  };

  it('shows the justification and approves as asked, then fetches again', async () => {
    const { user, dialog } = await openReview();
    expect(dialog).toHaveTextContent('Because a');
    expect(dialog).toHaveTextContent('Pat Trainer asked for $2,400.00');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith('a', { decision: 'approve', decisionNote: undefined }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith('Request approved');
  });

  it('adjusts with an amount and a required note', async () => {
    const { user, dialog } = await openReview();
    await user.click(within(dialog).getByLabelText('Approve a different amount'));
    const amount = within(dialog).getByLabelText('Amount approved');
    await user.clear(amount);
    await user.type(amount, '1800');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    expect(within(dialog).getByText('Say why the amount was adjusted.')).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Note to the line owner'), 'One seat only');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('a', {
        decision: 'adjust',
        approvedAmount: '1800.00',
        decisionNote: 'One seat only',
      })
    );
  });

  it('declines only with a note', async () => {
    const { user, dialog } = await openReview();
    await user.click(within(dialog).getByLabelText('Decline'));
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    expect(within(dialog).getByText('Say why the request was declined.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Note to the line owner'), 'Not this year');
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('a', { decision: 'decline', decisionNote: 'Not this year' })
    );
  });

  it("shows the API's refusal and keeps the dialog open", async () => {
    decide.mockRejectedValue(new Error('That amount is below what the line has already spent or committed.'));
    const { user, dialog } = await openReview();
    await user.click(within(dialog).getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('That amount is below what the line has already spent or committed.')
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('lets a decision be changed, and a draft only be read', async () => {
    const user = userEvent.setup();
    renderPage();
    await row('Line a');
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    expect(within(await row('Line c')).getByRole('button', { name: 'Change decision on Line c' })).toBeInTheDocument();
    expect(within(await row('Line e')).queryByRole('button')).not.toBeInTheDocument();
  });
});
