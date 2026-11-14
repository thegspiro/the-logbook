/**
 * The purchase request form keeps a real draft on the server as the member
 * types, asks before losing entries the server cannot hold yet, and lets a
 * saved draft be discarded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const toastSuccess = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: { success: (message: string) => toastSuccess(message), error: vi.fn() },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const updateRequest = vi.fn();
const cancelRequest = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: {
    options: () => Promise.resolve([{ id: 'fy-1', name: 'FY2026', status: 'active' }]),
  },
  budgetService: { options: () => Promise.resolve([]) },
  purchaseRequestService: {
    update: (...args: unknown[]) => updateRequest(...args) as unknown,
    cancel: (...args: unknown[]) => cancelRequest(...args) as unknown,
  },
  fundService: { list: () => Promise.resolve([]) },
  // The form shows who would approve the request; not what these tests are about.
  approvalChainService: {
    routePreview: () => Promise.resolve({ manual: true, steps: [], secondApproverRequired: false }),
  },
  financeSettingsService: {
    get: () =>
      Promise.resolve({
        dualApprovalThreshold: null,
        substantiationMode: 'off',
        substantiationDays: 60,
        fundOverspendMode: 'warn',
      }),
  },
}));

import PurchaseRequestFormPage from './PurchaseRequestFormPage';

const createPurchaseRequest = vi.fn();

const renderForm = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/purchase-requests/new']}>
        <Routes>
          <Route path="/finance/purchase-requests/new" element={<PurchaseRequestFormPage />} />
          <Route path="/finance/purchase-requests" element={<p>The request list</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

const fillTitleAndAmount = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText('Brief title for the purchase'), 'Ladder');
  const amount = screen.getByPlaceholderText('0.00');
  await user.clear(amount);
  await user.type(amount, '400');
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  createPurchaseRequest.mockReset();
  updateRequest.mockReset();
  cancelRequest.mockReset();
  createPurchaseRequest.mockResolvedValue({ id: 'pr-new' });
  updateRequest.mockResolvedValue({});
  cancelRequest.mockResolvedValue({});
  storeState = { createPurchaseRequest, isLoading: false, fetchPurchaseRequest: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('purchase request draft autosave', () => {
  it('saves a draft on its own once there is a title and an amount', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    expect(screen.getByText('Add a title and an amount to start saving a draft.')).toBeInTheDocument();

    await fillTitleAndAmount(user);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(createPurchaseRequest).toHaveBeenCalledTimes(1);
    expect(createPurchaseRequest).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ladder', estimatedAmount: '400.00', fiscalYearId: 'fy-1' })
    );
    expect(await screen.findByText(/^Draft saved at/)).toBeInTheDocument();
  });

  it('updates that draft on the next change instead of creating another', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    await fillTitleAndAmount(user);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await user.type(screen.getByPlaceholderText('Vendor or supplier name'), 'Acme');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(createPurchaseRequest).toHaveBeenCalledTimes(1);
    expect(updateRequest).toHaveBeenCalledWith('pr-new', expect.objectContaining({ vendor: 'Acme' }));
  });

  it('asks before leaving with entries the server cannot hold yet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    await user.type(screen.getByPlaceholderText('Brief title for the purchase'), 'Lad');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('The request list')).not.toBeInTheDocument();
    expect(createPurchaseRequest).not.toHaveBeenCalled();
  });

  it('leaves without asking when nothing was entered', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByText('The request list')).toBeInTheDocument();
  });

  it('saves what can be saved and leaves, without asking', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    await fillTitleAndAmount(user);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByText('The request list')).toBeInTheDocument();
    expect(createPurchaseRequest).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Draft saved');
  });

  it('discards a saved draft by withdrawing it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    await fillTitleAndAmount(user);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await user.click(await screen.findByRole('button', { name: 'Discard draft' }));
    expect(await screen.findByText('Discard this draft?')).toBeInTheDocument();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard draft' }));

    await waitFor(() => expect(cancelRequest).toHaveBeenCalledWith('pr-new'));
    expect(await screen.findByText('The request list')).toBeInTheDocument();
  });

  it('keeps the draft when the discard is declined', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();
    await fillTitleAndAmount(user);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await user.click(await screen.findByRole('button', { name: 'Discard draft' }));
    await user.click(await screen.findByRole('button', { name: 'Keep draft' }));

    expect(cancelRequest).not.toHaveBeenCalled();
    expect(screen.queryByText('The request list')).not.toBeInTheDocument();
  });
});

// A draft opened again from the list is already on the server. Nothing is
// sent until something changes, and the status line said "Saving soon…"
// anyway, for a save that never came.
describe('an existing draft opened for editing', () => {
  const DRAFT = {
    id: 'pr-1',
    title: 'Smoke alarms for the spring giveaway',
    description: '',
    vendor: '',
    estimatedAmount: '240.00',
    priority: 'medium',
    budgetId: null,
    fundCampaignId: null,
    fiscalYearId: 'fy-1',
    status: 'draft',
  };

  const renderEdit = () =>
    render(
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/finance/purchase-requests/pr-1/edit']}>
          <Routes>
            <Route path="/finance/purchase-requests/:id/edit" element={<PurchaseRequestFormPage />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    );

  beforeEach(() => {
    storeState = {
      createPurchaseRequest,
      isLoading: false,
      fetchPurchaseRequest: vi.fn(),
      selectedPurchaseRequest: DRAFT,
    };
  });

  it('says the draft is saved, and sends nothing, while it is unchanged', async () => {
    renderEdit();
    expect(await screen.findByDisplayValue('Smoke alarms for the spring giveaway')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('Draft saved')).toBeInTheDocument();
    expect(screen.queryByText('Saving soon…')).not.toBeInTheDocument();
    expect(updateRequest).not.toHaveBeenCalled();
  });

  it('still saves it once something changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEdit();
    await user.type(await screen.findByDisplayValue('Smoke alarms for the spring giveaway'), ' (20)');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(updateRequest).toHaveBeenCalledTimes(1);
    expect(updateRequest).toHaveBeenCalledWith(
      'pr-1',
      expect.objectContaining({ title: 'Smoke alarms for the spring giveaway (20)' })
    );
    expect(await screen.findByText(/^Draft saved at/)).toBeInTheDocument();
  });
});
