import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const getStaffing = vi.fn();
const openStaffing = vi.fn();
const getVolunteerSeats = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    getStaffing: (...a: unknown[]) => getStaffing(...a) as unknown,
    openStaffing: (...a: unknown[]) => openStaffing(...a) as unknown,
    getVolunteerSeats: (...a: unknown[]) => getVolunteerSeats(...a) as unknown,
    getModuleSettings: () =>
      Promise.resolve({
        outreach_event_types: [
          { value: 'station_tour', label: 'Station Tour', default_roles: [{ role: 'educator', count: 2 }] },
          { value: 'other', label: 'Other' },
        ],
      }),
  },
  eventRequestService: {
    getOutreachRoles: () =>
      Promise.resolve([
        { value: 'greeter', label: 'Greeter' },
        { value: 'educator', label: 'Educator' },
      ]),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import EventStaffingCard from './EventStaffingCard';

const EMPTY = { slots_total: 0, slots_filled: 0, roles: [], volunteers: [], request_id: null };

const renderCard = () =>
  render(
    <MemoryRouter>
      <EventStaffingCard eventId="ev-1" />
    </MemoryRouter>
  );

describe('EventStaffingCard', () => {
  beforeEach(() => {
    getStaffing.mockReset();
    openStaffing.mockReset();
    getVolunteerSeats.mockReset();
  });

  it('opens a sheet starting from a request type preset', async () => {
    const user = userEvent.setup();
    getStaffing.mockResolvedValue(EMPTY);
    openStaffing.mockResolvedValue({
      ...EMPTY,
      shift_id: 'sh-1',
      slots_total: 2,
      roles: [{ role: 'educator', label: 'Educator', total: 2, filled: 0, remaining: 2 }],
    });
    getVolunteerSeats.mockResolvedValue({
      shift_id: 'sh-1',
      seats: [
        { role: 'educator', label: 'Educator', member_name: null, is_me: false },
        { role: 'educator', label: 'Educator', member_name: null, is_me: false },
      ],
      signed_up: false,
    });
    renderCard();

    await user.selectOptions(await screen.findByLabelText('Start from'), 'station_tour');
    expect(screen.getByRole('combobox', { name: 'Role 1' })).toHaveValue('educator');
    expect(screen.getByRole('spinbutton', { name: 'How many for role 1' })).toHaveValue(2);
    // Only types that carry a preset are offered as a starting point.
    expect(screen.queryByRole('option', { name: 'Other' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open signups' }));

    await waitFor(() => expect(openStaffing).toHaveBeenCalledWith('ev-1', { roles: [{ role: 'educator', count: 2 }] }));
    expect(await screen.findByText('0 of 2 signed up')).toBeInTheDocument();
    expect(screen.getByText('2 open')).toBeInTheDocument();
  });

  it('starts from the first configured role without a preset', async () => {
    getStaffing.mockResolvedValue(EMPTY);
    renderCard();

    expect(await screen.findByRole('combobox', { name: 'Role 1' })).toHaveValue('greeter');
  });

  it("shows a request's open sheet seat by seat, without sending the organizer away", async () => {
    // Owner request, 2026-11-23: the "arranged there — Open the request" line
    // is gone once the sheet is open; the seats are the card.
    getStaffing.mockResolvedValue({
      ...EMPTY,
      request_id: 'req-9',
      shift_id: 'sh-9',
      slots_total: 1,
      slots_filled: 1,
      roles: [{ role: 'greeter', label: 'Greeter', total: 1, filled: 1, remaining: 0 }],
    });
    getVolunteerSeats.mockResolvedValue({
      shift_id: 'sh-9',
      seats: [{ role: 'greeter', label: 'Greeter', member_name: 'Jordan Avery', is_me: false }],
      signed_up: false,
    });
    renderCard();

    expect(await screen.findByText('Jordan Avery')).toBeInTheDocument();
    expect(screen.queryByText(/arranged there/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open signups' })).not.toBeInTheDocument();
  });

  it('points to the request when its signups are not open yet', async () => {
    getStaffing.mockResolvedValue({ ...EMPTY, request_id: 'req-9' });
    renderCard();

    expect(await screen.findByRole('link', { name: 'Open them from the request' })).toHaveAttribute(
      'href',
      '/events/admin/requests/req-9'
    );
    expect(screen.queryByRole('button', { name: 'Open signups' })).not.toBeInTheDocument();
  });
});
