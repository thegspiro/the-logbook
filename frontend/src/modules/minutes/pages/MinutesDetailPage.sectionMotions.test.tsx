/**
 * Sections the outline marks as needing a motion and a second, on the minutes
 * detail page: the motion arrives written, the mover and seconder are chosen
 * from the roll, and the same roll feeds the adoption dialog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';
const SECRETARY = 'user-secretary';
const CHIEF = 'user-chief';

const mockGetMinutes = vi.fn();
const mockAddMotion = vi.fn();
const mockListAll = vi.fn();
const mockUpdate = vi.fn();
const authState = {
  checkPermission: () => true,
  user: { id: SECRETARY } as { id: string } | undefined,
};

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ minutesId: MINUTES_ID }), useNavigate: () => vi.fn() };
});

vi.mock('../../../services/electionService', () => ({
  electionService: {
    getElectionsByEvent: () => Promise.resolve([]),
    getElectionsByMeeting: () => Promise.resolve([]),
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
    addMotion: (...a: unknown[]) => mockAddMotion(...a) as unknown,
    listAllMinutes: (...a: unknown[]) => mockListAll(...a) as unknown,
    updateMinutes: (...a: unknown[]) => mockUpdate(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  eventService: { getEvent: () => Promise.resolve(null), getEvents: () => Promise.resolve([]) },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const roll = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'present', present: true },
  { name: 'Sam Absent', status: 'absent', present: false },
];

const sections = [
  { order: 0, key: 'call_to_order', title: 'Call to Order', content: '', format: 'text' },
  {
    order: 1,
    key: 'adjournment',
    title: 'Adjournment',
    content: '',
    format: 'text',
    needs_motion: true,
    motion_text: 'Motion to adjourn the meeting.',
  },
];

const draft = {
  id: MINUTES_ID,
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'draft',
  attendees: roll,
  sections,
  motions: [],
  action_items: [],
};

describe('MinutesDetailPage section motions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(draft);
    mockAddMotion.mockReset();
    mockAddMotion.mockResolvedValue({});
    mockListAll.mockReset();
    mockListAll.mockResolvedValue([]);
    mockUpdate.mockReset();
    authState.user = { id: SECRETARY };
  });

  it('puts the written motion on the section that needs it, and not on the others', async () => {
    renderWithRouter(<MinutesDetailPage />);

    const group = await screen.findByRole('group', { name: 'Motion for Adjournment' });
    expect(within(group).getByLabelText('Motion')).toHaveValue('Motion to adjourn the meeting.');
    expect(screen.queryByRole('group', { name: 'Motion for Call to Order' })).toBeNull();
  });

  it('records the motion on its section, moved and seconded from the roll', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    const group = await screen.findByRole('group', { name: 'Motion for Adjournment' });
    await user.selectOptions(within(group).getByLabelText('Moved by'), 'Pat Chief');
    await user.selectOptions(within(group).getByLabelText('Seconded by'), 'Lee Treasurer');
    await user.click(within(group).getByRole('button', { name: 'Record motion' }));

    expect(mockAddMotion).toHaveBeenCalledWith(
      MINUTES_ID,
      expect.objectContaining({ section_key: 'adjournment', moved_by: 'Pat Chief', seconded_by: 'Lee Treasurer' })
    );
    expect(mockGetMinutes.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows the motion read-only once the minutes are circulated', async () => {
    mockGetMinutes.mockResolvedValue({
      ...draft,
      status: 'submitted',
      submitted_by: SECRETARY,
      motions: [
        {
          id: 'mo1',
          minutes_id: MINUTES_ID,
          order: 0,
          motion_text: 'Motion to adjourn the meeting.',
          moved_by: 'Pat Chief',
          seconded_by: 'Lee Treasurer',
          section_key: 'adjournment',
          status: 'passed',
        },
      ],
    });
    renderWithRouter(<MinutesDetailPage />);

    const group = await screen.findByRole('group', { name: 'Motion for Adjournment' });
    expect(within(group).getByText('Moved by: Pat Chief')).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Record motion' })).toBeNull();
  });

  it('draws the adoption motion’s mover and seconder from the same roll', async () => {
    authState.user = { id: CHIEF };
    mockGetMinutes.mockResolvedValue({ ...draft, status: 'submitted', submitted_by: SECRETARY });
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Adopt Minutes' }));

    const dialog = await screen.findByRole('dialog');
    const names = within(within(dialog).getByLabelText('Moved by'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['Choose from the roll…', 'Pat Chief', 'Lee Treasurer', 'Someone else (type a name)']);
  });

  it('records the start and end from the call to order and adjournment sections', async () => {
    mockUpdate.mockImplementation((_id: string, body: Record<string, unknown>) =>
      Promise.resolve({ ...draft, ...body })
    );
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await screen.findByRole('heading', { name: 'Call to Order' });
    const buttons = screen.getAllByRole('button', { name: 'Record now' });
    expect(buttons).toHaveLength(2);

    await user.click(buttons[0] as HTMLElement);
    expect(mockUpdate).toHaveBeenCalledWith(MINUTES_ID, {
      called_to_order_at: expect.stringMatching(/:00\.000Z$/) as unknown,
    });
    expect(await screen.findByText(/Called to order at/)).toBeInTheDocument();
  });

  it('offers no time capture once the minutes are circulated, but still shows a recorded time', async () => {
    mockGetMinutes.mockResolvedValue({
      ...draft,
      status: 'submitted',
      submitted_by: SECRETARY,
      called_to_order_at: '2026-10-08T00:02:00Z',
    });
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Called to order at 7:02 PM')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record now' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change the called to order time/ })).toBeNull();
  });
});
