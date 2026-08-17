import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryVendor, ReorderRequest } from '../../../services/eventServices';

const mockGetReorderRequests = vi.fn();
const mockGetCategories = vi.fn();
const mockGetLowStockItems = vi.fn();
const mockCreateReorderRequest = vi.fn();
const mockUpdateReorderRequest = vi.fn();
const mockGetVendors = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getReorderRequests: (...a: unknown[]) => mockGetReorderRequests(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getLowStockItems: (...a: unknown[]) => mockGetLowStockItems(...a) as unknown,
    createReorderRequest: (...a: unknown[]) => mockCreateReorderRequest(...a) as unknown,
    updateReorderRequest: (...a: unknown[]) => mockUpdateReorderRequest(...a) as unknown,
    getVendors: (...a: unknown[]) => mockGetVendors(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
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

const makeVendor = (overrides: Partial<InventoryVendor> = {}): InventoryVendor => ({
  id: 'v-1',
  organization_id: 'org-1',
  name: 'Galls',
  is_preferred: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  contacts: [
    {
      id: 'c-1',
      organization_id: 'org-1',
      vendor_id: 'v-1',
      name: 'Dana Reyes',
      email: 'dana@galls.test',
      is_primary: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  item_count: 0,
  open_reorder_count: 0,
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
    mockGetVendors.mockResolvedValue([]);
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
    await user.type(await screen.findByPlaceholderText('e.g. SCBA Air Cylinders'), 'Hose Couplings');
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

  it('shows the linked vendor name in preference to the free-text one', async () => {
    mockGetReorderRequests.mockResolvedValue([makeReq({ vendor: 'galls inc', vendor_name: 'Galls' })]);
    renderWithRouter(<ReorderRequestsPage />);

    expect((await screen.findAllByText('Galls')).length).toBeGreaterThan(0);
    expect(screen.queryByText('galls inc')).not.toBeInTheDocument();
  });

  it('marks a row whose vendor was only typed in', async () => {
    mockGetReorderRequests.mockResolvedValue([makeReq({ vendor: 'Corner Medical Supply' })]);
    renderWithRouter(<ReorderRequestsPage />);

    // Muted on screen; said out loud for anyone who cannot see the styling.
    expect((await screen.findAllByText('(not on the vendor list)')).length).toBeGreaterThan(0);
  });

  it('links a new request to the picked vendor and prefills its contact', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findByText('No reorder requests found');

    await user.click(screen.getByRole('button', { name: /New Request/ }));
    await user.type(await screen.findByPlaceholderText('e.g. SCBA Air Cylinders'), 'Hose Couplings');
    await user.selectOptions(screen.getByLabelText('Vendor'), 'v-1');
    await user.click(screen.getByRole('button', { name: 'Create Request' }));

    await waitFor(() => expect(mockCreateReorderRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateReorderRequest.mock.calls[0]?.[0]).toMatchObject({
      vendor_id: 'v-1',
      vendor_contact: 'dana@galls.test',
    });
  });

  it('sends an explicit null when an edit unlinks the vendor', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    mockGetReorderRequests.mockResolvedValue([makeReq({ vendor_id: 'v-1', vendor_name: 'Galls' })]);
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findAllByText('SCBA Cylinders');

    await user.click(firstButton('Edit'));
    await screen.findByText('Edit Reorder Request');
    await user.selectOptions(screen.getByLabelText('Vendor'), '');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(mockUpdateReorderRequest).toHaveBeenCalledTimes(1));
    expect(mockUpdateReorderRequest.mock.calls[0]?.[1]).toMatchObject({ vendor_id: null });
  });

  it('clears the typed-in name when an edit links a vendor', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    mockGetReorderRequests.mockResolvedValue([makeReq({ vendor: 'galls inc', vendor_contact: 'someone@old.test' })]);
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findAllByText('SCBA Cylinders');

    await user.click(firstButton('Edit'));
    await screen.findByText('Edit Reorder Request');
    await user.selectOptions(screen.getByLabelText('Vendor'), 'v-1');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    // Without the explicit null the old supplier survives the link and
    // reappears the moment the vendor is unlinked again.
    await waitFor(() => expect(mockUpdateReorderRequest).toHaveBeenCalledTimes(1));
    expect(mockUpdateReorderRequest.mock.calls[0]?.[1]).toMatchObject({ vendor: null, vendor_id: 'v-1' });
  });

  it('still names a vendor that has since been deactivated', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor({ id: 'v-9', name: 'Cascade Fire', is_active: false })]);
    mockGetReorderRequests.mockResolvedValue([makeReq({ vendor_id: 'v-9', vendor_name: 'Cascade Fire' })]);
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findAllByText('SCBA Cylinders');

    await user.click(firstButton('Edit'));
    await screen.findByText('Edit Reorder Request');

    // Offered as "(inactive)" rather than dropping out of the list, which would
    // read as unlinked while still submitting the old id.
    expect(screen.getByRole('option', { name: 'Cascade Fire (inactive)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor')).toHaveValue('v-9');
  });

  it('fetches inactive vendors so an existing link can still be named', async () => {
    renderWithRouter(<ReorderRequestsPage />);
    await waitFor(() => expect(mockGetVendors).toHaveBeenCalledWith({ active_only: false }));
  });

  it('refetches with the selected status filter', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReorderRequestsPage />);
    await screen.findByText('No reorder requests found');

    await user.selectOptions(firstCombobox(), 'approved');

    await waitFor(() =>
      expect(mockGetReorderRequests).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'approved' }))
    );
  });
});
