import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import { FinanceApprovalPage } from './FinanceApprovalPage';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockGet = axios.get as unknown as Mock;
const mockPost = axios.post as unknown as Mock;

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/finance/approvals/${token}`]}>
      <Routes>
        <Route
          path="/finance/approvals/:token"
          element={<FinanceApprovalPage />}
        />
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
      expect(mockPost).toHaveBeenCalledWith(
        '/api/public/v1/finance/approvals/tok-123/approve',
        { notes: undefined }
      )
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

    expect(await screen.findByText(/already been approved/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument();
  });

  it('shows no actions when the token is invalid', async () => {
    mockGet.mockRejectedValue(new Error('bad token'));

    renderAt('bad');

    await waitFor(() =>
      expect(screen.queryByText('Loading approval…')).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument();
  });
});
