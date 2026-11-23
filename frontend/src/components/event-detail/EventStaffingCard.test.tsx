import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const getStaffing = vi.fn();
const openStaffing = vi.fn();
const getVolunteerSeats = vi.fn();
const sendVolunteerCall = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    getStaffing: (...a: unknown[]) => getStaffing(...a) as unknown,
    openStaffing: (...a: unknown[]) => openStaffing(...a) as unknown,
    getVolunteerSeats: (...a: unknown[]) => getVolunteerSeats(...a) as unknown,
    sendVolunteerCall: (...a: unknown[]) => sendVolunteerCall(...a) as unknown,
    getModuleSettings: () =>
      Promise.resolve({
        outreach_event_types: [
          { value: 'station_tour', label: 'Station Tour', default_roles: [{ role: 'educator', count: 2 }] },
          { value: 'other', label: 'Other' },
        ],
      }),
  },
  memberAudienceService: {
    getOptions: () => Promise.resolve({ member_classes: [], member_statuses: [], positions: [] }),
    preview: () => Promise.resolve({ recipients: 12, skipped_opted_out: 1 }),
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

import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EventStaffingCard from './EventStaffingCard';

const EMPTY = { slots_total: 0, slots_filled: 0, roles: [], volunteers: [], request_id: null };

// ConfirmProvider as the app root mounts it: the seat board asks before a
// member gives their spot up.
const renderCard = () =>
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <EventStaffingCard eventId="ev-1" />
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('EventStaffingCard', () => {
  beforeEach(() => {
    getStaffing.mockReset();
    openStaffing.mockReset();
    getVolunteerSeats.mockReset();
    sendVolunteerCall.mockReset();
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

  const OPEN_SHEET = {
    ...EMPTY,
    shift_id: 'sh-1',
    slots_total: 2,
    roles: [{ role: 'educator', label: 'Educator', total: 2, filled: 0, remaining: 2 }],
  };

  it("emails the membership from an event's own sheet", async () => {
    const user = userEvent.setup();
    getStaffing.mockResolvedValue(OPEN_SHEET);
    sendVolunteerCall.mockResolvedValue({
      message: 'Volunteer call emailed to 12 members.',
      recipients: 12,
      skipped_opted_out: 1,
      volunteer_call_sent_at: '2026-11-22T15:00:00Z',
    });
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Email the Membership' }));
    await user.type(screen.getByLabelText('Note (optional)'), 'Bring the smoke trailer.');
    const send = screen.getByRole('button', { name: 'Send Request for Help' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    await waitFor(() =>
      expect(sendVolunteerCall).toHaveBeenCalledWith('ev-1', {
        member_classes: [],
        member_statuses: [],
        position_ids: [],
        message: 'Bring the smoke trailer.',
      })
    );
    // The sheet is re-read afterwards, so "Last sent" reflects the send.
    await waitFor(() => expect(getStaffing).toHaveBeenCalledTimes(2));
  });

  it("offers no call on a request's sheet, which is called for from the request", async () => {
    // The "Open the request" line this used to wait on is gone (owner request,
    // 2026-11-23); the seat board is what renders once the sheet has loaded.
    getStaffing.mockResolvedValue({ ...OPEN_SHEET, request_id: 'req-9' });
    getVolunteerSeats.mockResolvedValue({
      shift_id: 'sh-1',
      seats: [{ role: 'educator', label: 'Educator', member_name: 'Jordan Avery', is_me: false }],
      signed_up: false,
    });
    renderCard();

    expect(await screen.findByText('Jordan Avery')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email the Membership' })).not.toBeInTheDocument();
  });

  it('shows when the last call went out', async () => {
    getStaffing.mockResolvedValue({ ...OPEN_SHEET, volunteer_call_sent_at: '2026-11-21T15:00:00Z' });
    renderCard();

    expect(await screen.findByText(/Last sent/)).toBeInTheDocument();
  });
});
