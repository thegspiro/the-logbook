import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { UserInventoryResponse } from '../types';

const mockGetUserInventory = vi.fn();
const mockGetEquipmentRequests = vi.fn();
const mockGetReturnRequests = vi.fn();
const mockGetItems = vi.fn();
const mockGetRequestableCatalog = vi.fn();
const mockCreateEquipmentRequest = vi.fn();
const mockCheckInItem = vi.fn();
const mockExtendCheckout = vi.fn();
const mockCreateReturnRequest = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getUserInventory: (...a: unknown[]) => mockGetUserInventory(...a) as unknown,
    getEquipmentRequests: (...a: unknown[]) => mockGetEquipmentRequests(...a) as unknown,
    getReturnRequests: (...a: unknown[]) => mockGetReturnRequests(...a) as unknown,
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getRequestableCatalog: (...a: unknown[]) => mockGetRequestableCatalog(...a) as unknown,
    createEquipmentRequest: (...a: unknown[]) => mockCreateEquipmentRequest(...a) as unknown,
    checkInItem: (...a: unknown[]) => mockCheckInItem(...a) as unknown,
    extendCheckout: (...a: unknown[]) => mockExtendCheckout(...a) as unknown,
    createReturnRequest: (...a: unknown[]) => mockCreateReturnRequest(...a) as unknown,
    getMySizePreferences: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { user: unknown }) => unknown) => {
    const state = { user: { id: 'me', rank: 'ff', positions: [] } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../../hooks/useRanks', () => ({ useRanks: () => ({ ranks: [] }) }));
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

import MyEquipmentPage from './MyEquipmentPage';

const emptyInv: UserInventoryResponse = {
  permanent_assignments: [],
  active_checkouts: [],
  issued_items: [],
};

const fullInv: UserInventoryResponse = {
  permanent_assignments: [
    {
      assignment_id: 'as-1',
      item_id: 'it-1',
      item_name: 'Turnout Coat',
      condition: 'good',
      assigned_date: '2026-01-01T00:00:00Z',
    },
  ],
  active_checkouts: [
    {
      checkout_id: 'co-1',
      item_id: 'it-2',
      item_name: 'Thermal Camera',
      checked_out_at: '2026-02-01T00:00:00Z',
      is_overdue: false,
    },
  ],
  issued_items: [
    {
      issuance_id: 'is-1',
      item_id: 'it-3',
      item_name: 'Work Gloves',
      quantity_issued: 1,
      issued_at: '2026-02-05T00:00:00Z',
    },
  ],
};

describe('MyEquipmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserInventory.mockResolvedValue(emptyInv);
    mockGetEquipmentRequests.mockResolvedValue({ requests: [] });
    mockGetReturnRequests.mockResolvedValue([]);
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetRequestableCatalog.mockResolvedValue({ products: [], categories: [] });
    mockCreateEquipmentRequest.mockResolvedValue({});
    mockCheckInItem.mockResolvedValue({});
    mockExtendCheckout.mockResolvedValue({});
    mockCreateReturnRequest.mockResolvedValue({});
  });

  it('renders the header after loading', async () => {
    renderWithRouter(<MyEquipmentPage />);
    expect(await screen.findByRole('heading', { name: 'My Issued Gear' })).toBeInTheDocument();
    expect(mockGetUserInventory).toHaveBeenCalledWith('me');
  });

  it('shows empty section messaging when nothing is assigned', async () => {
    renderWithRouter(<MyEquipmentPage />);
    expect(await screen.findByText('Nothing issued to you.')).toBeInTheDocument();
    expect(screen.getByText('Issued to Me')).toBeInTheDocument();
    expect(screen.getByText('No active temporary loans.')).toBeInTheDocument();
    expect(screen.getByText('Active Temporary Loans')).toBeInTheDocument();
    // Permanent assignments and pool issuances share one section; a member
    // holds both open-endedly, so nothing on this page splits them any more.
    expect(screen.queryByText('Permanent Assignments')).not.toBeInTheDocument();
    expect(screen.queryByText('Issued Items')).not.toBeInTheDocument();
  });

  it('shows an error toast when inventory fails to load', async () => {
    mockGetUserInventory.mockRejectedValue(new Error('boom'));
    renderWithRouter(<MyEquipmentPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('renders assigned, checked-out, and issued items', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    renderWithRouter(<MyEquipmentPage />);
    expect(await screen.findByText('Turnout Coat')).toBeInTheDocument();
    expect(screen.getByText('Thermal Camera')).toBeInTheDocument();
    expect(screen.getByText('Work Gloves')).toBeInTheDocument();
  });

  it('does not let a member mark an active checkout physically received', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByText('Thermal Camera');
    expect(screen.queryByRole('button', { name: 'Check In' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Notify quartermaster of return/ })).not.toHaveLength(0);
    expect(mockCheckInItem).not.toHaveBeenCalled();
  });

  it('lists assignments and issuances in one section, most recent first', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByText('Turnout Coat');

    const gearNames = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/inventory/items/'))
      .map((a) => a.textContent);
    // Work Gloves (issued 2026-02-05) precedes Turnout Coat (assigned
    // 2026-01-01): the two record types interleave by date rather than
    // sitting in separate blocks. The checkout trails both, in its own
    // section, so its position here is incidental.
    expect(gearNames).toEqual(['Work Gloves', 'Turnout Coat', 'Thermal Camera']);
  });

  it('submits a return request for an assignment row', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByText('Turnout Coat');

    // Target the row by name rather than by position: merging the two lists
    // means an assignment is no longer reliably the first action on the page.
    // Notifying does not claim the member has already handed the gear in.
    await user.click(screen.getByRole('button', { name: 'Notify quartermaster of return: Turnout Coat' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(mockCreateReturnRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateReturnRequest.mock.calls[0]?.[0]).toMatchObject({
      return_type: 'assignment',
      item_id: 'it-1',
      assignment_id: 'as-1',
    });
  });

  it('submits a return request for an issuance row in the same section', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByText('Work Gloves');

    await user.click(screen.getByRole('button', { name: 'Notify quartermaster of return: Work Gloves' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(mockCreateReturnRequest).toHaveBeenCalledTimes(1));
    // The merged list must not flatten the two record types onto one endpoint
    // shape: an issuance returns units against issuance_id, not assignment_id.
    expect(mockCreateReturnRequest.mock.calls[0]?.[0]).toMatchObject({
      return_type: 'issuance',
      item_id: 'it-3',
      issuance_id: 'is-1',
      quantity_returning: 1,
    });
  });

  it('loads my requests when the panel is opened', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByRole('heading', { name: 'My Issued Gear' });

    await user.click(screen.getByRole('button', { name: /My Requests/ }));
    await waitFor(() => {
      expect(mockGetEquipmentRequests).toHaveBeenCalledWith({ mine_only: true });
      expect(mockGetReturnRequests).toHaveBeenCalledWith({ mine_only: true });
    });
  });

  // The request form itself moved to RequestEquipmentModal, which owns the
  // catalog browse, the size step and the payload — and is tested there. What
  // stays this page's responsibility is the wiring: the button opens it, and a
  // submitted request refreshes the panel that lists them.
  it('opens the request modal from the page action', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByRole('heading', { name: 'My Issued Gear' });

    await user.click(screen.getByRole('button', { name: /Request Equipment/ }));

    expect(await screen.findByRole('dialog', { name: 'Request Equipment' })).toBeInTheDocument();
    expect(screen.getByLabelText('What do you need?')).toBeInTheDocument();
  });

  it('shows the size a member asked for in their own request list', async () => {
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [
        {
          id: 'req-1',
          requester_id: 'me',
          item_name: 'Long Sleeve',
          quantity: 1,
          request_type: 'issuance',
          requested_duration: 'ongoing',
          requested_size: 'xxxl',
          priority: 'normal',
          status: 'pending',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        },
      ],
    });
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByRole('heading', { name: 'My Issued Gear' });

    await user.click(screen.getByRole('button', { name: /My Requests/ }));

    // Stored lowercase, shown the way the rest of the app writes it.
    expect(await screen.findByText(/Size 3XL/)).toBeInTheDocument();
  });
});
