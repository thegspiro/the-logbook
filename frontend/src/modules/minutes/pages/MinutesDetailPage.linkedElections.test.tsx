/**
 * The Linked Elections card on a minutes record must key on the event.
 *
 * `Election.meeting_id` holds a `meetings` row id; a minutes record is a
 * `meeting_minutes` row. The page used to pass its own id as `meeting_id`,
 * comparing two different id spaces — so the query matched nothing and the
 * card could never appear, however many elections were held at that meeting.
 *
 * These assert on which lookup runs, because the rendered outcome is identical
 * either way when the fixture happens to return rows: only the argument tells
 * the fixed page from the broken one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const MINUTES_ID = 'minutes-1';
const EVENT_ID = 'event-9';

const mockGetElectionsByEvent = vi.fn();
const mockGetElectionsByMeeting = vi.fn();
const mockGetMinutes = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ minutesId: MINUTES_ID }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../../../services/electionService', () => ({
  electionService: {
    getElectionsByEvent: (...a: unknown[]) => mockGetElectionsByEvent(...a) as unknown,
    getElectionsByMeeting: (...a: unknown[]) => mockGetElectionsByMeeting(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  eventService: { getEvent: vi.fn().mockResolvedValue(null), getEvents: vi.fn().mockResolvedValue([]) },
}));

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const minutes = {
  id: MINUTES_ID,
  title: 'July Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-08-10T19:00:00Z',
  status: 'approved',
  event_id: EVENT_ID,
  sections: [],
  motions: [],
  action_items: [],
};

describe('MinutesDetailPage — Linked Elections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMinutes.mockResolvedValue(minutes);
    mockGetElectionsByEvent.mockResolvedValue([
      {
        id: 'election-1',
        title: 'Assistant Chief Special Election',
        election_type: 'position',
        positions: ['Assistant Chief'],
        status: 'closed',
      },
    ]);
    mockGetElectionsByMeeting.mockResolvedValue([]);
  });

  it('looks elections up by the event the minutes record, not by its own id', async () => {
    renderWithRouter(<MinutesDetailPage />);
    await waitFor(() => {
      expect(mockGetElectionsByEvent).toHaveBeenCalledWith(EVENT_ID);
    });
    // The broken lookup compared a meeting_minutes id against meetings ids.
    expect(mockGetElectionsByMeeting).not.toHaveBeenCalled();
  });

  it('renders the card for an election held at that event', async () => {
    renderWithRouter(<MinutesDetailPage />);
    expect(await screen.findByText('Linked Elections')).toBeInTheDocument();
    expect(await screen.findByText('Assistant Chief Special Election')).toBeInTheDocument();
  });

  it('asks for nothing when the minutes record has no event', async () => {
    mockGetMinutes.mockResolvedValue({ ...minutes, event_id: null });
    renderWithRouter(<MinutesDetailPage />);
    await waitFor(() => {
      expect(mockGetMinutes).toHaveBeenCalledWith(MINUTES_ID);
    });
    expect(mockGetElectionsByEvent).not.toHaveBeenCalled();
    expect(screen.queryByText('Linked Elections')).not.toBeInTheDocument();
  });
});
