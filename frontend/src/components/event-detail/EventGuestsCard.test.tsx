import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExternalAttendee } from '../../types/event';

const mockGetExternalAttendees = vi.fn();
const mockAddExternalAttendee = vi.fn();
const mockCheckInExternalAttendee = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    getExternalAttendees: (...a: unknown[]) => mockGetExternalAttendees(...a) as unknown,
    addExternalAttendee: (...a: unknown[]) => mockAddExternalAttendee(...a) as unknown,
    checkInExternalAttendee: (...a: unknown[]) => mockCheckInExternalAttendee(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import EventGuestsCard from './EventGuestsCard';

const guest = (overrides: Partial<ExternalAttendee> = {}): ExternalAttendee => ({
  id: 'g-1',
  event_id: 'ev-1',
  name: 'Robin Park',
  email: 'robin@example.org',
  phone: '555-0100',
  organization_name: 'Scout Troop 12',
  checked_in: true,
  checked_in_at: '2026-10-10T18:05:00Z',
  source: 'kiosk_qr',
  created_at: '2026-10-10T18:05:00Z',
  ...overrides,
});

describe('EventGuestsCard', () => {
  beforeEach(() => {
    mockGetExternalAttendees.mockReset();
    mockGetExternalAttendees.mockResolvedValue([
      guest(),
      guest({ id: 'g-2', name: 'Lee Shaw', organization_name: null, email: null, phone: null, checked_in: false }),
    ]);
  });

  it('lists guests apart from attendance and says they are not counted in it', async () => {
    render(<EventGuestsCard eventId="ev-1" canManage allowsGuestCheckIn />);

    expect(await screen.findByRole('heading', { name: 'Guests (2)' })).toBeInTheDocument();
    expect(mockGetExternalAttendees).toHaveBeenCalledWith('ev-1');
    expect(screen.getByText(/Guests are not counted in attendance\. 1 signed in\./)).toBeInTheDocument();
    expect(screen.getByText('robin@example.org · 555-0100')).toBeInTheDocument();
    expect(screen.getAllByText('Signed in at the kiosk')).toHaveLength(2);
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });

  it('asks for nothing and renders nothing without events.manage', () => {
    const { container } = render(<EventGuestsCard eventId="ev-1" canManage={false} allowsGuestCheckIn />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGetExternalAttendees).not.toHaveBeenCalled();
  });

  it('says nobody has signed in on an event that takes guests', async () => {
    mockGetExternalAttendees.mockResolvedValue([]);
    render(<EventGuestsCard eventId="ev-1" canManage allowsGuestCheckIn />);

    expect(await screen.findByText('No guests have signed in yet.')).toBeInTheDocument();
  });

  it('stays out of the way on an event with no guests that takes none', async () => {
    mockGetExternalAttendees.mockResolvedValue([]);
    const { container } = render(<EventGuestsCard eventId="ev-1" canManage allowsGuestCheckIn={false} />);

    await vi.waitFor(() => expect(mockGetExternalAttendees).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('says when guests could not be loaded rather than showing none', async () => {
    mockGetExternalAttendees.mockRejectedValue(new Error('boom'));
    render(<EventGuestsCard eventId="ev-1" canManage allowsGuestCheckIn={false} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Guests could not be loaded');
  });

  describe('signing guests in by hand', () => {
    const walkIn = guest({
      id: 'g-3',
      name: 'Mary Walker',
      email: 'mary@example.org',
      phone: '555-0101',
      organization_name: null,
      checked_in: false,
      checked_in_at: null,
      source: null,
    });

    beforeEach(() => {
      mockAddExternalAttendee.mockReset();
      mockAddExternalAttendee.mockResolvedValue(walkIn);
      mockCheckInExternalAttendee.mockReset();
      mockCheckInExternalAttendee.mockResolvedValue({ status: 'checked_in', attendee_id: 'g-3', prospect_id: null });
      mockToastSuccess.mockReset();
      mockToastError.mockReset();
    });

    const openForm = async (user: ReturnType<typeof userEvent.setup>, addsGuestsToPipeline = false) => {
      render(
        <EventGuestsCard eventId="ev-1" canManage allowsGuestCheckIn addsGuestsToPipeline={addsGuestsToPipeline} />
      );
      await user.click(await screen.findByRole('button', { name: /add guest/i }));
    };

    it('adds the guest and signs them in, sending blanks as omitted fields', async () => {
      const user = userEvent.setup();
      await openForm(user);

      await user.type(screen.getByLabelText(/first name/i), ' Mary ');
      await user.type(screen.getByLabelText(/last name/i), 'Walker');
      await user.click(screen.getByRole('button', { name: /add and sign in/i }));

      await waitFor(() => expect(mockCheckInExternalAttendee).toHaveBeenCalledWith('ev-1', 'g-3'));
      expect(mockAddExternalAttendee).toHaveBeenCalledWith('ev-1', {
        name: 'Mary Walker',
        email: undefined,
        phone: undefined,
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('Mary Walker signed in.');
      // The list is read again so the new guest appears.
      await waitFor(() => expect(mockGetExternalAttendees).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says when the sign-in linked the guest to an application', async () => {
      const user = userEvent.setup();
      mockCheckInExternalAttendee.mockResolvedValue({ status: 'checked_in', attendee_id: 'g-3', prospect_id: 'p-1' });
      await openForm(user, true);

      expect(screen.getByText(/gets an application opened in the prospective members pipeline/i)).toBeInTheDocument();
      await user.type(screen.getByLabelText(/first name/i), 'Mary');
      await user.type(screen.getByLabelText(/last name/i), 'Walker');
      await user.type(screen.getByLabelText(/email/i), 'mary@example.org');
      await user.click(screen.getByRole('button', { name: /add and sign in/i }));

      await waitFor(() =>
        expect(mockToastSuccess).toHaveBeenCalledWith('Mary Walker signed in and linked to their application.')
      );
      expect(mockAddExternalAttendee).toHaveBeenCalledWith('ev-1', {
        name: 'Mary Walker',
        email: 'mary@example.org',
        phone: undefined,
      });
    });

    it('needs a first and last name', async () => {
      const user = userEvent.setup();
      await openForm(user);

      const submit = screen.getByRole('button', { name: /add and sign in/i });
      expect(submit).toBeDisabled();
      await user.type(screen.getByLabelText(/first name/i), 'Cher');
      expect(submit).toBeDisabled();
    });

    it('keeps the form open with the reason when the guest cannot be added', async () => {
      const user = userEvent.setup();
      mockAddExternalAttendee.mockRejectedValue(new Error('Attendance for this event has been finalized'));
      await openForm(user);

      await user.type(screen.getByLabelText(/first name/i), 'Mary');
      await user.type(screen.getByLabelText(/last name/i), 'Walker');
      await user.click(screen.getByRole('button', { name: /add and sign in/i }));

      expect(await screen.findByText('Attendance for this event has been finalized')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(mockCheckInExternalAttendee).not.toHaveBeenCalled();
    });

    it('lists a guest whose sign-in failed rather than inviting a duplicate entry', async () => {
      const user = userEvent.setup();
      mockCheckInExternalAttendee.mockRejectedValue(new Error('nope'));
      await openForm(user);

      await user.type(screen.getByLabelText(/first name/i), 'Mary');
      await user.type(screen.getByLabelText(/last name/i), 'Walker');
      await user.click(screen.getByRole('button', { name: /add and sign in/i }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      await waitFor(() => expect(mockGetExternalAttendees).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('signs in a guest who was entered but has not signed in', async () => {
      const user = userEvent.setup();
      render(<EventGuestsCard eventId="ev-1" canManage allowsGuestCheckIn />);

      await user.click(await screen.findByRole('button', { name: 'Sign in Lee Shaw' }));

      await waitFor(() => expect(mockCheckInExternalAttendee).toHaveBeenCalledWith('ev-1', 'g-2'));
      expect(mockToastSuccess).toHaveBeenCalledWith('Lee Shaw signed in.');
      expect(screen.queryByRole('button', { name: 'Sign in Robin Park' })).not.toBeInTheDocument();
    });

    it('opens an empty form each time', async () => {
      const user = userEvent.setup();
      await openForm(user);
      await user.type(screen.getByLabelText(/first name/i), 'Half');
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await user.click(screen.getByRole('button', { name: /add guest/i }));

      expect(screen.getByLabelText(/first name/i)).toHaveValue('');
    });
  });
});
