/**
 * Elections › Meeting Attendance: each member's count over the period chosen,
 * the election's own answer on whether they may vote, and one member's
 * meetings with who recorded each.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ElectionAttendance, ElectionListItem, MemberMeetings } from '../types/election';
import { getTodayLocalDate } from '../utils/dateFormatting';
import { monthsBefore } from '../modules/elections/attendancePeriod';

const mockGetElections = vi.fn();
const mockGetAttendance = vi.fn();
const mockGetMemberMeetings = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    getElectionAttendance: (...a: unknown[]) => mockGetAttendance(...a) as unknown,
    getMemberMeetings: (...a: unknown[]) => mockGetMemberMeetings(...a) as unknown,
  },
}));

import ElectionAttendancePage from './ElectionAttendancePage';

const election = (id: string, status: ElectionListItem['status'], title: string): ElectionListItem => ({
  id,
  title,
  status,
  election_type: 'general',
  start_date: '2026-12-01T18:00:00Z',
  end_date: '2026-12-01T21:00:00Z',
  runoff_round: 0,
});

const ELECTIONS = [
  election('closed-1', 'closed', 'Officers 2026'),
  election('draft-1', 'draft', 'Officers 2027'),
  election('cancelled-1', 'cancelled', 'Withdrawn vote'),
];

const attendance = (electionId: string): ElectionAttendance => ({
  election_id: electionId,
  election_title: 'Officers 2027',
  start: '2025-11-13',
  end: '2026-11-13',
  meeting_types: null,
  total_meetings: 4,
  members: [
    {
      user_id: 'u-steady',
      name: 'Sam Steady',
      member_type: 'Regular',
      member_since: '2010-01-01',
      meetings_in_period: 4,
      attended: 3,
      absent: 1,
      excused: 0,
      on_leave: 0,
      attendance_pct: 75,
      may_vote: true,
      reason: null,
    },
    {
      user_id: 'u-lapsed',
      name: 'Lee Lapsed',
      member_type: 'Regular',
      member_since: '2010-01-01',
      meetings_in_period: 4,
      attended: 1,
      absent: 1,
      excused: 1,
      on_leave: 1,
      attendance_pct: 50,
      may_vote: false,
      reason: 'Attended 1 of the last 3 meetings; 2 required',
    },
  ],
});

const LAPSED_MEETINGS: MemberMeetings = {
  user_id: 'u-lapsed',
  name: 'Lee Lapsed',
  start: '2025-11-13',
  end: '2026-11-13',
  meetings: [
    {
      meeting_id: 'm-oct',
      title: 'October business meeting',
      meeting_type: 'business',
      meeting_date: '2026-10-13',
      status: 'present',
      checked_in_at: '2026-10-13T23:02:00Z',
      recorded_by_name: 'Pat Secretary',
      recorded_via: 'event_check_in',
    },
    {
      meeting_id: 'm-sep',
      title: 'September business meeting',
      meeting_type: 'business',
      meeting_date: '2026-09-13',
      status: 'excused',
      recorded_via: 'waiver',
      waiver_reason: 'Work shift',
    },
    {
      meeting_id: 'm-aug',
      title: 'August business meeting',
      meeting_type: 'business',
      meeting_date: '2026-08-13',
      status: 'on_leave',
      leave_start: '2026-08-01',
      leave_end: '2026-08-31',
    },
  ],
};

const lastQuery = () => {
  const calls = mockGetAttendance.mock.calls;
  return calls[calls.length - 1] as [string, Record<string, unknown>] | undefined;
};

describe('ElectionAttendancePage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/elections/attendance');
    mockGetElections.mockReset();
    mockGetAttendance.mockReset();
    mockGetMemberMeetings.mockReset();
    mockGetElections.mockResolvedValue(ELECTIONS);
    mockGetAttendance.mockImplementation((id: string) => Promise.resolve(attendance(id)));
    mockGetMemberMeetings.mockResolvedValue(LAPSED_MEETINGS);
  });

  it('opens on the election still being decided, over the last 12 months', async () => {
    renderWithRouter(<ElectionAttendancePage />);
    await screen.findByText('Sam Steady');

    const today = getTodayLocalDate(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(lastQuery()).toEqual(['draft-1', { start: monthsBefore(today, 12), end: today }]);
    expect(screen.getByLabelText('Election')).toHaveValue('draft-1');
    // A cancelled election has no voters to decide.
    expect(screen.queryByRole('option', { name: 'Withdrawn vote' })).not.toBeInTheDocument();
    expect(screen.getByTestId('attendance-total-meetings')).toHaveTextContent('4');
    expect(screen.getByTestId('attendance-may-vote')).toHaveTextContent('1 of 2');

    const row = within(screen.getByRole('row', { name: /Lee Lapsed/ }));
    // Excused and on-leave meetings are not in the count against the member.
    expect(row.getByText('1 of 2')).toBeInTheDocument();
    expect(row.getByText('Attended 1 of the last 3 meetings; 2 required')).toBeInTheDocument();
  });

  it('reads the election named in the address', async () => {
    window.history.pushState({}, '', '/elections/attendance?election=closed-1');
    renderWithRouter(<ElectionAttendancePage />);
    await screen.findByText('Sam Steady');
    expect(lastQuery()?.[0]).toBe('closed-1');
  });

  it('narrows the count to the meeting types checked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionAttendancePage />);
    await screen.findByText('Sam Steady');

    await user.click(screen.getByRole('checkbox', { name: 'Business meeting' }));
    await user.click(screen.getByRole('checkbox', { name: 'Annual meeting' }));
    await waitFor(() => expect(lastQuery()?.[1].meeting_type).toEqual(['business', 'annual']));
  });

  it('holds a backwards custom period rather than asking for it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionAttendancePage />);
    await screen.findByText('Sam Steady');

    await user.selectOptions(screen.getByLabelText('Period'), 'custom');
    const from = await screen.findByLabelText('From');
    const calls = mockGetAttendance.mock.calls.length;
    fireEvent.change(from, { target: { value: '2099-01-01' } });

    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument();
    expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(mockGetAttendance.mock.calls.length).toBe(calls);
  });

  it('opens a member’s meetings with how each counts and who recorded it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionAttendancePage />);
    await screen.findByText('Lee Lapsed');

    const toggle = screen.getByRole('button', { name: 'Meetings for Lee Lapsed' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const list = await screen.findByRole('list', { name: 'Meetings for Lee Lapsed' });
    expect(mockGetMemberMeetings).toHaveBeenCalledWith('draft-1', 'u-lapsed', lastQuery()?.[1]);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Attended');
    expect(items[0]).toHaveTextContent('Recorded by Pat Secretary');
    expect(items[0]).toHaveTextContent('Event check-in');
    expect(items[0]).toHaveTextContent('Checked in');
    expect(items[1]).toHaveTextContent('Excused');
    expect(items[1]).toHaveTextContent('Reason: Work shift');
    expect(items[2]).toHaveTextContent('On leave');
    expect(items[2]).toHaveTextContent('Leave 8/1/2026 to 8/31/2026');

    await user.click(toggle);
    expect(screen.queryByRole('list', { name: 'Meetings for Lee Lapsed' })).not.toBeInTheDocument();
  });

  it('waits for both custom dates before asking', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionAttendancePage />);
    await screen.findByText('Sam Steady');
    await user.selectOptions(screen.getByLabelText('Period'), 'custom');
    const calls = mockGetAttendance.mock.calls.length;
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } });
    expect(await screen.findByText('Choose both dates.')).toBeInTheDocument();
    expect(mockGetAttendance.mock.calls.length).toBe(calls);
  });

  it('says so when attendance cannot be loaded', async () => {
    mockGetAttendance.mockRejectedValue(new Error('offline'));
    renderWithRouter(<ElectionAttendancePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  });

  it('explains an empty page when there are no elections', async () => {
    mockGetElections.mockResolvedValue([]);
    renderWithRouter(<ElectionAttendancePage />);
    expect(await screen.findByText('No elections yet')).toBeInTheDocument();
    expect(mockGetAttendance).not.toHaveBeenCalled();
  });
});

describe('monthsBefore', () => {
  it('steps back whole months', () => {
    expect(monthsBefore('2026-11-13', 12)).toBe('2025-11-13');
    expect(monthsBefore('2026-02-10', 3)).toBe('2025-11-10');
  });

  it('clamps to the last day of a shorter month', () => {
    expect(monthsBefore('2026-05-31', 3)).toBe('2026-02-28');
    expect(monthsBefore('2024-05-31', 3)).toBe('2024-02-29');
  });
});
