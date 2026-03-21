import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      expect(mockGetWriteOffRequests).toHaveBeenCalled();
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
      expect(screen.getByText('Review Notes (optional)')).toBeInTheDocument();
    });
    // "Reason: fire_damage" appears in both the list card and the modal
    expect(screen.getAllByText(/Reason: fire_damage/).length).toBeGreaterThanOrEqual(1);
  });

  it('approves a write-off', async () => {
    const user = userEvent.setup();
    mockReviewWriteOff.mockResolvedValue({});
    renderWithRouter(<WriteOffsPage />);
    await waitFor(() => {
      expect(screen.getByText('Damaged Helmet')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Review'));
    await user.click(await screen.findByText('Approve'));
    await waitFor(() => {
      expect(mockReviewWriteOff).toHaveBeenCalledWith('wo-1', {
        status: 'approved',
        review_notes: undefined,
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
    const notesField = await screen.findByPlaceholderText('Optional notes...');
    await user.type(notesField, 'Needs more documentation');
    await user.click(screen.getByText('Deny'));
    await waitFor(() => {
      expect(mockReviewWriteOff).toHaveBeenCalledWith('wo-1', {
        status: 'denied',
        review_notes: 'Needs more documentation',
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Write-off denied');
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
      expect(mockToastError).toHaveBeenCalled();
    });
  });
});
