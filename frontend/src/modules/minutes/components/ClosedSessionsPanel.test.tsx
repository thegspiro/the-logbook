import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockAdd = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getClosedSessions: (...a: unknown[]) => mockList(...a) as unknown,
    addClosedSession: (...a: unknown[]) => mockAdd(...a) as unknown,
    updateClosedSession: (...a: unknown[]) => mockUpdate(...a) as unknown,
    deleteClosedSession: (...a: unknown[]) => mockDelete(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

// The real picker is three selects and a date input per time; a plain input
// keeps these tests about the panel and not about the picker.
vi.mock('../../../components/ux/DateTimeQuarterHour', () => ({
  default: ({ value, onChange, timeLabel }: { value: string; onChange: (v: string) => void; timeLabel?: string }) => (
    <input aria-label={timeLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { ClosedSessionsPanel } from './ClosedSessionsPanel';
import { renderWithRouter } from '../../../test/utils';
import { localToUTC } from '../../../utils/dateFormatting';
import type { AttendeeEntry, ClosedSession, Motion } from '../types/minutes';

const TZ = 'America/Chicago';

const session: ClosedSession = {
  id: 's1',
  minutes_id: 'm1',
  motion_id: null,
  reason: 'Personnel matter',
  legal_basis: 'Bylaws Art. IV §3',
  started_at: '2026-10-02T01:10:00Z',
  ended_at: '2026-10-02T01:40:00Z',
  participants: [
    { user_id: 'u1', name: 'Alex Adams', joined_at: '2026-10-02T01:10:00Z', left_at: '2026-10-02T01:40:00Z' },
    { name: 'Counsel', joined_at: '2026-10-02T01:15:00Z' },
  ],
  summary: 'No action was taken.',
  created_at: '2026-10-02T02:00:00Z',
  updated_at: '2026-10-02T02:00:00Z',
};

const roll: AttendeeEntry[] = [
  { user_id: 'u1', name: 'Alex Adams', status: 'present', present: true },
  { user_id: 'u2', name: 'Blake Brown', status: 'late', present: true },
  { user_id: 'u3', name: 'Casey Cole', status: 'excused', present: false },
  { name: 'Visitor', status: 'guest', present: false },
];

const motions = [{ id: 'mo1', motion_text: 'Move into closed session' }] as Motion[];

describe('ClosedSessionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockAdd.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockList.mockResolvedValue([session]);
    mockAdd.mockResolvedValue(session);
    mockUpdate.mockResolvedValue(session);
  });

  const render = (canEdit: boolean) =>
    renderWithRouter(<ClosedSessionsPanel minutesId="m1" canEdit={canEdit} attendees={roll} motions={motions} />);

  it('shows why, when and who stayed, and the public summary', async () => {
    render(false);

    expect(await screen.findByRole('heading', { name: 'Closed sessions (1)' })).toBeInTheDocument();
    expect(screen.getByText(/1\. Personnel matter/)).toBeInTheDocument();
    expect(screen.getByText(/Bylaws Art\. IV §3/)).toBeInTheDocument();
    expect(screen.getByText('In the room (2)')).toBeInTheDocument();
    expect(screen.getByText(/Alex Adams · /)).toBeInTheDocument();
    expect(screen.getByText('No action was taken.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Record a closed session/ })).not.toBeInTheDocument();
  });

  it('shows a reader nothing when no closed session was held', async () => {
    mockList.mockResolvedValue([]);
    const { container } = render(false);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('records a closed session with the people present and times in the department’s zone', async () => {
    mockList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(true);

    await user.click(await screen.findByRole('button', { name: /Record a closed session/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Legal advice');
    fireEvent.change(within(dialog).getByLabelText('Closed session began'), { target: { value: '2026-10-01T20:10' } });
    fireEvent.change(within(dialog).getByLabelText('Closed session ended'), { target: { value: '2026-10-01T20:40' } });
    await user.click(within(dialog).getByRole('button', { name: 'Add everyone present at the meeting' }));
    await user.type(within(dialog).getByLabelText(/Add someone by name/), 'Counsel{Enter}');
    await user.type(within(dialog).getByLabelText('What may be said publicly'), 'No action.');
    await user.click(within(dialog).getByRole('button', { name: 'Save closed session' }));

    const start = localToUTC('2026-10-01T20:10', TZ);
    const end = localToUTC('2026-10-01T20:40', TZ);
    expect(mockAdd).toHaveBeenCalledWith('m1', {
      reason: 'Legal advice',
      legal_basis: null,
      started_at: start,
      ended_at: end,
      motion_id: null,
      summary: 'No action.',
      participants: [
        { user_id: 'u1', name: 'Alex Adams', joined_at: start, left_at: end },
        { user_id: 'u2', name: 'Blake Brown', joined_at: start, left_at: end },
        { user_id: null, name: 'Counsel', joined_at: start, left_at: end },
      ],
    });
  });

  it('adds only those who were in the room, not the excused or guests', async () => {
    mockList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(true);

    await user.click(await screen.findByRole('button', { name: /Record a closed session/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add everyone present at the meeting' }));

    expect(within(dialog).getByText('Alex Adams')).toBeInTheDocument();
    expect(within(dialog).getByText('Blake Brown')).toBeInTheDocument();
    expect(within(dialog).queryByText('Casey Cole')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Visitor')).not.toBeInTheDocument();
  });

  it('will not save without a reason and a start', async () => {
    mockList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(true);

    await user.click(await screen.findByRole('button', { name: /Record a closed session/ }));
    await user.click(await screen.findByRole('button', { name: 'Save closed session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/why the body went into closed session/);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and keeps the form open', async () => {
    mockList.mockResolvedValue([]);
    mockAdd.mockRejectedValue(new Error('A closed session cannot end before it starts'));
    const user = userEvent.setup();
    render(true);

    await user.click(await screen.findByRole('button', { name: /Record a closed session/ }));
    await user.type(await screen.findByLabelText('Reason'), 'x');
    fireEvent.change(screen.getByLabelText('Closed session began'), { target: { value: '2026-10-01T20:10' } });
    await user.click(screen.getByRole('button', { name: 'Save closed session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot end before it starts/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('edits a session with every field it owns, clearing a blank one with null', async () => {
    const user = userEvent.setup();
    render(true);

    await user.click(await screen.findByRole('button', { name: 'Edit closed session 1' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Authority (bylaw or statute)'));
    await user.clear(within(dialog).getByLabelText('What may be said publicly'));
    await user.click(within(dialog).getByRole('button', { name: 'Save closed session' }));

    expect(mockUpdate).toHaveBeenCalledWith(
      'm1',
      's1',
      expect.objectContaining({ reason: 'Personnel matter', legal_basis: null, summary: null })
    );
  });

  it('removes a session only after confirmation', async () => {
    mockDelete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(true);

    await user.click(await screen.findByRole('button', { name: 'Remove closed session 1' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mockDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove closed session 1' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('m1', 's1'));
  });

  it('offers a link to the motion that opened it only when there are motions', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ClosedSessionsPanel minutesId="m1" canEdit attendees={roll} motions={[]} />);

    await user.click(await screen.findByRole('button', { name: 'Edit closed session 1' }));
    expect(screen.queryByLabelText('Motion that opened it')).not.toBeInTheDocument();
  });
});
