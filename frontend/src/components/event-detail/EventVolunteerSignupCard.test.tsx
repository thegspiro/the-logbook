import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signupForShift = vi.fn();
const getVolunteerSeats = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    signupForShift: (...args: unknown[]) => signupForShift(...args) as unknown,
  },
}));
vi.mock('../../services/api', () => ({
  eventService: {
    getVolunteerSeats: (...args: unknown[]) => getVolunteerSeats(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { renderWithRouter } from '../../test/utils';
import EventVolunteerSignupCard from './EventVolunteerSignupCard';
import type { EventVolunteerSeatBoard } from '../../types/event';

const board = (overrides: Partial<EventVolunteerSeatBoard> = {}): EventVolunteerSeatBoard => ({
  shift_id: 'shift-7',
  seats: [
    { role: 'tour_guide', label: 'Tour Guide', member_name: 'Gabriel Spiro', is_me: false },
    { role: 'tour_guide', label: 'Tour Guide', member_name: null, is_me: false },
    { role: 'educator', label: 'Educator', member_name: null, is_me: false },
  ],
  signed_up: false,
  my_role_label: null,
  ...overrides,
});

describe('EventVolunteerSignupCard', () => {
  beforeEach(() => {
    signupForShift.mockReset();
    signupForShift.mockResolvedValue({});
    getVolunteerSeats.mockReset();
    getVolunteerSeats.mockResolvedValue(board());
  });

  it('lists every seat as the shift crew board does, held or open', async () => {
    renderWithRouter(<EventVolunteerSignupCard eventId="ev-1" isPast={false} />);

    expect(await screen.findByText('Gabriel Spiro')).toBeInTheDocument();
    expect(screen.getAllByText('Open position')).toHaveLength(2);
    expect(screen.getByText('1 of 3 signed up')).toBeInTheDocument();
    expect(screen.getByText('2 open')).toBeInTheDocument();
    expect(getVolunteerSeats).toHaveBeenCalledWith('ev-1');
  });

  it("signs the member up for that seat's role and re-reads the seats", async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventVolunteerSignupCard eventId="ev-1" isPast={false} />);

    getVolunteerSeats.mockResolvedValueOnce(
      board({
        seats: [
          { role: 'tour_guide', label: 'Tour Guide', member_name: 'Gabriel Spiro', is_me: false },
          { role: 'tour_guide', label: 'Tour Guide', member_name: null, is_me: false },
          { role: 'educator', label: 'Educator', member_name: 'Pat Doe', is_me: true },
        ],
        signed_up: true,
        my_role_label: 'Educator',
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Sign myself up as Educator' }));

    await waitFor(() => expect(signupForShift).toHaveBeenCalledWith('shift-7', { outreach_role: 'educator' }));
    expect(await screen.findByText(/You are signed up as Educator/)).toBeInTheDocument();
    expect(screen.getByText('(You)')).toBeInTheDocument();
    // Signed up: no seat is offered again, which the cached event detail used to do.
    expect(screen.queryByRole('button', { name: /Sign myself up/ })).not.toBeInTheDocument();
    expect(getVolunteerSeats).toHaveBeenCalledTimes(2);
  });

  it('offers no seat once the event is over', async () => {
    renderWithRouter(<EventVolunteerSignupCard eventId="ev-1" isPast />);
    expect(await screen.findByText('Gabriel Spiro')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign myself up/ })).not.toBeInTheDocument();
  });

  it('says why when the seats cannot be read', async () => {
    getVolunteerSeats.mockReset();
    getVolunteerSeats.mockRejectedValue(new Error('Network Error'));
    renderWithRouter(<EventVolunteerSignupCard eventId="ev-1" isPast={false} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
