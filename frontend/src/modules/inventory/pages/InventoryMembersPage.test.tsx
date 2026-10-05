import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { MemberInventorySummary, UserInventoryResponse } from '../../../services/eventServices';

const mockGetMembersSummary = vi.fn();
const mockGetUserInventory = vi.fn();
const mockGetMemberSizePreferences = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getMembersSummary: (...a: unknown[]) => mockGetMembersSummary(...a) as unknown,
    getUserInventory: (...a: unknown[]) => mockGetUserInventory(...a) as unknown,
    getMemberSizePreferences: (...a: unknown[]) => mockGetMemberSizePreferences(...a) as unknown,
    getMySizePreferences: vi.fn(),
    upsertMemberSizePreferences: vi.fn(),
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useInventoryWebSocket', () => ({ useInventoryWebSocket: () => undefined }));

// Stub heavy modal components (camera scanners pull in html5-qrcode).
vi.mock('../../../components/InventoryScanModal', () => ({ InventoryScanModal: () => null }));
vi.mock('../../../components/ReturnItemsModal', () => ({ ReturnItemsModal: () => null }));
vi.mock('../../../components/MemberIdScannerModal', () => ({ MemberIdScannerModal: () => null }));

import InventoryMembersPage from './InventoryMembersPage';

const makeMember = (overrides: Partial<MemberInventorySummary> = {}): MemberInventorySummary => ({
  user_id: 'u-1',
  username: 'jdoe',
  full_name: 'Jane Doe',
  membership_number: 'M-100',
  permanent_count: 2,
  checkout_count: 0,
  issued_count: 0,
  overdue_count: 0,
  total_items: 2,
  ...overrides,
});

const detail: UserInventoryResponse = {
  permanent_assignments: [
    {
      assignment_id: 'as-1',
      item_id: 'it-1',
      item_name: 'Helmet',
      condition: 'good',
      assigned_date: '2026-01-01T00:00:00Z',
    },
  ],
  active_checkouts: [],
  issued_items: [],
};

describe('InventoryMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembersSummary.mockResolvedValue({ members: [], total: 0 });
    mockGetUserInventory.mockResolvedValue(detail);
    mockGetMemberSizePreferences.mockResolvedValue({});
    mockCheckPermission.mockReturnValue(true);
    // BrowserRouter reads window.history, which persists across tests in this
    // file; a stray ?user= would leak into the next one.
    window.history.replaceState({}, '', '/inventory/admin/members');
  });

  it('shows the empty state when no members are returned', async () => {
    renderWithRouter(<InventoryMembersPage />);
    expect(await screen.findByText('No Members Found')).toBeInTheDocument();
  });

  it('shows an error banner with a retry action when loading fails', async () => {
    mockGetMembersSummary.mockRejectedValue(new Error('boom'));
    renderWithRouter(<InventoryMembersPage />);
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  // The empty state says "No members with inventory assignments", which is a
  // claim the failed load cannot support.
  it('does not claim an empty roster when loading fails', async () => {
    mockGetMembersSummary.mockRejectedValue(new Error('The member list response was not an array'));
    renderWithRouter(<InventoryMembersPage />);
    expect(await screen.findByText('The member list response was not an array')).toBeInTheDocument();
    expect(screen.queryByText('No Members Found')).not.toBeInTheDocument();
  });

  it('renders a member row', async () => {
    mockGetMembersSummary.mockResolvedValue({ members: [makeMember()], total: 1 });
    renderWithRouter(<InventoryMembersPage />);
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('#M-100')).toBeInTheDocument();
  });

  it('expands a member to load their inventory detail', async () => {
    mockGetMembersSummary.mockResolvedValue({ members: [makeMember()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Jane Doe');

    // The row is a button; the member name link is nested, so click the row text region.
    await user.click(screen.getByText('items'));
    await waitFor(() => expect(mockGetUserInventory).toHaveBeenCalledWith('u-1'));
    expect(await screen.findByText('Helmet')).toBeInTheDocument();
  });

  it('debounces search and refetches with the query', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('No Members Found');

    await user.type(screen.getByPlaceholderText(/Search by name/), 'Jane');
    await waitFor(() => expect(mockGetMembersSummary).toHaveBeenLastCalledWith('Jane', undefined));
  });

  it('asks for the member a clearance link names, active or not', async () => {
    // The list is active-members-only, and a departure clearance is created
    // after the drop has already made the member inactive — so without this
    // the hub's "Review" lands on a list the named member is not in.
    window.history.replaceState({}, '', '/inventory/admin/members?user=u-9');
    mockGetMembersSummary.mockResolvedValue({ members: [], total: 0 });

    renderWithRouter(<InventoryMembersPage />);

    await waitFor(() => expect(mockGetMembersSummary).toHaveBeenCalledWith(undefined, 'u-9'));
  });

  it('keeps asking for that member after the parameter is consumed', async () => {
    // useDeepLinkedRecord removes ?user= as soon as it resolves. Re-reading the
    // URL on each load would drop the departed member out from under the panel
    // the click had just expanded.
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/inventory/admin/members?user=u-9');
    mockGetMembersSummary.mockResolvedValue({
      members: [makeMember({ user_id: 'u-9', full_name: 'Sam Gone' })],
      total: 1,
    });

    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Sam Gone');
    await waitFor(() => expect(window.location.search).toBe(''));

    await user.type(screen.getByPlaceholderText(/Search by name/), 'Sam');

    await waitFor(() => expect(mockGetMembersSummary).toHaveBeenLastCalledWith('Sam', 'u-9'));
  });

  it('hides management actions without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetMembersSummary.mockResolvedValue({ members: [makeMember()], total: 1 });
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Jane Doe');

    expect(screen.queryByRole('button', { name: /Assign items to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scan Member ID/ })).not.toBeInTheDocument();
  });

  it('shows management actions with the manage permission', async () => {
    mockGetMembersSummary.mockResolvedValue({ members: [makeMember()], total: 1 });
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Jane Doe');

    expect(screen.getByRole('button', { name: 'Assign items to Jane Doe' })).toBeInTheDocument();
  });

  // Every row read "Assign", "Return", "Sizes": with 27 members a screen
  // reader heard 27 identical buttons and could not tell whose they were.
  it('names each row action after its member, and names the sort', async () => {
    mockGetMembersSummary.mockResolvedValue({
      members: [
        makeMember(),
        makeMember({ user_id: 'u-2', username: 'asmith', full_name: 'Al Smith', total_items: 0 }),
      ],
      total: 2,
    });
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Jane Doe');

    expect(screen.getByRole('button', { name: 'Assign items to Jane Doe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign items to Al Smith' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return items from Jane Doe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit sizes for Al Smith' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort members' })).toHaveValue('name');
  });
});
