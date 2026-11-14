import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverEligibility } from '../../types/attendanceWaiver';

const mockEligibility = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    getEligibility: (...args: unknown[]) => mockEligibility(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AttendanceWaiverCard from './AttendanceWaiverCard';

const REFUSAL =
  'No one can decide this request: your department has no President and no alternate is named in the waiver ' +
  'settings. Ask an officer to name one.';

const refusal: AttendanceWaiverEligibility = {
  event_id: 'evt-1',
  allowed: false,
  refusal_code: 'no_decider',
  refusal: REFUSAL,
  deadline: '2026-11-20T23:00:00Z',
  deadline_preset: 'before_start',
  session_date: '2026-11-20',
  cap: null,
  cap_period: 'calendar_year',
  cap_used: null,
  cap_remaining: null,
  categories: [],
  category_required: false,
  reason_text: 'optional',
  existing_request_id: null,
  existing_request_status: null,
};

describe('AttendanceWaiverCard — nobody to decide', () => {
  beforeEach(() => {
    mockEligibility.mockReset();
    mockEligibility.mockResolvedValue(refusal);
  });

  it('tells the Chief why they cannot ask, in the server’s words, and offers no button', async () => {
    renderWithRouter(<AttendanceWaiverCard eventId="evt-1" eventTitle="Ladder Drill" timezone="UTC" />);
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request to be excused/ })).not.toBeInTheDocument();
  });
});
