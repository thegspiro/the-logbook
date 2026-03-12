import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberIdScannerModal } from './MemberIdScannerModal';

// Mock html5-qrcode
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn().mockImplementation(function () {
    return { start: mockStart, stop: mockStop };
  }),
}));

// Mock the API module
const mockGetMembersSummary = vi.fn().mockResolvedValue({
  members: [
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
      permanent_count: 1,
      checkout_count: 0,
      issued_count: 2,
      overdue_count: 0,
      total_items: 3,
    },
  ],
  total: 2,
});

vi.mock('../services/api', () => ({
  inventoryService: {
    getMembersSummary: (...args: unknown[]) => mockGetMembersSummary(...args) as unknown,
  },
}));

describe('MemberIdScannerModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onMemberIdentified: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when closed', () => {
    render(
      <MemberIdScannerModal
        isOpen={false}
        onClose={defaultProps.onClose}
        onMemberIdentified={defaultProps.onMemberIdentified}
      />,
    );

    expect(screen.queryByText('Scan Member ID')).not.toBeInTheDocument();
  });

  it('should render the modal title when open', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(screen.getByText('Scan Member ID')).toBeInTheDocument();
  });

  it('should show the scanner viewport', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(screen.getByTestId('member-scanner-viewport')).toBeInTheDocument();
  });

  it('should display instruction text', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(
      screen.getByText(/Point the camera at a member/),
    ).toBeInTheDocument();
  });

  it('should have a close button', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: /close scanner/i }),
    ).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<MemberIdScannerModal {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /close scanner/i }));

    expect(defaultProps.onClose).toHaveBeenCalledWith();
  });

  it('should auto-start the scanner when opened', async () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    // The start is delayed by 100ms via setTimeout in the component
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith();
    });
  });
});
