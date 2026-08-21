import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftDetailPanel } from './ShiftDetailPanel';

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
