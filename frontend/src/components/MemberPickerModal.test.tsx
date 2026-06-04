import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberPickerModal } from './MemberPickerModal';

const mockGetMembersSummary = vi.fn();

vi.mock('../services/api', () => ({
  inventoryService: {
    getMembersSummary: (...args: unknown[]) => mockGetMembersSummary(...args) as unknown,
  },
}));

// Stub the camera scanner so the picker can be tested without html5-qrcode.
vi.mock('./MemberIdScannerModal', () => ({
  MemberIdScannerModal: ({ isOpen, onMemberIdentified }: {
    isOpen: boolean;
    onMemberIdentified: (m: { userId: string; memberName: string }) => void;
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() => onMemberIdentified({ userId: 'scanned-9', memberName: 'Scanned Member' })}
      >
        simulate-scan
      </button>
    ) : null,
}));

const members = [
  {
    user_id: 'user-1',
    username: 'jsmith',
    first_name: 'John',
    last_name: 'Smith',
    full_name: 'John Smith',
    membership_number: 'M-001',
    permanent_count: 3,
    checkout_count: 1,
    issued_count: 0,
    overdue_count: 0,
    total_items: 4,
  },
  {
    user_id: 'user-2',
    username: 'jdoe',
    first_name: 'Jane',
    last_name: 'Doe',
    full_name: 'Jane Doe',
    membership_number: 'M-002',
    permanent_count: 0,
    checkout_count: 0,
    issued_count: 0,
    overdue_count: 0,
    total_items: 0,
  },
];

describe('MemberPickerModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMembersSummary.mockResolvedValue({ members, total: members.length });
  });

  it('does not render when closed', () => {
    render(<MemberPickerModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
    expect(mockGetMembersSummary).not.toHaveBeenCalled();
  });

  it('loads and lists members when opened', async () => {
    render(<MemberPickerModal {...defaultProps} />);
    // The rendered roster confirms getMembersSummary was called and resolved.
    expect(await screen.findByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('filters members by search query', async () => {
    render(<MemberPickerModal {...defaultProps} />);
    expect(await screen.findByText('John Smith')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search members'), 'jane');

    await waitFor(() => expect(screen.queryByText('John Smith')).not.toBeInTheDocument());
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen member', async () => {
    const onSelect = vi.fn();
    render(<MemberPickerModal {...defaultProps} onSelect={onSelect} />);
    await userEvent.click(await screen.findByText('John Smith'));

    expect(onSelect).toHaveBeenCalledWith({ userId: 'user-1', memberName: 'John Smith' });
  });

  it('selects the highlighted member with the keyboard', async () => {
    const onSelect = vi.fn();
    render(<MemberPickerModal {...defaultProps} onSelect={onSelect} />);
    await screen.findByText('John Smith');

    const input = screen.getByLabelText('Search members');
    input.focus();
    // List is sorted alphabetically: Jane Doe, John Smith.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith({ userId: 'user-1', memberName: 'John Smith' });
  });

  it('selects a member identified by the ID scanner', async () => {
    const onSelect = vi.fn();
    render(<MemberPickerModal {...defaultProps} onSelect={onSelect} />);
    await screen.findByText('John Smith');

    await userEvent.click(screen.getByTitle("Scan a member's digital ID card"));
    await userEvent.click(await screen.findByText('simulate-scan'));

    expect(onSelect).toHaveBeenCalledWith({ userId: 'scanned-9', memberName: 'Scanned Member' });
  });

  it('shows an error message when loading fails', async () => {
    mockGetMembersSummary.mockRejectedValue(new Error('Server unreachable'));
    render(<MemberPickerModal {...defaultProps} />);
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
  });
});
