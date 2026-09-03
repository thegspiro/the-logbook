import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetWriteOffRequests = vi.fn();
const mockReviewWriteOff = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getWriteOffRequests: (...args: unknown[]) => mockGetWriteOffRequests(...args) as unknown,
    reviewWriteOff: (...args: unknown[]) => mockReviewWriteOff(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import WriteOffsPage from './WriteOffsPage';

const makeWriteOff = (overrides: Record<string, unknown> = {}) => ({
  id: 'wo-1',
  item_name: 'Damaged Helmet',
  status: 'pending',
  reason: 'fire_damage',
  requester_name: 'Jane Smith',
  description: 'Cracked shell from incident',
  item_serial_number: 'SN-12345',
  item_asset_tag: 'AT-001',
  item_value: 450.0,
  current_status: 'available',
  current_holder: undefined,
  replacement_value: 625,
  active_assignment_count: 0,
  active_checkout_count: 0,
  active_issuance_count: 0,
  acknowledgement_required: false,
  acknowledgement_threshold: 1000,
  holder_signature: 'none',
  review_notes: '',
  created_at: '2026-02-10T10:00:00Z',
  ...overrides,
});

describe('WriteOffsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWriteOffRequests.mockResolvedValue([makeWriteOff()]);
  });

  it('renders page title and back link', async () => {
    renderWithRouter(<WriteOffsPage />);
    expect(screen.getByText('Write-Off Requests')).toBeInTheDocument();
    expect(screen.getByText('Process loss and damage write-off requests')).toBeInTheDocument();
    const backLink = screen.getByRole('link', { name: /Back to Admin/ });
    expect(backLink).toHaveAttribute('href', '/inventory/admin');
    await waitFor(() => {
      expect(mockGetWriteOffRequests).toHaveBeenCalledWith({ status: 'pending' });
    });
  });

  it('loads and displays write-off requests', async () => {
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('Damaged Helmet')).toBeInTheDocument();
    });
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText(/Jane Smith/)).toBeInTheDocument();
    expect(screen.getByText('Cracked shell from incident')).toBeInTheDocument();
    expect(screen.getByText(/SN-12345/)).toBeInTheDocument();
    expect(screen.getByText(/AT-001/)).toBeInTheDocument();
    expect(screen.getByText(/\$450\.00/)).toBeInTheDocument();
  });

  it('shows empty state when no write-offs', async () => {
    mockGetWriteOffRequests.mockResolvedValue([]);
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('No Write-Offs')).toBeInTheDocument();
    });
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(mockGetWriteOffRequests).toHaveBeenCalledWith({ status: 'pending' });
    });
    const select = screen.getByLabelText('Filter by status');
    await user.selectOptions(select, 'approved');
    await waitFor(() => {
      expect(mockGetWriteOffRequests).toHaveBeenCalledWith({ status: 'approved' });
    });
  });

  it('opens review modal on Review button click', async () => {
    const user = userEvent.setup();
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('Damaged Helmet')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    await waitFor(() => {
      expect(screen.getByText(/Review note/)).toBeInTheDocument();
    });
    // "Reason: fire_damage" appears in both the list card and the modal
    expect(screen.getAllByText(/Reason: fire_damage/).length).toBeGreaterThanOrEqual(1);
  });

  it('approves an ordinary retirement with a required note', async () => {
    const user = userEvent.setup();
    mockReviewWriteOff.mockResolvedValue({});
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('Damaged Helmet')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    await user.type(await screen.findByPlaceholderText('Document the reason for this decision...'), 'Reviewed damage');
    await user.click(await screen.findByText('Approve and retire item'));
    await waitFor(() => {
      expect(mockReviewWriteOff).toHaveBeenCalledWith('wo-1', {
        status: 'approved',
        review_notes: 'Reviewed damage',
        acknowledgement: false,
        expected_item_status: 'available',
        expected_holder_signature: 'none',
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Write-off approved');
  });

  it('denies a write-off with notes', async () => {
    const user = userEvent.setup();
    mockReviewWriteOff.mockResolvedValue({});
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('Damaged Helmet')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    const notesField = await screen.findByPlaceholderText('Document the reason for this decision...');
    await user.type(notesField, 'Needs more documentation');
    await user.click(screen.getByText('Deny'));
    await waitFor(() => {
      expect(mockReviewWriteOff).toHaveBeenCalledWith('wo-1', {
        status: 'denied',
        review_notes: 'Needs more documentation',
        acknowledgement: false,
        expected_item_status: 'available',
        expected_holder_signature: 'none',
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Write-off denied');
  });

  it('requires acknowledgement for a held item and describes records that close', async () => {
    const user = userEvent.setup();
    mockGetWriteOffRequests.mockResolvedValue([
      makeWriteOff({
        reason: 'lost',
        current_holder: 'Alex Member',
        current_status: 'assigned',
        active_assignment_count: 1,
        acknowledgement_required: true,
        holder_signature: 'member-1:a1',
      }),
    ]);
    renderWithRouter(<WriteOffsPage />);
    await user.click(await screen.findByText('Review'));
    expect(screen.getByText('Alex Member')).toBeInTheDocument();
    expect(screen.getByText(/close 1 active assignment/)).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve and mark lost' });
    await user.type(screen.getByPlaceholderText('Document the reason for this decision...'), 'Confirmed loss');
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(approve).toBeEnabled();
  });

  it('labels stolen approval according to the resulting status', async () => {
    const user = userEvent.setup();
    mockGetWriteOffRequests.mockResolvedValue([makeWriteOff({ reason: 'stolen' })]);
    renderWithRouter(<WriteOffsPage />);
    await user.click(await screen.findByText('Review'));
    expect(screen.getByRole('button', { name: 'Approve and mark stolen' })).toBeInTheDocument();
  });

  it('does not show Review for non-pending write-offs', async () => {
    mockGetWriteOffRequests.mockResolvedValue([makeWriteOff({ status: 'approved' })]);
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('Damaged Helmet')).toBeInTheDocument();
    });
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });

  it('handles API error on load', async () => {
    mockGetWriteOffRequests.mockRejectedValue(new Error('Failed'));
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.any(String));
    });
  });
});

/**
 * Arriving from the inventory hub's "Needs attention" queue.
 *
 * Its own block with its own resets: `vi.clearAllMocks()` clears calls but not
 * implementations, so a block that configures nothing inherits its neighbour's
 * (CLAUDE.md #28).
 */
describe('WriteOffsPage — opened from the attention queue', () => {
  beforeEach(() => {
    mockGetWriteOffRequests.mockReset();
    mockGetWriteOffRequests.mockResolvedValue([makeWriteOff()]);
    mockReviewWriteOff.mockReset();
    mockReviewWriteOff.mockResolvedValue({});
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('opens the review dialog for the write-off the link names', async () => {
    window.history.pushState({}, '', '/inventory/admin/write-offs?request=wo-1');
    renderWithRouter(<WriteOffsPage />);

    expect(await screen.findByText('Review Write-Off: Damaged Helmet')).toBeInTheDocument();
  });

  it('leaves the list alone when the write-off has already been resolved', async () => {
    // Somebody else may have decided it between the queue rendering and the
    // click; a working page beats an error about work nobody still owes.
    window.history.pushState({}, '', '/inventory/admin/write-offs?request=gone');
    renderWithRouter(<WriteOffsPage />);
    await screen.findByText('Damaged Helmet');

    expect(screen.queryByText(/Review Write-Off:/)).not.toBeInTheDocument();
  });
});
