import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type {
  MemberInventorySummary,
  UserInventoryResponse,
} from '../../../services/eventServices';

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
    await waitFor(() => expect(mockGetMembersSummary).toHaveBeenLastCalledWith('Jane'));
  });

  it('hides management actions without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetMembersSummary.mockResolvedValue({ members: [makeMember()], total: 1 });
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Jane Doe');

    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scan Member ID/ })).not.toBeInTheDocument();
  });

  it('shows management actions with the manage permission', async () => {
    mockGetMembersSummary.mockResolvedValue({ members: [makeMember()], total: 1 });
    renderWithRouter(<InventoryMembersPage />);
    await screen.findByText('Jane Doe');

    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });
});
