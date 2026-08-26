import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryItem, UserInventoryResponse } from '../types';

const mockGetUserInventory = vi.fn();
const mockGetEquipmentRequests = vi.fn();
const mockGetReturnRequests = vi.fn();
const mockGetItems = vi.fn();
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

const availableItem: InventoryItem = {
  id: 'avail-1',
  organization_id: 'org-1',
  name: 'Spare Radio',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// Modal submit buttons can share a label with row action buttons; the modal
// renders last in the DOM.
const lastButton = (name: string | RegExp): HTMLElement => {
  const btns = screen.getAllByRole('button', { name });
  const btn = btns[btns.length - 1];
  if (!btn) throw new Error(`button not found: ${String(name)}`);
  return btn;
};

const firstButton = (name: string | RegExp): HTMLElement => {
  const [btn] = screen.getAllByRole('button', { name });
  if (!btn) throw new Error(`button not found: ${String(name)}`);
  return btn;
};

describe('MyEquipmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserInventory.mockResolvedValue(emptyInv);
    mockGetEquipmentRequests.mockResolvedValue({ requests: [] });
    mockGetReturnRequests.mockResolvedValue([]);
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
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
    expect(await screen.findByText('No permanent assignments.')).toBeInTheDocument();
    expect(screen.getByText('No active checkouts.')).toBeInTheDocument();
    expect(screen.getByText('No issued items.')).toBeInTheDocument();
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

  it('checks in an active checkout', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: 'Check In' }));
    await user.click(lastButton('Check In'));

    await waitFor(() => expect(mockCheckInItem).toHaveBeenCalledTimes(1));
    expect(mockCheckInItem.mock.calls[0]?.[0]).toBe('co-1');
    expect(mockToastSuccess).toHaveBeenCalledWith('Item checked in');
  });

  it('submits a return request for an assignment', async () => {
    mockGetUserInventory.mockResolvedValue(fullInv);
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByText('Turnout Coat');

    // The assignment row has the first "Request Return" button.
    await user.click(firstButton(/Request Return/));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(mockCreateReturnRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateReturnRequest.mock.calls[0]?.[0]).toMatchObject({
      return_type: 'assignment',
      item_id: 'it-1',
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

  // This branch replaces the request-type picker with a duration picker: the
  // member states how long they need the item and the quartermaster decides
  // how to fulfill it. #1876's parameterized request-type test goes with the
  // control it exercised — there is no request-type combobox on this form any
  // more — but its "no priority combobox" assertion is carried into the first
  // test below so #1875's removal still cannot be silently undone.
  it('submits a temporary duration intent after searching and selecting an item', async () => {
    mockGetItems.mockResolvedValue({ items: [availableItem], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByRole('heading', { name: 'My Issued Gear' });

    await user.click(screen.getByRole('button', { name: /Request Equipment/ }));
    expect(screen.getByLabelText('How long do you need it?')).toBeInTheDocument();
    expect(screen.getByText(/quartermaster will determine the final issue method/i)).toBeInTheDocument();
    // #1875 took the member's priority picker away; this branch must not bring
    // it back while replacing request_type with requested_duration.
    expect(screen.queryByRole('combobox', { name: /priority/i })).not.toBeInTheDocument();
    await user.type(await screen.findByPlaceholderText('Search available items...'), 'Radio');
    await user.click(await screen.findByRole('button', { name: /Spare Radio/ }));
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() => expect(mockCreateEquipmentRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateEquipmentRequest.mock.calls[0]?.[0]).toEqual({
      category_id: undefined,
      item_id: 'avail-1',
      item_name: 'Spare Radio',
      quantity: 1,
      reason: undefined,
      requested_duration: 'temporary',
    });
  });

  it('submits ongoing duration intent independently of fulfillment', async () => {
    mockGetItems.mockResolvedValue({ items: [availableItem], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<MyEquipmentPage />);
    await screen.findByRole('heading', { name: 'My Issued Gear' });

    await user.click(screen.getByRole('button', { name: /Request Equipment/ }));
    await user.selectOptions(screen.getByLabelText('How long do you need it?'), 'ongoing');
    await user.type(screen.getByPlaceholderText('Search available items...'), 'Radio');
    await user.click(await screen.findByRole('button', { name: /Spare Radio/ }));
    await user.click(screen.getByRole('button', { name: /Submit Request/ }));

    await waitFor(() =>
      expect(mockCreateEquipmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requested_duration: 'ongoing' })
      )
    );
  });
});
