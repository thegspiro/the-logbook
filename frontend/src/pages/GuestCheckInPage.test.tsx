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
  // The typed form. A pipeline-linked event signs in by email instead; see
  // "Email-first sign-in" below.
  collects_prospect_details: false,
  timezone: 'America/New_York',
};

const pipelineEventInfo = { ...eventInfo, event_name: 'Recruitment Night', collects_prospect_details: true };

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

    it('asks only for name and contact details on the typed form', async () => {
      mockFetchSequence({ ok: true, body: eventInfo });

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

    it('does not greet a typed sign-in as a returning applicant', async () => {
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

      expect(await screen.findByText("You're signed in!")).toBeInTheDocument();
      expect(screen.queryByText('Thanks for coming back')).not.toBeInTheDocument();
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

  describe('Email-first sign-in at a pipeline event', () => {
    const recognised = {
      status: 'prospect',
      display_name: 'Jane S.',
      confirm_token: 'tok-123',
      message: 'Welcome back! Please confirm this is you.',
    };
    const signedIn = {
      status: 'checked_in',
      attendee_id: 'att-1',
      event_name: 'Recruitment Night',
      checked_in_at: '2026-08-09T23:05:00Z',
      message: "You're signed in to Recruitment Night.",
    };

    const lookUp = async (user: ReturnType<typeof userEvent.setup>, email = 'jane@example.com') => {
      await user.type(await screen.findByLabelText(/^email/i), email);
      await user.click(screen.getByRole('button', { name: /continue/i }));
    };

    it('asks for an email instead of a name', async () => {
      mockFetchSequence({ ok: true, body: pipelineEventInfo });

      renderWithRouter(<GuestCheckInPage />);

      expect(await screen.findByLabelText(/^email/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/last name/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    });

    it('looks the email up and asks a recognised applicant to confirm', async () => {
      const user = userEvent.setup();
      const fetchMock = mockFetchSequence({ ok: true, body: pipelineEventInfo }, { ok: true, body: recognised });

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user, '  jane@example.com ');

      expect(await screen.findByText('Is this you, Jane S.?')).toBeInTheDocument();
      const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('/api/public/v1/display/ABC123XY/events/evt-1/guest-lookup');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toEqual({ email: 'jane@example.com' });
      // Nothing is recorded until the applicant confirms.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('confirms with the token alone and greets the applicant', async () => {
      const user = userEvent.setup();
      const fetchMock = mockFetchSequence(
        { ok: true, body: pipelineEventInfo },
        { ok: true, body: recognised },
        { ok: true, body: signedIn }
      );

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);
      await user.click(await screen.findByRole('button', { name: /yes, check me in/i }));

      expect(await screen.findByText("You're signed in, Jane S.!")).toBeInTheDocument();
      expect(screen.getByText('Thanks for coming back')).toBeInTheDocument();
      const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(url).toBe('/api/public/v1/display/ABC123XY/events/evt-1/guest-confirm');
      expect(JSON.parse(options.body as string)).toEqual({ confirm_token: 'tok-123' });
    });

    it('tells a returning applicant they are already checked in', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: pipelineEventInfo },
        { ok: true, body: recognised },
        {
          ok: true,
          body: {
            ...signedIn,
            status: 'already_checked_in',
            message: "You're already checked in to Recruitment Night.",
          },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);
      await user.click(await screen.findByRole('button', { name: /yes, check me in/i }));

      expect(await screen.findByText("You're already checked in, Jane S.")).toBeInTheDocument();
    });

    it('returns to the email step with a typo hint on "That\'s not me"', async () => {
      const user = userEvent.setup();
      const fetchMock = mockFetchSequence({ ok: true, body: pipelineEventInfo }, { ok: true, body: recognised });

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);
      await user.click(await screen.findByRole('button', { name: /that's not me/i }));

      const input = await screen.findByLabelText(/^email/i);
      expect(input).toHaveValue('jane@example.com');
      expect(input).toHaveFocus();
      expect(screen.getByText(/check your email address for typos/i)).toBeInTheDocument();
      expect(screen.queryByText(/Jane S\./)).not.toBeInTheDocument();
      // No confirm call was made.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('points a member account at the member QR code', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: pipelineEventInfo },
        {
          ok: true,
          body: {
            status: 'member',
            message:
              'This looks like a department member account. Please scan the member QR code on the display instead.',
          },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);

      expect(await screen.findByText(/department member account/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /yes, check me in/i })).not.toBeInTheDocument();
    });

    it('sends an unrecognised visitor to staff, with a way to retry a typo', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: pipelineEventInfo },
        {
          ok: true,
          body: { status: 'not_found', message: "We couldn't find you. Please see a member of staff to sign in." },
        }
      );

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);

      expect(await screen.findByText(/please see a member of staff/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /try a different email/i }));
      expect(await screen.findByLabelText(/^email/i)).toHaveValue('jane@example.com');
    });

    it('starts again from the email when the confirmation has expired', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: pipelineEventInfo },
        { ok: true, body: recognised },
        { ok: false, status: 400, body: { detail: 'This confirmation has expired. Please enter your email again.' } }
      );

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);
      await user.click(await screen.findByRole('button', { name: /yes, check me in/i }));

      expect(
        await screen.findByText('This confirmation has expired. Please enter your email again.')
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    });

    it('surfaces a lookup error and keeps the form usable', async () => {
      const user = userEvent.setup();
      mockFetchSequence(
        { ok: true, body: pipelineEventInfo },
        { ok: false, status: 429, body: { detail: 'Too many sign-in attempts. Please try again in a few minutes.' } }
      );

      renderWithRouter(<GuestCheckInPage />);
      await lookUp(user);

      expect(await screen.findByText(/too many sign-in attempts/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
    });
  });
});
