import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import InventoryMembersTab from './InventoryMembersTab';

// Mock the API service
const mockGetMembersSummary = vi.fn();
const mockGetUserInventory = vi.fn();

vi.mock('../services/api', () => ({
  inventoryService: {
    getMembersSummary: (...args: unknown[]) => mockGetMembersSummary(...args) as unknown,
    getUserInventory: (...args: unknown[]) => mockGetUserInventory(...args) as unknown,
  },
}));

// Mock the timezone hook
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Mock the date formatting
vi.mock('../utils/dateFormatting', () => ({
  formatDate: (date: string) => date,
}));

// Mock child modals (they have their own tests)
vi.mock('../components/InventoryScanModal', () => ({
  InventoryScanModal: () => null,
}));

vi.mock('../components/ReturnItemsModal', () => ({
  ReturnItemsModal: () => null,
}));

const mockMembers = [
  {
    user_id: 'u1',
    username: 'jdoe',
    full_name: 'John Doe',
    membership_number: '1001',
    total_items: 5,
    permanent_count: 3,
    checkout_count: 1,
    issued_count: 1,
    overdue_count: 0,
  },
  {
    user_id: 'u2',
    username: 'asmith',
    full_name: 'Alice Smith',
    membership_number: '1002',
    total_items: 2,
    permanent_count: 1,
    checkout_count: 1,
    issued_count: 0,
    overdue_count: 2,
  },
  {
    user_id: 'u3',
    username: 'bwilson',
    full_name: 'Bob Wilson',
    membership_number: '1003',
    total_items: 0,
    permanent_count: 0,
    checkout_count: 0,
    issued_count: 0,
    overdue_count: 0,
  },
];

function renderTab() {
  return render(
    <BrowserRouter>
      <InventoryMembersTab />
    </BrowserRouter>
  );
}

describe('InventoryMembersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembersSummary.mockResolvedValue({ members: mockMembers });
    mockGetUserInventory.mockResolvedValue({
      permanent_assignments: [],
      active_checkouts: [],
      issued_items: [],
    });
  });

  it('renders loading state initially', () => {
    // Don't resolve the promise yet
    mockGetMembersSummary.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(screen.getByText('Loading members...')).toBeInTheDocument();
  });

  it('renders member list after loading', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
  });

  it('displays stat labels', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    // Verify the stat labels are rendered
    expect(screen.getByText('Total Members')).toBeInTheDocument();
    expect(screen.getByText('With Equipment')).toBeInTheDocument();
    expect(screen.getByText('Overdue Returns')).toBeInTheDocument();
  });

  it('shows overdue badge for members with overdues', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('2 overdue')).toBeInTheDocument();
    });
  });

  it('sorts by name by default (A-Z)', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    const rows = screen.getAllByRole('row');
    // Header row + 3 member rows
    expect(rows.length).toBe(4);
    // Default sort is name A-Z: Alice, Bob, John
    const nameElements = rows.slice(1).map((row) => row.querySelector('td:nth-child(2)')?.textContent);
    expect(nameElements[0]).toContain('Alice Smith');
    expect(nameElements[1]).toContain('Bob Wilson');
    expect(nameElements[2]).toContain('John Doe');
  });

  it('sorts by overdue when selected', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const sortSelect = screen.getByDisplayValue('Name (A–Z)');
    fireEvent.change(sortSelect, { target: { value: 'overdue' } });

    const rows = screen.getAllByRole('row');
    const nameElements = rows.slice(1).map((row) => row.querySelector('td:nth-child(2)')?.textContent);
    // Alice (2 overdue) first, then John (5 total), then Bob (0 total)
    expect(nameElements[0]).toContain('Alice Smith');
    expect(nameElements[1]).toContain('John Doe');
    expect(nameElements[2]).toContain('Bob Wilson');
  });

  it('sorts by total items when selected', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const sortSelect = screen.getByDisplayValue('Name (A–Z)');
    fireEvent.change(sortSelect, { target: { value: 'total_items' } });

    const rows = screen.getAllByRole('row');
    const nameElements = rows.slice(1).map((row) => row.querySelector('td:nth-child(2)')?.textContent);
    // John (5) first, then Alice (2), then Bob (0)
    expect(nameElements[0]).toContain('John Doe');
    expect(nameElements[1]).toContain('Alice Smith');
    expect(nameElements[2]).toContain('Bob Wilson');
  });

  it('filters by search query', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search by name, username, or membership number...');
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    // The search triggers a debounced API call (300ms debounce)
    await waitFor(
      () => {
        expect(mockGetMembersSummary).toHaveBeenCalledWith('alice');
      },
      { timeout: 2000 },
    );
  });

  it('shows empty state when no members found', async () => {
    mockGetMembersSummary.mockResolvedValue({ members: [] });
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('No Members Found')).toBeInTheDocument();
    });
  });

  it('shows error state and retry button', async () => {
    mockGetMembersSummary.mockRejectedValue(new Error('Network error'));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
