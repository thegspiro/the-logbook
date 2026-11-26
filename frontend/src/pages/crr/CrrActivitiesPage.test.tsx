import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { CrrActivity, CrrFormOptions } from '../../types/crr';

const getFormOptions = vi.fn();
const listActivities = vi.fn();
const createActivity = vi.fn();
const deleteActivity = vi.fn();
const lookupZip = vi.fn();
vi.mock('../../services/crrServices', () => ({
  crrService: {
    getFormOptions: (...args: unknown[]) => getFormOptions(...args) as unknown,
    listActivities: (...args: unknown[]) => listActivities(...args) as unknown,
    createActivity: (...args: unknown[]) => createActivity(...args) as unknown,
    deleteActivity: (...args: unknown[]) => deleteActivity(...args) as unknown,
    lookupZip: (...args: unknown[]) => lookupZip(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('../../components/events/EventsPageHeader', () => ({
  EventsPageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { useAuthStore } from '../../stores/authStore';
import type { CurrentUser } from '../../types/auth';
import CrrActivitiesPage from './CrrActivitiesPage';

const options: CrrFormOptions = {
  activity_types: [
    {
      id: 't-smoke',
      code: 'smoke_alarm_install',
      name: 'Smoke alarm install',
      description: null,
      is_system: true,
      is_active: true,
      sort_order: 0,
      measures: [
        { id: 'm-alarms', code: 'alarms_installed', label: 'Alarms installed', is_active: true, sort_order: 0 },
      ],
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

const activity = (overrides: Partial<CrrActivity>): CrrActivity => ({
  id: 'a1',
  activity_type_id: 't-smoke',
  activity_type_name: 'Smoke alarm install',
  event_id: null,
  event_title: null,
  occurred_at: '2026-11-20T15:00:00Z',
  zip_code: '22046',
  city: 'Falls Church',
  state: 'VA',
  county: 'Falls Church (city)',
  counts: [{ measure_id: 'm-alarms', label: 'Alarms installed', quantity: 3 }],
  tags: [],
  members: [{ user_id: 'me', name: 'Alex Rivera', minutes: 90 }],
  recorded_by_name: 'Alex Rivera',
  has_resident_details: false,
  resident_details_cleared: false,
  street_address: null,
  resident_name: null,
  resident_phone: null,
  resident_email: null,
  notes: null,
  can_edit: true,
  ...overrides,
});

const LocationEcho = () => <output aria-label="Location">{useLocation().search}</output>;

const renderPage = (path = '/events/crr-activities') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route
            path="/events/crr-activities"
            element={
              <>
                <CrrActivitiesPage />
                <LocationEcho />
              </>
            }
          />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('CrrActivitiesPage', () => {
  beforeEach(() => {
    for (const mock of [getFormOptions, listActivities, createActivity, deleteActivity, lookupZip]) mock.mockReset();
    getFormOptions.mockResolvedValue(structuredClone(options));
    listActivities.mockResolvedValue({ items: [activity({})], total: 1 });
    useAuthStore.setState({ user: { id: 'me' } as CurrentUser });
  });

  it('lists activities with their counts, place and members', async () => {
    renderPage();

    const card = await screen.findByRole('listitem', { name: 'Smoke alarm install' });
    expect(within(card).getByText('Alarms installed: 3')).toBeInTheDocument();
    expect(within(card).getByText('Falls Church, VA 22046')).toBeInTheDocument();
    expect(within(card).getByText('Alex Rivera (1 h 30 min)')).toBeInTheDocument();
  });

  it('says resident details were recorded without showing them, or that they were cleared', async () => {
    listActivities.mockResolvedValue({
      items: [
        activity({ id: 'kept', has_resident_details: true }),
        activity({ id: 'gone', activity_type_name: 'Home safety survey', resident_details_cleared: true }),
      ],
      total: 2,
    });
    renderPage();

    expect(await screen.findByText(/Resident details recorded\./)).toBeInTheDocument();
    expect(screen.getByText('Resident details were cleared after the retention period.')).toBeInTheDocument();
  });

  it('shows the details to someone allowed to see them', async () => {
    listActivities.mockResolvedValue({
      items: [activity({ has_resident_details: true, street_address: '12 Oak St', notes: 'Ask for Pat' })],
      total: 1,
    });
    renderPage();

    expect(await screen.findByText('12 Oak St')).toBeInTheDocument();
    expect(screen.getByText('Ask for Pat')).toBeInTheDocument();
  });

  it('heads notes as notes, apart from the resident details', async () => {
    listActivities.mockResolvedValue({
      items: [activity({ notes: 'Back door sticks' })],
      total: 1,
    });
    renderPage();

    const card = await screen.findByRole('listitem', { name: 'Smoke alarm install' });
    expect(within(card).getByText('Notes')).toBeInTheDocument();
    expect(within(card).queryByText('Resident details')).not.toBeInTheDocument();
  });

  it('says when the filters match nothing, rather than that nothing was logged', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('listitem', { name: 'Smoke alarm install' });

    listActivities.mockResolvedValue({ items: [], total: 0 });
    await user.selectOptions(screen.getByLabelText('When'), 'all');
    expect(await screen.findByText('No CRR activities yet')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Activity type'), 't-smoke');
    expect(await screen.findByText('No activities match these filters')).toBeInTheDocument();
  });

  it('keeps the form-options failure on screen and says why logging is unavailable', async () => {
    getFormOptions.mockRejectedValue(new Error('Options are down'));
    renderPage();

    await screen.findByRole('listitem', { name: 'Smoke alarm install' });
    const button = screen.getByRole('button', { name: 'Log a CRR activity' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Options are down/);
  });

  it('shows the filter chosen last when answers arrive out of order', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('listitem', { name: 'Smoke alarm install' });

    let answerSlowly: (value: { items: CrrActivity[]; total: number }) => void = () => undefined;
    listActivities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerSlowly = resolve;
        })
    );
    listActivities.mockResolvedValueOnce({
      items: [activity({ id: 'year', activity_type_name: 'Car seat inspection' })],
      total: 1,
    });
    await user.selectOptions(screen.getByLabelText('When'), 'all');
    await user.selectOptions(screen.getByLabelText('When'), '365');
    expect(await screen.findByRole('listitem', { name: 'Car seat inspection' })).toBeInTheDocument();

    await act(async () =>
      answerSlowly({ items: [activity({ id: 'old', activity_type_name: 'School program' })], total: 1 })
    );

    expect(screen.getByRole('listitem', { name: 'Car seat inspection' })).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'School program' })).not.toBeInTheDocument();
  });

  it('deletes only after confirming', async () => {
    const user = userEvent.setup();
    deleteActivity.mockResolvedValue(undefined);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete this Smoke alarm install activity' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('the Admin Hours it credited are removed with it');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(deleteActivity).toHaveBeenCalledWith('a1');
    expect(screen.queryByRole('listitem', { name: 'Smoke alarm install' })).not.toBeInTheDocument();
  });

  it('opens the form from ?new=1, then drops the flag', async () => {
    renderPage('/events/crr-activities?new=1');

    expect(await screen.findByRole('dialog', { name: 'Log a CRR activity' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Location' })).not.toHaveTextContent('new=1');
  });

  it('records an activity with the recorder credited by default', async () => {
    const user = userEvent.setup();
    createActivity.mockResolvedValue(activity({ id: 'a2' }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Log a CRR activity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a CRR activity' });
    await user.selectOptions(within(dialog).getByLabelText(/Activity type/), 't-smoke');
    await user.type(within(dialog).getByLabelText('Alarms installed'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Record activity' }));

    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type_id: 't-smoke',
        counts: { 'm-alarms': 4 },
        city: 'Falls Church',
        state: 'VA',
        members: { me: 60 },
        has_resident_details: false,
      })
    );
  });

  it('fills city and state from the ZIP code', async () => {
    const user = userEvent.setup();
    lookupZip.mockResolvedValue({ zip_code: '90210', city: 'Beverly Hills', state: 'CA', county: 'Los Angeles' });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Log a CRR activity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a CRR activity' });
    await user.type(within(dialog).getByLabelText('ZIP code'), '90210');
    await user.tab();

    expect(lookupZip).toHaveBeenCalledWith('90210');
    expect(await within(dialog).findByDisplayValue('Beverly Hills')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('CA')).toBeInTheDocument();
    expect(within(dialog).getByText(/GeoNames ZIP code data/)).toBeInTheDocument();
  });
});
