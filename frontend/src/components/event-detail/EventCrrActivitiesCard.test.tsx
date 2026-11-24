import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrrActivity, CrrFormOptions } from '../../types/crr';

const getFormOptions = vi.fn();
const listActivities = vi.fn();
const createActivity = vi.fn();
const lookupZip = vi.fn();
vi.mock('../../services/crrServices', () => ({
  crrService: {
    getFormOptions: (...args: unknown[]) => getFormOptions(...args) as unknown,
    listActivities: (...args: unknown[]) => listActivities(...args) as unknown,
    createActivity: (...args: unknown[]) => createActivity(...args) as unknown,
    lookupZip: (...args: unknown[]) => lookupZip(...args) as unknown,
  },
}));

import { useAuthStore } from '../../stores/authStore';
import type { CurrentUser } from '../../types/auth';
import { renderWithRouter } from '../../test/utils';
import EventCrrActivitiesCard from './EventCrrActivitiesCard';

const options: CrrFormOptions = {
  activity_types: [
    {
      id: 't-seat',
      code: 'car_seat_check',
      name: 'Car seat check',
      description: null,
      is_system: true,
      is_active: true,
      sort_order: 0,
      measures: [{ id: 'm-seats', code: 'seats_checked', label: 'Seats checked', is_active: true, sort_order: 0 }],
      tag_ids: [],
      admin_hours_category_id: null,
    },
  ],
  tags: [],
  default_city: 'Falls Church',
  default_state: 'VA',
  zip_lookup_enabled: true,
  members: [{ id: 'me', name: 'Alex Rivera' }],
  retention_months: 24,
  can_view_contact: false,
};

const seatCheck: CrrActivity = {
  id: 'a1',
  activity_type_id: 't-seat',
  activity_type_name: 'Car seat check',
  event_id: 'event-1',
  event_title: 'Safety day',
  occurred_at: '2026-11-20T15:00:00Z',
  zip_code: null,
  city: 'Falls Church',
  state: 'VA',
  county: null,
  counts: [{ measure_id: 'm-seats', label: 'Seats checked', quantity: 12 }],
  tags: [],
  members: [],
  recorded_by_name: 'Alex Rivera',
  has_resident_details: false,
  resident_details_cleared: false,
  street_address: null,
  resident_name: null,
  resident_phone: null,
  resident_email: null,
  notes: null,
  can_edit: true,
};

const renderCard = () =>
  renderWithRouter(<EventCrrActivitiesCard eventId="event-1" eventTitle="Safety day" timezone="America/New_York" />);

describe('EventCrrActivitiesCard', () => {
  beforeEach(() => {
    for (const mock of [getFormOptions, listActivities, createActivity, lookupZip]) mock.mockReset();
    getFormOptions.mockResolvedValue(structuredClone(options));
    listActivities.mockResolvedValue({ items: [structuredClone(seatCheck)], total: 1 });
    useAuthStore.setState({ user: { id: 'me' } as CurrentUser });
  });

  it("lists only this event's activities, with their counts", async () => {
    renderCard();

    expect(await screen.findByText('— Seats checked: 12')).toBeInTheDocument();
    expect(listActivities).toHaveBeenCalledWith({ event_id: 'event-1', limit: 200 });
  });

  it('says when nothing is recorded yet', async () => {
    listActivities.mockResolvedValue({ items: [], total: 0 });
    renderCard();

    expect(await screen.findByText('None recorded yet.')).toBeInTheDocument();
  });

  it('records against the event, crediting no members, then reloads', async () => {
    const user = userEvent.setup();
    createActivity.mockResolvedValue(structuredClone(seatCheck));
    renderCard();

    const record = await screen.findByRole('button', { name: 'Record an activity' });
    await vi.waitFor(() => expect(record).toBeEnabled());
    await user.click(record);
    const dialog = await screen.findByRole('dialog', { name: 'CRR activity at Safety day' });
    expect(within(dialog).getByText(/credited by the event's attendance/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Who took part')).not.toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText(/Activity type/), 't-seat');
    await user.type(within(dialog).getByLabelText('Seats checked'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Record activity' }));

    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 'event-1', counts: { 'm-seats': 12 }, members: {} })
    );
    await vi.waitFor(() => expect(listActivities).toHaveBeenCalledTimes(2));
  });

  it('shows its load error', async () => {
    listActivities.mockRejectedValue(new Error('The server is down'));
    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('The server is down');
  });
});
