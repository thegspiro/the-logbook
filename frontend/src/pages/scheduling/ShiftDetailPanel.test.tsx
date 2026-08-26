import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftDetailPanel } from './ShiftDetailPanel';
import { schedulingService } from '../../modules/scheduling/services/api';

const shift = {
  id: 'shift-1',
  organization_id: 'org-1',
  shift_date: '2020-01-01',
  start_time: '2020-01-01T08:00:00Z',
  end_time: '2020-01-01T16:00:00Z',
  status: 'scheduled',
  is_finalized: false,
  shift_officer_id: 'user-1',
  positions: [],
};

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShiftAssignments: vi.fn().mockResolvedValue([]),
    getShiftChecklists: vi.fn().mockResolvedValue([
      {
        templateId: 'end-check',
        templateName: 'End check',
        checkTiming: 'end_of_shift',
        // Exercise defensive frontend handling of stale/mismatched API data:
        // an incomplete draft can never become complete just because this flag
        // was true.
        isCompleted: true,
        overallStatus: 'incomplete',
        totalItems: 2,
        completedItems: 1,
        failedItems: 0,
      },
    ]),
    getMyAttendance: vi.fn().mockResolvedValue(null),
    getShiftAttendance: vi.fn().mockResolvedValue([]),
    getShift: vi.fn().mockResolvedValue(null),
    getShiftHandoff: vi.fn().mockResolvedValue(null),
    getEligiblePositions: vi.fn().mockResolvedValue({ positions: ['firefighter'], is_excluded: false }),
  },
}));

vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: () => ({
    apparatus: [],
    loadApparatus: vi.fn(),
    members: [],
    loadMembers: vi.fn(),
    platoonsEnabled: false,
    requireEndOfShiftChecks: true,
    callTrackingMode: 'incidents',
    loadSettings: vi.fn(),
  }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1' },
    checkPermission: () => true,
  }),
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOverlaySurface', () => ({ useOverlaySurface: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('ShiftDetailPanel close-out equipment checks', () => {
  it('keeps an incomplete end-of-shift draft outstanding and close-out disabled', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftDetailPanel shift={shift as never} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Close out shift' }));

    expect(screen.getByText(/1 end-of-shift checklist still pending/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close out shift' })).toBeDisabled();
  });
});

/**
 * The crew board offers a seat only when the member can actually take it.
 *
 * Before this, every open seat carried a "Sign myself up" button and the
 * signup endpoint answered 403 — the button was an invitation the server
 * could only refuse.
 */
describe('ShiftDetailPanel crew board signup gating', () => {
  const crewShift = {
    ...shift,
    // Far future so the panel does not treat this as a past shift, which
    // suppresses every signup button on its own and would hide the defect.
    shift_date: '2099-01-01',
    start_time: '2099-01-01T08:00:00Z',
    end_time: '2099-01-01T16:00:00Z',
    apparatus_positions: [
      { position: 'driver', required: true },
      { position: 'ems', required: true },
    ],
  };

  const mockEligibility = vi.mocked(schedulingService.getEligiblePositions);

  beforeEach(() => {
    mockEligibility.mockReset();
  });

  it('offers only the seat the member is cleared for', async () => {
    mockEligibility.mockResolvedValue({ positions: ['ems'], is_excluded: false });

    renderWithRouter(<ShiftDetailPanel shift={crewShift as never} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Sign myself up as EMT' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign myself up as Driver/Operator' })).not.toBeInTheDocument();
  });

  it('says why when no open seat is theirs to take', async () => {
    mockEligibility.mockResolvedValue({ positions: [], is_excluded: false });

    renderWithRouter(<ShiftDetailPanel shift={crewShift as never} onClose={vi.fn()} />);

    expect(await screen.findByText(/None of the open seats on this shift match/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign myself up/ })).not.toBeInTheDocument();
  });

  it('still offers the seats when the eligibility lookup fails', async () => {
    // Fail open on the affordance: the endpoint is the real gate, and taking
    // self-signup away from everyone over a network blip is the worse outcome.
    mockEligibility.mockRejectedValue(new Error('network down'));

    renderWithRouter(<ShiftDetailPanel shift={crewShift as never} onClose={vi.fn()} />);

    expect(await screen.findAllByRole('button', { name: /Sign myself up/ })).toHaveLength(2);
    expect(screen.queryByText(/None of the open seats on this shift match/)).not.toBeInTheDocument();
  });
});
