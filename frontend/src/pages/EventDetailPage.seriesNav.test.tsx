import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import { EventDetailPage } from './EventDetailPage';
import { electionService } from '../services/electionService';
import { applicantService } from '../modules/prospective-members/services/api';
import * as apiModule from '../services/api';
import type { Event, EventStats } from '../types/event';
import type { CurrentUser } from '../types/auth';
import type { TrainingSessionResponse } from '../services/api';

/** Create a mock API error object (not a Promise) */

// Mock the API module
const downloadCsv = vi.fn();
vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>();
  return { ...actual, downloadCsv: (...args: unknown[]) => downloadCsv(...args) as unknown };
});

vi.mock('../services/api', () => ({
  // Behind the transfer dialog's organizer pickers.
  userService: {
    getUsers: vi.fn(),
  },
  eventService: {
    getEvent: vi.fn(),
    getEvents: vi.fn(),
    getEventRSVPs: vi.fn(),
    getEventAttendees: vi.fn(),
    getEventStats: vi.fn(),
    getEligibleMembers: vi.fn(),
    bulkAddAttendees: vi.fn(),
    createOrUpdateRSVP: vi.fn(),
    cancelEvent: vi.fn(),
    deleteEvent: vi.fn(),
    deleteEventSeries: vi.fn(),
    duplicateEvent: vi.fn(),
    checkInAttendee: vi.fn(),
    recordActualTimes: vi.fn(),
    finalizeAttendance: vi.fn(),
    reopenAttendance: vi.fn(),
    endEvent: vi.fn(),
    getMyAttendancePetition: vi.fn(),
    transferEvent: vi.fn(),
    submitAttendancePetition: vi.fn(),
    getAttendancePetitions: vi.fn(),
    approveAttendancePetition: vi.fn(),
    rejectAttendancePetition: vi.fn(),
    createTemplate: vi.fn(),
  },
  // Behind Save as Template on a Training event.
  trainingSessionService: {
    getSessionByEvent: vi.fn(),
  },
}));

// The card is tested on its own. Here it only reports a session, the way the
// real one does once its fetch settles, and records the props the page gives it.
const mockCardProps = vi.fn();
let mockReportedSession: Partial<TrainingSessionResponse> | null = null;
vi.mock('../components/event-detail/TrainingSessionLinkageCard', async () => {
  const { useEffect } = await import('react');
  const MockTrainingSessionLinkageCard = (props: { onSessionChange?: (session: unknown) => void }) => {
    mockCardProps(props);
    const { onSessionChange } = props;
    useEffect(() => {
      onSessionChange?.(mockReportedSession);
    }, [onSessionChange]);
    return null;
  };
  return { default: MockTrainingSessionLinkageCard };
});

// Neither is under test here. Left real, each sends a live request whose
// failure ends in the auth redirect, which jsdom reports as "Not implemented:
// navigation to another Document" in the middle of unrelated tests.
vi.mock('../services/electionService', () => ({
  electionService: { getElectionsByEvent: vi.fn() },
}));
vi.mock('../modules/prospective-members/services/api', () => ({
  applicantService: { getApplicants: vi.fn() },
}));
// Tested on its own (EventGuestsCard.test.tsx); its request is not under test here.
vi.mock('../components/event-detail/EventGuestsCard', () => ({ default: () => null }));
// Tested on its own (EventApparatusCrewCard.test.tsx); its request is not under test here.
vi.mock('../components/event-detail/EventApparatusCrewCard', () => ({ default: () => null }));
// The card-taps section has its own tests (EventCardCheckinsTab.test.tsx);
// here it would only add a request the services/api mock above does not serve.
vi.mock('../components/event-detail/EventCardTapsCard', () => ({ EventCardTapsCard: () => null }));
vi.mock('../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({ connected: new Set<string>(), loading: false, isConnected: () => false }),
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-router
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'evt-1' }),
  };
});

// Mock auth store
const mockCheckPermission = vi.fn();
const mockAuthState = {
  checkPermission: mockCheckPermission,
  user: null as CurrentUser | null,
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState as unknown as Record<string, unknown>) : mockAuthState
  ),
}));

const mockEvent: Event = {
  id: 'evt-1',
  organization_id: 'org-1',
  title: 'Monthly Business Meeting',
  description: 'Regular monthly meeting to discuss department updates.',
  event_type: 'business_meeting',
  location: 'Station 1 Conference Room',
  start_datetime: '2030-04-15T18:00:00Z',
  end_datetime: '2030-04-15T20:00:00Z',
  requires_rsvp: true,
  rsvp_deadline: '2030-04-14T18:00:00Z',
  max_attendees: 50,
  allowed_rsvp_statuses: ['going', 'not_going'],
  is_mandatory: false,
  allow_guests: true,
  send_reminders: true,
  reminder_target: 'all',
  reminder_schedule: [24],
  is_cancelled: false,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

const mockStats: EventStats = {
  event_id: 'evt-1',
  total_rsvps: 25,
  going_count: 20,
  not_going_count: 3,
  maybe_count: 2,
  checked_in_count: 15,
  total_guests: 5,
  capacity_percentage: 50,
};

describe('EventDetailPage series navigation', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReportedSession = null;
    mockCardProps.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockAuthState.checkPermission = mockCheckPermission;
    mockAuthState.user = null;
    // A sane default for every block. vi.clearAllMocks() drops
    // implementations but not the mock itself, so without this the member
    // roster fetch resolves undefined in blocks that never mention it.
    vi.mocked(eventService.getEventAttendees).mockResolvedValue([]);
    // Past events ask for the member's attendance-request standing, and the
    // organizer's view for the list; neither is under test outside its block.
    vi.mocked(eventService.getMyAttendancePetition).mockReset();
    vi.mocked(eventService.getMyAttendancePetition).mockResolvedValue({ petition: null, can_request: false });
    vi.mocked(eventService.getAttendancePetitions).mockReset();
    vi.mocked(eventService.getAttendancePetitions).mockResolvedValue([]);
    vi.mocked(electionService.getElectionsByEvent).mockReset();
    vi.mocked(electionService.getElectionsByEvent).mockResolvedValue([]);
    vi.mocked(applicantService.getApplicants).mockReset();
    vi.mocked(applicantService.getApplicants).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      total_pages: 0,
    });
  });

  it('asks for the series itself, not the first page of every event', async () => {
    const occurrence: Event = { ...mockEvent, is_recurring: true, recurrence_parent_id: 'parent-1' };
    vi.mocked(eventService.getEvent).mockResolvedValue(occurrence);
    vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
    vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
    vi.mocked(eventService.getEvents).mockResolvedValue([]);

    renderWithRouter(<EventDetailPage />);

    await waitFor(() =>
      expect(eventService.getEvents).toHaveBeenCalledWith(expect.objectContaining({ recurrence_series_id: 'parent-1' }))
    );
  });
});
