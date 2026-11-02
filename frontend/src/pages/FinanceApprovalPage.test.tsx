import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import axios from 'axios';
import { FinanceApprovalPage } from './FinanceApprovalPage';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: (err: unknown) => typeof err === 'object' && err !== null && 'isAxiosError' in err,
  },
}));

const mockGet = axios.get as unknown as Mock;
const mockPost = axios.post as unknown as Mock;

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/finance/approvals/${token}`]}>
      <Routes>
        <Route path="/finance/approvals/:token" element={<FinanceApprovalPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('FinanceApprovalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the approval detail and records an approval', async () => {
    mockGet.mockResolvedValue({
      data: {
        step_name: 'CFO Approval',
        entity_type: 'purchase_request',
        status: 'pending',
        actionable: true,
        expired: false,
      },
    });
    mockPost.mockResolvedValue({
      data: { status: 'approved', message: 'Approval recorded. Thank you.' },
    });

    renderAt('tok-123');

    expect(await screen.findByText('Purchase Request')).toBeInTheDocument();
    expect(screen.getByText('CFO Approval')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/public/v1/finance/approvals/tok-123/approve', { notes: undefined })
    );
    expect(await screen.findByText(/Approval recorded/)).toBeInTheDocument();
  });

  it('shows an already-acted state when not actionable', async () => {
    mockGet.mockResolvedValue({
      data: {
        step_name: 'Chief Approval',
        entity_type: 'expense_report',
        status: 'approved',
        actionable: false,
        expired: false,
      },
    });

    renderAt('tok-x');

    expect(await screen.findByText('This step has already been approved. No action is needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('describes an auto-approved step in words rather than its raw status', async () => {
    mockGet.mockResolvedValue({
      data: {
        step_name: 'Treasurer Approval',
        entity_type: 'check_request',
        status: 'auto_approved',
        actionable: false,
        expired: false,
      },
    });

    renderAt('tok-auto');

    expect(
      await screen.findByText('This step has already been approved automatically. No action is needed.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/auto_approved/)).not.toBeInTheDocument();
  });

  it('shows no actions when the token is invalid', async () => {
    mockGet.mockRejectedValue(new Error('bad token'));

    renderAt('bad');

    await waitFor(() => expect(screen.queryByText('Loading approval…')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('needs the late expenses confirmed before an expense report can be approved', async () => {
    mockGet.mockResolvedValue({
      data: {
        step_name: 'Treasurer',
        entity_type: 'expense_report',
        status: 'pending',
        actionable: true,
        expired: false,
        late_line_count: 2,
      },
    });
    mockPost.mockResolvedValue({ data: { status: 'approved', message: 'Approval recorded. Thank you.' } });
    const user = userEvent.setup();

    renderAt('tok-late');

    const approve = await screen.findByRole('button', { name: /approve/i });
    expect(screen.getByText(/2 expenses on this report were submitted after/)).toBeInTheDocument();
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I have reviewed the late expenses' }));
    await user.click(approve);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/public/v1/finance/approvals/tok-late/approve', {
        notes: undefined,
        acknowledge_late_substantiation: true,
      })
    );
  });

  it('keeps the notes box focused while the approver types', async () => {
    mockGet.mockResolvedValue({
      data: {
        step_name: 'Treasurer',
        entity_type: 'check_request',
        status: 'pending',
        actionable: true,
        expired: false,
      },
    });
    const user = userEvent.setup();

    renderAt('tok-notes');

    await user.type(await screen.findByLabelText('Notes (optional)'), 'Matches the invoice');

    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Matches the invoice');
  });

  // W62: the token is cleared once used, so the approver's own second visit
  // and a link a mail program cut short reached the screen as the API's
  // wording — "Approval not found (Error code: LB-API-404)", "path.token: Value
  // is too short." — which tells someone outside the department nothing.
  it.each([404, 422])('explains a link that can no longer be used (%i)', async (status) => {
    mockGet.mockRejectedValue({ isAxiosError: true, response: { status, data: { detail: 'Approval not found' } } });
    renderAt('used-token');

    expect(await screen.findByText(/If you already responded, your response was recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/Approval not found/)).not.toBeInTheDocument();
  });

  it('shows the request’s title, amount and requester so the approver can decide', async () => {
    mockGet.mockResolvedValue({
      data: {
        step_name: 'CPA review',
        entity_type: 'purchase_request',
        status: 'pending',
        actionable: true,
        expired: false,
        title: 'Thermal camera',
        amount: '4200.00',
        requester_name: 'Jamie Rivera',
      },
    });

    renderAt('tok-detail');

    expect(await screen.findByText('Thermal camera')).toBeInTheDocument();
    expect(screen.getByText('$4,200.00')).toBeInTheDocument();
    expect(screen.getByText('Jamie Rivera')).toBeInTheDocument();
    expect(screen.getByText('Requested by')).toBeInTheDocument();
  });
});
