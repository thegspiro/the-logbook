/**
 * "Unlink" on a minutes record's linked event sent `{ event_id: undefined }`.
 *
 * The update body is JSON.stringify'd before it reaches the backend, and
 * JSON.stringify drops a key whose value is `undefined` entirely — so the
 * request body was `{}`, not `{ event_id: null }`. The backend's
 * `MinutesUpdate` is applied with `exclude_unset=True`, so an omitted key
 * means "leave this field alone": the unlink silently did nothing but still
 * showed a "Event unlinked" success toast (CLAUDE.md Pitfall #1 — an update
 * clear needs an explicit `null`, never an omitted/undefined key).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';
const EVENT_ID = 'event-9';

const mockGetMinutes = vi.fn();
const mockUpdateMinutes = vi.fn();
const mockGetEvent = vi.fn();
const mockGetElectionsByEvent = vi.fn();
const mockCheckPermission = vi.fn();

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
    getElectionsByMeeting: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
    updateMinutes: (...a: unknown[]) => mockUpdateMinutes(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  eventService: {
    getEvent: (...a: unknown[]) => mockGetEvent(...a) as unknown,
    getEvents: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = {
    checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean,
    user: undefined,
  };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const minutes = {
  id: MINUTES_ID,
  title: 'July Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-08-10T19:00:00Z',
  status: 'draft',
  event_id: EVENT_ID,
  sections: [],
  motions: [],
  action_items: [],
};

const linkedEvent = {
  id: EVENT_ID,
  title: 'July Business Meeting Event',
  start_datetime: '2026-08-10T19:00:00Z',
  location: 'Station 1',
};

describe('MinutesDetailPage — unlink event', () => {
  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockUpdateMinutes.mockReset();
    mockGetEvent.mockReset();
    mockGetElectionsByEvent.mockReset();
    mockCheckPermission.mockReset();

    mockCheckPermission.mockReturnValue(true);
    mockGetMinutes.mockResolvedValue(minutes);
    mockGetEvent.mockResolvedValue(linkedEvent);
    mockGetElectionsByEvent.mockResolvedValue([]);
    mockUpdateMinutes.mockResolvedValue({ ...minutes, event_id: null });
  });

  it('sends an explicit null, not an omitted/undefined key, when unlinking', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    const unlinkButton = await screen.findByRole('button', { name: 'Unlink' });
    await user.click(unlinkButton);

    await waitFor(() => {
      expect(mockUpdateMinutes).toHaveBeenCalledWith(MINUTES_ID, { event_id: null });
    });
    // The bug this guards: `{ event_id: undefined }` — a key JSON.stringify
    // drops, indistinguishable on the wire from not sending event_id at all.
    const [, sentPayload] = mockUpdateMinutes.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.prototype.hasOwnProperty.call(sentPayload, 'event_id')).toBe(true);
    expect(sentPayload.event_id).toBeNull();
  });
});
