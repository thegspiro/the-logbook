import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExternalAttendee } from '../../types/event';

const mockGetExternalAttendees = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    getExternalAttendees: (...a: unknown[]) => mockGetExternalAttendees(...a) as unknown,
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
});
