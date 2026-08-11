import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import GuestCheckInPage from './GuestCheckInPage';

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

let mockParamsValue: Record<string, string | undefined> = { code: 'ABC123XY', eventId: 'evt-1' };

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useParams: () => mockParamsValue,
  };
});

const eventInfo = {
  event_id: 'evt-1',
  event_name: 'Volunteer Interest Night',
  event_type: 'public_education',
  start_datetime: '2026-08-09T23:00:00Z',
  end_datetime: '2026-08-10T01:00:00Z',
  location_name: 'Main Meeting Hall',
  organization_name: 'Falls Church Volunteer Fire Department',
  is_open: true,
  closed_reason: null,
  collects_prospect_details: true,
  timezone: 'America/New_York',
};

/** Queue up fetch responses in call order. */
const mockFetchSequence = (...responses: Array<{ ok: boolean; status?: number; body: unknown }>) => {
  const fetchMock = vi.fn();
  responses.forEach((r) => {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: () => Promise.resolve(r.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const fillRequiredFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/first name/i), 'Dana');
  await user.type(screen.getByLabelText(/last name/i), 'Reyes');
};

describe('GuestCheckInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamsValue = { code: 'ABC123XY', eventId: 'evt-1' };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Loading and error states', () => {
    it('shows a loading message while the event loads', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise(() => {}))
      );

      renderWithRouter(<GuestCheckInPage />);

      expect(screen.getByText('Loading event...')).toBeInTheDocument();
    });

    it('explains that sign-in is unavailable on a 404', async () => {
      mockFetchSequence({ ok: false, status: 404, body: { detail: 'nope' } });

      renderWithRouter(<GuestCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Sign-In Unavailable')).toBeInTheDocument();
      });
      expect(screen.getByText(/not available for this event/i)).toBeInTheDocument();
    });

    it('reports a connection problem when the request throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('offline')))
      );

      renderWithRouter(<GuestCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText(/unable to connect/i)).toBeInTheDocument();
      });
    });
  });

  describe('Event details', () => {
    it('renders the event, room and department', async () => {
      mockFetchSequence({ ok: true, body: eventInfo });

      renderWithRouter(<GuestCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Volunteer Interest Night')).toBeInTheDocument();
      });
      expect(screen.getByText('Falls Church Volunteer Fire Department')).toBeInTheDocument();
      expect(screen.getByText(/Main Meeting Hall/)).toBeInTheDocument();
    });

    it('fetches through the public display endpoint, not the member API', async () => {
      const fetchMock = mockFetchSequence({ ok: true, body: eventInfo });

      renderWithRouter(<GuestCheckInPage />);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/public/v1/display/ABC123XY/events/evt-1/guest');
      });
    });

    it('hides the form and explains why when the window is closed', async () => {
      mockFetchSequence({
        ok: true,
        body: { ...eventInfo, is_open: false, closed_reason: 'Check-in has closed for this event.' },
      });

      renderWithRouter(<GuestCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Sign-in is not open')).toBeInTheDocument();
      });
      expect(screen.getByText('Check-in has closed for this event.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    });

    it('omits the interest question when the event does not feed the pipeline', async () => {
      mockFetchSequence({ ok: true, body: { ...eventInfo, collects_prospect_details: false } });

      renderWithRouter(<GuestCheckInPage />);

      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/what brings you here/i)).not.toBeInTheDocument();
    });
  });

  describe('Submitting', () => {
    it('posts the guest details and shows a confirmation', async () => {
      const user = userEvent.setup();
      const fetchMock = mockFetchSequence(
        { ok: true, body: eventInfo },
        {
          ok: true,
          status: 201,
          body: {
            status: 'checked_in',
            attendee_id: 'att-1',
            event_name: 'Volunteer Interest Night',
            checked_in_at: '2026-08-09T23:05:00Z',
            message: "You're signed in to Volunteer Interest Night.",
          },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

      await fillRequiredFields(user);
      await user.type(screen.getByLabelText(/^email/i), 'dana.reyes@example.com');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByText("You're signed in!")).toBeInTheDocument();
      });

      const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('/api/public/v1/display/ABC123XY/events/evt-1/guest-check-in');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body.first_name).toBe('Dana');
      expect(body.last_name).toBe('Reyes');
      expect(body.email).toBe('dana.reyes@example.com');
    });

    it('omits untouched optional fields instead of sending empty strings', async () => {
      const user = userEvent.setup();
      const fetchMock = mockFetchSequence(
        { ok: true, body: eventInfo },
        {
          ok: true,
          status: 201,
          body: {
            status: 'checked_in',
            attendee_id: 'a',
            event_name: 'x',
            checked_in_at: '',
            message: 'ok',
          },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      const [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('phone');
    });

    it('tells the guest a follow-up is coming when the event collects prospect details', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: eventInfo },
        {
          ok: true,
          status: 201,
          body: {
            status: 'checked_in',
            attendee_id: 'att-1',
            event_name: 'Volunteer Interest Night',
            checked_in_at: '2026-08-09T23:05:00Z',
            message: 'Signed in.',
          },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByText('We have your details')).toBeInTheDocument();
      });
    });

    it('does not promise a follow-up when the event does not collect prospect details', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: { ...eventInfo, collects_prospect_details: false } },
        {
          ok: true,
          status: 201,
          body: {
            status: 'checked_in',
            attendee_id: 'att-1',
            event_name: 'Volunteer Interest Night',
            checked_in_at: '2026-08-09T23:05:00Z',
            message: 'Signed in.',
          },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText("You're signed in!")).toBeInTheDocument();
      expect(screen.queryByText('We have your details')).not.toBeInTheDocument();
    });

    it('surfaces the server error and keeps the form usable', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: eventInfo },
        { ok: false, status: 400, body: { detail: 'Check-in has closed for this event.' } }
      );

      renderWithRouter(<GuestCheckInPage />);
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByText('Check-in has closed for this event.')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
    });

    it('keeps the submit button disabled until a name is entered', async () => {
      mockFetchSequence({ ok: true, body: eventInfo });

      renderWithRouter(<GuestCheckInPage />);
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();

      expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
    });
  });
});
