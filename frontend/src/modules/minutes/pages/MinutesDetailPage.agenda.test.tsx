/**
 * Sections born from a meeting's agenda, on the minutes detail page: who
 * presents, the linked documents, an item the meeting never reached, and the
 * sync from the agenda.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';

const mockGetMinutes = vi.fn();
const mockListAll = vi.fn();
const mockUpdate = vi.fn();
const mockAgendaSync = vi.fn();
const authState = {
  checkPermission: () => true,
  user: { id: 'user-secretary' } as { id: string } | undefined,
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
    listAllMinutes: (...a: unknown[]) => mockListAll(...a) as unknown,
    updateMinutes: (...a: unknown[]) => mockUpdate(...a) as unknown,
    getAgendaSync: (...a: unknown[]) => mockAgendaSync(...a) as unknown,
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

const sections = [
  {
    order: 0,
    key: 'agenda-treasurer',
    title: "Treasurer's report",
    content: '',
    format: 'text',
    presenter: 'Lee Treasurer',
    agenda_key: 'treasurer',
    documents: [{ id: 'd1', name: 'October ledger' }],
  },
  {
    order: 1,
    key: 'agenda-old',
    title: 'Old business',
    content: '',
    format: 'text',
    agenda_key: 'old',
    not_taken_up: true,
  },
  { order: 2, key: 'agenda-new', title: 'New business', content: '', format: 'text', agenda_key: 'new' },
];

const draft = {
  id: MINUTES_ID,
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'draft',
  meeting_id: 'meeting-1',
  attendees: [],
  sections,
  motions: [],
  action_items: [],
};

describe('MinutesDetailPage agenda sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(draft);
    mockListAll.mockReset();
    mockListAll.mockResolvedValue([]);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue(draft);
    mockAgendaSync.mockReset();
    mockAgendaSync.mockResolvedValue({ meeting_id: 'meeting-1', changes: [] });
    authState.checkPermission = () => true;
  });

  it('shows who presents and the documents that go with the item', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Presented by Lee Treasurer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'October ledger' })).toHaveAttribute('href', '/documents');
  });

  it('marks an item the meeting never reached, and keeps it in the record', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Not taken up')).toBeInTheDocument();
    expect(screen.getByText('Not taken up.')).toBeInTheDocument();
  });

  it('records that the meeting did not take an item up, sending every section', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByText('New business');

    const boxes = screen.getAllByRole('checkbox', { name: 'The meeting did not take this up' });
    // Treasurer's report, Old business (already ticked), New business.
    await user.click(boxes[2] as HTMLElement);

    expect(mockUpdate).toHaveBeenCalledWith(MINUTES_ID, {
      sections: expect.arrayContaining([
        expect.objectContaining({ key: 'agenda-new', not_taken_up: true }),
        expect.objectContaining({ key: 'agenda-old', not_taken_up: true }),
      ]) as unknown,
      // Every section save names the version it was loaded at (MM5-4).
      expected_version: 0,
    });
  });

  it('offers the sync only on minutes drafted from a meeting', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Sync from agenda' }));
    expect(mockAgendaSync).toHaveBeenCalledWith(MINUTES_ID);
  });

  it('does not offer the sync to minutes with no meeting behind them', async () => {
    mockGetMinutes.mockResolvedValue({ ...draft, meeting_id: null });
    renderWithRouter(<MinutesDetailPage />);

    await screen.findByText('New business');
    expect(screen.queryByRole('button', { name: 'Sync from agenda' })).not.toBeInTheDocument();
  });

  it('does not offer the sync once the minutes are circulated', async () => {
    mockGetMinutes.mockResolvedValue({ ...draft, status: 'submitted', submitted_by: 'someone' });
    renderWithRouter(<MinutesDetailPage />);

    await screen.findByText('New business');
    expect(screen.queryByRole('button', { name: 'Sync from agenda' })).not.toBeInTheDocument();
  });
});
