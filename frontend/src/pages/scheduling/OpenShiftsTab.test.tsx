import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { OpenShiftsTab } from './OpenShiftsTab';

// Mock API services
const mockGetOpenShifts = vi.fn();
const mockGetShifts = vi.fn();
const mockSignupForShift = vi.fn();
const mockGetEligiblePositions = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getOpenShifts: (...args: unknown[]) => mockGetOpenShifts(...args) as unknown,
    getShifts: (...args: unknown[]) => mockGetShifts(...args) as unknown,
    signupForShift: (...args: unknown[]) => mockSignupForShift(...args) as unknown,
    withdrawSignup: vi.fn().mockResolvedValue(undefined),
    getEligiblePositions: (...args: unknown[]) => mockGetEligiblePositions(...args) as unknown,
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
    mockGetEligiblePositions.mockResolvedValue({ positions: [], is_excluded: false });
    mockSignupForShift.mockResolvedValue({});
  });

  it('should render the filter bar and info section', () => {
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    expect(screen.getByText(/Browse available shifts/)).toBeInTheDocument();
  });

  it('should render shifts after loading', async () => {
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(mockGetOpenShifts).toHaveBeenCalledWith(expect.anything());
    });
    // After loading, the Refresh button remains visible
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('should render empty state when no shifts available', async () => {
    mockGetOpenShifts.mockResolvedValue([]);
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0 });

    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(screen.getByText('No open shifts available')).toBeInTheDocument();
    });
  });

  it('should render date filter input', async () => {
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);

    // The date filter label "From:" is always visible
    expect(screen.getByText('From:')).toBeInTheDocument();
  });

  it('gives the date filter an explicit desktop width', () => {
    // `form-input` is w-full. Pinned with `sm:flex-none` and no width of its
    // own, that resolved against the whole row rather than the space left
    // beside the filter icon and the "From:" label — the field overflowed by
    // exactly their width and painted over the Refresh button. jsdom has no
    // layout, so the guard is on the declaration that caused it.
    renderWithRouter(<OpenShiftsTab onViewShift={mockOnViewShift} />);
    const input = screen.getByLabelText('Filter open shifts from date');
    expect(input.className).toMatch(/sm:w-\S+/);
  });

  it('submits the only non-firefighter position a member is eligible for', async () => {
    const user = userEvent.setup();
    mockGetEligiblePositions.mockImplementation((shiftId?: string) =>
      Promise.resolve({ positions: shiftId === 'shift-1' ? ['driver'] : [], is_excluded: false })
    );
    renderWithRouter(<OpenShiftsTab />);

    const signupButtons = await screen.findAllByLabelText('Sign up for this shift');
    await user.click(signupButtons[0]);

    const position = await screen.findByLabelText('Position');
    expect(position).toHaveValue('driver');
    expect(screen.getByRole('option', { name: 'Driver/Operator' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm Sign Up' }));

    await waitFor(() => {
      expect(mockSignupForShift).toHaveBeenCalledWith('shift-1', { position: 'driver' });
    });
  });

  it('resets the selected position when opening shifts with disjoint eligible positions', async () => {
    const user = userEvent.setup();
    mockGetEligiblePositions.mockImplementation((shiftId?: string) => {
      const positions = shiftId === 'shift-1' ? ['driver'] : shiftId === 'shift-2' ? ['officer'] : [];
      return Promise.resolve({ positions, is_excluded: false });
    });
    renderWithRouter(<OpenShiftsTab />);

    const signupButtons = await screen.findAllByLabelText('Sign up for this shift');
    await user.click(signupButtons[0]);
    expect(await screen.findByRole('option', { name: 'Driver/Operator' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(signupButtons[1]);
    const visibleOption = await screen.findByRole('option', { name: 'Officer' });
    expect(visibleOption).toBeVisible();
    expect(screen.getByLabelText('Position')).toHaveValue('officer');
    await user.click(screen.getByRole('button', { name: 'Confirm Sign Up' }));

    await waitFor(() => {
      expect(mockSignupForShift).toHaveBeenCalledWith('shift-2', { position: 'officer' });
    });
  });

  // ==========================================================================
  // Community outreach sheets ask for a role, not a riding position
  // ==========================================================================
  describe('outreach signup sheets', () => {
    const outreachShift = {
      id: 'shift-outreach',
      shift_date: '2026-03-05',
      start_time: '2026-03-05T14:00:00Z',
      end_time: '2026-03-05T16:00:00Z',
      attendee_count: 0,
      is_outreach: true,
      outreach_roles: [
        { role: 'tour_guide', label: 'Tour Guide', total: 2, filled: 2, remaining: 0 },
        { role: 'educator', label: 'Educator', total: 2, filled: 0, remaining: 2 },
      ],
      created_at: '2026-02-25T00:00:00Z',
      updated_at: '2026-02-25T00:00:00Z',
      organization_id: '1',
    };

    beforeEach(() => {
      mockGetOpenShifts.mockResolvedValue([outreachShift]);
      mockGetEligiblePositions.mockResolvedValue({ positions: ['volunteer'], is_excluded: false });
    });

    it('asks what the member will do instead of which seat they will ride', async () => {
      const user = userEvent.setup();
      renderWithRouter(<OpenShiftsTab />);

      const signupButtons = await screen.findAllByLabelText('Sign up for this shift');
      await user.click(signupButtons[0]);

      expect(await screen.findByLabelText('What would you like to do?')).toBeInTheDocument();
      // The crew-position picker has no business on a school visit.
      expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
    });

    it('offers only roles that still have a seat', async () => {
      const user = userEvent.setup();
      renderWithRouter(<OpenShiftsTab />);

      const signupButtons = await screen.findAllByLabelText('Sign up for this shift');
      await user.click(signupButtons[0]);

      await screen.findByLabelText('What would you like to do?');
      expect(screen.getByRole('option', { name: 'Educator (2 needed)' })).toBeVisible();
      expect(screen.queryByRole('option', { name: /Tour Guide/ })).not.toBeInTheDocument();
    });

    it('sends the chosen role with the signup', async () => {
      const user = userEvent.setup();
      renderWithRouter(<OpenShiftsTab />);

      const signupButtons = await screen.findAllByLabelText('Sign up for this shift');
      await user.click(signupButtons[0]);

      await screen.findByLabelText('What would you like to do?');
      await user.click(screen.getByRole('button', { name: 'Confirm Sign Up' }));

      await waitFor(() => {
        expect(mockSignupForShift).toHaveBeenCalledWith('shift-outreach', {
          position: 'volunteer',
          outreach_role: 'educator',
        });
      });
    });

    it('falls back to the position picker when every role is taken', async () => {
      // A fully staffed sheet has no role to offer; the shift is still an
      // ordinary open shift and must not render an empty picker.
      const user = userEvent.setup();
      mockGetOpenShifts.mockResolvedValue([
        {
          ...outreachShift,
          outreach_roles: [{ role: 'educator', label: 'Educator', total: 1, filled: 1, remaining: 0 }],
        },
      ]);
      renderWithRouter(<OpenShiftsTab />);

      const signupButtons = await screen.findAllByLabelText('Sign up for this shift');
      await user.click(signupButtons[0]);

      expect(await screen.findByLabelText('Position')).toBeInTheDocument();
      expect(screen.queryByLabelText('What would you like to do?')).not.toBeInTheDocument();
    });
  });
});
