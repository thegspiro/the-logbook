import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ReorderRequest } from '../../../services/eventServices';

const mockGetReorderRequests = vi.fn();
const mockGetCategories = vi.fn();
const mockGetLowStockItems = vi.fn();
const mockCreateReorderRequest = vi.fn();
const mockUpdateReorderRequest = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getReorderRequests: (...a: unknown[]) => mockGetReorderRequests(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getLowStockItems: (...a: unknown[]) => mockGetLowStockItems(...a) as unknown,
    createReorderRequest: (...a: unknown[]) => mockCreateReorderRequest(...a) as unknown,
    updateReorderRequest: (...a: unknown[]) => mockUpdateReorderRequest(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => { mockToastSuccess(...a); },
    error: (...a: unknown[]): void => { mockToastError(...a); },
  },
}));

import ReorderRequestsPage from './ReorderRequestsPage';

const makeReq = (overrides: Partial<ReorderRequest> = {}): ReorderRequest => ({
  id: 'r-1',
  organization_id: 'org-1',
  item_name: 'SCBA Cylinders',
  quantity_requested: 4,
  status: 'pending',
  urgency: 'high',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  ...overrides,
});

// The page renders both a desktop table and mobile cards, so action buttons
// appear twice in jsdom; grab the first match.
const firstButton = (name: string | RegExp): HTMLElement => {
  const [btn] = screen.getAllByRole('button', { name });
  if (!btn) throw new Error(`button not found: ${String(name)}`);
  return btn;
};

// The modal's submit button can share a label with row action buttons; the
// modal renders last in the DOM, so the final match is the submit button.
const lastButton = (name: string | RegExp): HTMLElement => {
  const btns = screen.getAllByRole('button', { name });
  const btn = btns[btns.length - 1];
  if (!btn) throw new Error(`button not found: ${String(name)}`);
  return btn;
};

const firstCombobox = (): HTMLElement => {
  const [el] = screen.getAllByRole('combobox');
  if (!el) throw new Error('combobox not found');
  return el;
};

describe('ReorderRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReorderRequests.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockGetLowStockItems.mockResolvedValue([]);
    mockCreateReorderRequest.mockResolvedValue({});
    mockUpdateReorderRequest.mockResolvedValue({});
  });

  it('shows the empty state when there are no requests', async () => {
    renderWithRouter(<ReorderRequestsPage />);
    expect(await screen.findByText('No reorder requests found')).toBeInTheDocument();
  });

  it('shows an error toast when loading fails', async () => {
    mockGetReorderRequests.mockRejectedValue(new Error('boom'));
    renderWithRouter(<ReorderRequestsPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('renders requests', async () => {
    mockGetReorderRequests.mockResolvedValue([makeReq()]);
    renderWithRouter(<ReorderRequestsPage />);
    expect((await screen.findAllByText('SCBA Cylinders')).length).toBeGreaterThan(0);
  });

  it('creates a new reorder request', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findByText('No reorder requests found');

    await user.click(screen.getByRole('button', { name: /New Request/ }));
    await user.type(
      await screen.findByPlaceholderText('e.g. SCBA Air Cylinders'),
      'Hose Couplings',
    );
    await user.click(screen.getByRole('button', { name: 'Create Request' }));

    await waitFor(() => expect(mockCreateReorderRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateReorderRequest.mock.calls[0]?.[0]).toMatchObject({
      item_name: 'Hose Couplings',
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Reorder request created');
  });

  it('edits a pending request', async () => {
    mockGetReorderRequests.mockResolvedValue([makeReq({ status: 'pending' })]);
    const user = userEvent.setup();
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findAllByText('SCBA Cylinders');

    await user.click(firstButton('Edit'));
    expect(await screen.findByText('Edit Reorder Request')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(mockUpdateReorderRequest).toHaveBeenCalledTimes(1));
    expect(mockUpdateReorderRequest.mock.calls[0]?.[0]).toBe('r-1');
  });

  it('updates a request status', async () => {
    mockGetReorderRequests.mockResolvedValue([makeReq({ status: 'approved' })]);
    const user = userEvent.setup();
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findAllByText('SCBA Cylinders');

    await user.click(firstButton('Update Status'));
    expect(await screen.findByText('Update Reorder Status')).toBeInTheDocument();
    await user.click(lastButton('Update Status'));

    await waitFor(() => expect(mockUpdateReorderRequest).toHaveBeenCalledTimes(1));
    expect(mockUpdateReorderRequest.mock.calls[0]?.[0]).toBe('r-1');
    expect(mockToastSuccess).toHaveBeenCalledWith('Status updated');
  });

  it('refetches with the selected status filter', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findByText('No reorder requests found');

    await user.selectOptions(firstCombobox(), 'approved');

    await waitFor(() =>
      expect(mockGetReorderRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'approved' }),
      ),
    );
  });
});
