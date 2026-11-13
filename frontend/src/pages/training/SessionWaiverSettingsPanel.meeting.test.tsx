import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverPolicy } from '../../types/attendanceWaiver';

const { meeting, training } = vi.hoisted(() => ({
  meeting: { getPolicy: vi.fn(), savePolicy: vi.fn(), getPositions: vi.fn(), getAlternateOptions: vi.fn() },
  training: { getPolicy: vi.fn(), savePolicy: vi.fn(), getPositions: vi.fn(), getAlternateOptions: vi.fn() },
}));
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: training,
  meetingWaiverService: meeting,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import SessionWaiverSettingsPanel from './SessionWaiverSettingsPanel';
import { MEETING_WAIVER_WORKFLOW } from '../../utils/attendanceWaiverWorkflows';

const policy: AttendanceWaiverPolicy = {
  enabled: true,
  deadline: 'before_start',
  cap: null,
  cap_period: 'calendar_year',
  categories: [],
  category_required: false,
  reason_text: 'optional',
  attachment: 'off',
  attachment_retention_days: 365,
  approver_position_ids: [],
  cc_position_ids: [],
  chief_alternate_user_id: null,
};

const render = () => renderWithRouter(<SessionWaiverSettingsPanel workflow={MEETING_WAIVER_WORKFLOW} />);

describe('SessionWaiverSettingsPanel on the meeting workflow', () => {
  beforeEach(() => {
    Object.values(meeting).forEach((m) => m.mockReset());
    Object.values(training).forEach((m) => m.mockReset());
    meeting.getPolicy.mockResolvedValue(policy);
    meeting.savePolicy.mockImplementation(async (p: AttendanceWaiverPolicy) => p);
    meeting.getPositions.mockResolvedValue([{ id: 'pos-sec', name: 'Secretary' }]);
    meeting.getAlternateOptions.mockResolvedValue({ members: [], alternate: null });
  });

  it('reads the meeting policy and positions, and never touches the training API', async () => {
    render();
    expect(await screen.findByText('Meeting waiver requests')).toBeInTheDocument();
    expect(meeting.getPositions).toHaveBeenCalled();
    expect(training.getPolicy).not.toHaveBeenCalled();
    expect(training.getPositions).not.toHaveBeenCalled();
  });

  it('names the meeting fallback and offers no documents', async () => {
    render();
    expect(await screen.findByText(/requests go to the Secretary, and failing a Secretary/)).toBeInTheDocument();
    expect(screen.queryByText('Supporting documents')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Keep documents for/)).not.toBeInTheDocument();
  });

  it('saves through the meeting API', async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByLabelText(/Members may ask to be excused/));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(meeting.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(training.savePolicy).not.toHaveBeenCalled();
  });
});
