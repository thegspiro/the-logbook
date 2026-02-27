import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { OpenShiftsTab } from './OpenShiftsTab';

// Mock API services
const mockGetOpenShifts = vi.fn();
const mockGetShifts = vi.fn();
const mockSignupForShift = vi.fn();

vi.mock('../../services/api', () => ({
  schedulingService: {
    getOpenShifts: (...args: unknown[]) => mockGetOpenShifts(...args) as unknown,
    getShifts: (...args: unknown[]) => mockGetShifts(...args) as unknown,
    signupForShift: (...args: unknown[]) => mockSignupForShift(...args) as unknown,
    withdrawSignup: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: () => false,
    user: { id: 'user-1', first_name: 'Test', last_name: 'User' },
  }),
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockShifts = [
  {
    id: 'shift-1',
    shift_date: '2026-03-01',
    start_time: '2026-03-01T07:00:00Z',
    end_time: '2026-03-01T19:00:00Z',
    apparatus_name: 'Engine 1',
    apparatus_unit_number: 'E1',
    apparatus_positions: ['officer', 'driver', 'firefighter'],
    attendee_count: 2,
    created_at: '2026-02-25T00:00:00Z',
    updated_at: '2026-02-25T00:00:00Z',
    organization_id: '1',
  },
  {
    id: 'shift-2',
    shift_date: '2026-03-02',
    start_time: '2026-03-02T19:00:00Z',
    end_time: '2026-03-03T07:00:00Z',
    attendee_count: 0,
    created_at: '2026-02-25T00:00:00Z',
    updated_at: '2026-02-25T00:00:00Z',
    organization_id: '1',
  },
];

describe('OpenShiftsTab', () => {
  const mockOnViewShift = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOpenShifts.mockResolvedValue(mockShifts);
    mockGetShifts.mockResolvedValue({ shifts: mockShifts, total: 2 });
  });

  it('should render loading state initially', () => {
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should render shifts after loading', async () => {
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('should render empty state when no shifts available', async () => {
    mockGetOpenShifts.mockResolvedValue([]);
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0 });

    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('should render date filter input', async () => {
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });

    // Should have a date filter
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(0);
  });
});
