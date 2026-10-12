/**
 * Pledges and fundraising events had working APIs and no screens; the
 * dashboard's Outstanding Pledges tile had lost its link because the page
 * did not exist. Both pages now list for fundraising.view and offer
 * create/edit to fundraising.manage only. Creates omit blanks; edits send
 * every field the form owns, a cleared one as null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { FundraisingEvent, Pledge } from '../types';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const listPledges = vi.fn();
const createPledge = vi.fn();
const updatePledge = vi.fn();
const listEvents = vi.fn();
const createEvent = vi.fn();
const updateEvent = vi.fn();
const listDonors = vi.fn();
const listCampaigns = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    listPledges: (...args: unknown[]) => listPledges(...args) as unknown,
    createPledge: (...args: unknown[]) => createPledge(...args) as unknown,
    updatePledge: (...args: unknown[]) => updatePledge(...args) as unknown,
    listFundraisingEvents: (...args: unknown[]) => listEvents(...args) as unknown,
    createFundraisingEvent: (...args: unknown[]) => createEvent(...args) as unknown,
    updateFundraisingEvent: (...args: unknown[]) => updateEvent(...args) as unknown,
    listDonors: (...args: unknown[]) => listDonors(...args) as unknown,
    listCampaigns: (...args: unknown[]) => listCampaigns(...args) as unknown,
  },
}));

import PledgesPage from './PledgesPage';
import FundraisingEventsPage from './FundraisingEventsPage';

const pledge = (overrides: Partial<Pledge> = {}): Pledge => ({
  id: 'pl-1',
  organizationId: 'org',
  campaignId: 'camp-1',
  donorId: 'donor-1',
  pledgedAmount: '500.00',
  fulfilledAmount: '200.00',
  pledgeDate: '2026-09-01',
  dueDate: '2026-12-31',
  status: 'partial',
  paymentSchedule: null,
  reminderEnabled: true,
  notes: 'Paying in two halves',
  createdBy: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...overrides,
});

const fundraiser = (overrides: Partial<FundraisingEvent> = {}): FundraisingEvent => ({
  id: 'ev-1',
  organizationId: 'org',
  campaignId: null,
  eventId: null,
  name: 'Pancake Breakfast',
  description: null,
  eventType: 'dinner',
  eventDate: '2026-11-07T13:00:00Z',
  location: 'Station 1',
  ticketPrice: '10.00',
  maxAttendees: 200,
  currentAttendees: 150,
  revenueGoal: '3000.00',
  actualRevenue: '3200.00',
  expenses: '700.00',
  status: 'completed',
  registrationUrl: null,
  sponsors: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

const renderPage = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [
    listPledges,
    createPledge,
    updatePledge,
    listEvents,
    createEvent,
    updateEvent,
    listDonors,
    listCampaigns,
  ]) {
    m.mockReset();
  }
  granted = new Set(['fundraising.view', 'fundraising.manage']);
  listPledges.mockResolvedValue([pledge()]);
  createPledge.mockResolvedValue(pledge());
  updatePledge.mockResolvedValue(pledge());
  listEvents.mockResolvedValue([fundraiser()]);
  createEvent.mockResolvedValue(fundraiser());
  updateEvent.mockResolvedValue(fundraiser());
  listDonors.mockResolvedValue([{ id: 'donor-1', firstName: 'Ann', lastName: 'Lee', companyName: null }]);
  listCampaigns.mockResolvedValue([{ id: 'camp-1', name: 'New Engine Fund' }]);
});

describe('PledgesPage', () => {
  it('lists pledges with donor, campaign and what remains', async () => {
    renderPage(<PledgesPage />);

    await screen.findByText('Ann Lee');
    const row = screen.getByRole('row', { name: /Ann Lee/ });
    expect(within(row).getByText('New Engine Fund')).toBeInTheDocument();
    expect(within(row).getByText('$300.00')).toBeInTheDocument();
    expect(within(row).getByText('Partly received')).toBeInTheDocument();
    expect(within(row).getByText('Dec 31, 2026')).toBeInTheDocument();
  });

  it('filters by status on the server', async () => {
    const user = userEvent.setup();
    renderPage(<PledgesPage />);

    await user.click(await screen.findByRole('button', { name: 'Overdue' }));

    await waitFor(() => expect(listPledges).toHaveBeenLastCalledWith({ status: 'overdue', limit: 1000 }));
  });

  it('records a pledge with blanks omitted', async () => {
    const user = userEvent.setup();
    renderPage(<PledgesPage />);

    await user.click(await screen.findByRole('button', { name: /record pledge/i }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Ann Lee' });
    await user.selectOptions(within(dialog).getByLabelText(/^donor/i), 'donor-1');
    await user.type(within(dialog).getByLabelText('Amount pledged'), '1000');
    await user.clear(within(dialog).getByLabelText('Pledge date'));
    await user.type(within(dialog).getByLabelText('Pledge date'), '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: 'Record pledge' }));

    await waitFor(() =>
      expect(createPledge).toHaveBeenCalledWith({
        donorId: 'donor-1',
        campaignId: undefined,
        pledgedAmount: '1000.00',
        pledgeDate: '2026-10-01',
        dueDate: undefined,
        notes: undefined,
      })
    );
    await waitFor(() => expect(listPledges).toHaveBeenCalledTimes(2));
  });

  it('edits a pledge, recording what came in and clearing a field as null', async () => {
    const user = userEvent.setup();
    renderPage(<PledgesPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit the pledge from Ann Lee' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Amount received so far'));
    await user.type(within(dialog).getByLabelText('Amount received so far'), '500');
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'fulfilled');
    await user.clear(within(dialog).getByLabelText(/notes/i));
    await user.clear(within(dialog).getByLabelText(/due date/i));
    await user.click(within(dialog).getByRole('button', { name: 'Save pledge' }));

    await waitFor(() =>
      expect(updatePledge).toHaveBeenCalledWith('pl-1', {
        donorId: 'donor-1',
        campaignId: 'camp-1',
        pledgedAmount: '500.00',
        pledgeDate: '2026-09-01',
        dueDate: null,
        fulfilledAmount: '500.00',
        status: 'fulfilled',
        notes: null,
      })
    );
  });

  it('offers a viewer the list and nothing to change', async () => {
    granted = new Set(['fundraising.view']);
    renderPage(<PledgesPage />);

    await screen.findByText('Ann Lee');
    expect(screen.queryByRole('button', { name: /record pledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit the pledge/i })).not.toBeInTheDocument();
  });
});

describe('FundraisingEventsPage', () => {
  it('shows each event with its results and net', async () => {
    renderPage(<FundraisingEventsPage />);

    await screen.findByRole('heading', { name: 'Pancake Breakfast' });
    const card = screen.getByRole('listitem');
    expect(within(card).getByText('Completed')).toBeInTheDocument();
    expect(within(card).getByText('$2,500.00')).toBeInTheDocument();
    expect(within(card).getByText('150 of 200')).toBeInTheDocument();
  });

  it('adds an event with blanks omitted and the time in the department zone', async () => {
    const user = userEvent.setup();
    renderPage(<FundraisingEventsPage />);

    await user.click(await screen.findByRole('button', { name: /add event/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Golf Classic');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'golf_outing');
    await user.type(within(dialog).getByLabelText('Date and time'), '2027-05-15T08:00');
    await user.type(within(dialog).getByLabelText(/revenue goal/i), '15000');
    await user.click(within(dialog).getByRole('button', { name: 'Add event' }));

    await waitFor(() =>
      expect(createEvent).toHaveBeenCalledWith({
        name: 'Golf Classic',
        eventType: 'golf_outing',
        eventDate: '2027-05-15T08:00:00.000Z',
        location: undefined,
        campaignId: undefined,
        ticketPrice: undefined,
        maxAttendees: undefined,
        revenueGoal: '15000',
        registrationUrl: undefined,
        description: undefined,
        notes: undefined,
      })
    );
  });

  it('records results on edit and sends a cleared location as null', async () => {
    const user = userEvent.setup();
    renderPage(<FundraisingEventsPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit Pancake Breakfast' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/location/i));
    await user.clear(within(dialog).getByLabelText('Money raised'));
    await user.type(within(dialog).getByLabelText('Money raised'), '3400');
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(1));
    const [id, payload] = updateEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('ev-1');
    expect(payload.location).toBeNull();
    expect(payload.actualRevenue).toBe('3400');
    expect(payload.expenses).toBe('700.00');
    expect(payload.status).toBe('completed');
    expect(payload.eventDate).toBe('2026-11-07T13:00:00.000Z');
  });

  it('requires a name and a date', async () => {
    const user = userEvent.setup();
    renderPage(<FundraisingEventsPage />);

    await user.click(await screen.findByRole('button', { name: /add event/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add event' }));

    expect(screen.getByText('Give the event a name.')).toBeInTheDocument();
    expect(screen.getByText('Enter when the event takes place.')).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('offers a viewer no add or edit', async () => {
    granted = new Set(['fundraising.view']);
    renderPage(<FundraisingEventsPage />);

    await screen.findByRole('heading', { name: 'Pancake Breakfast' });
    expect(screen.queryByRole('button', { name: /add event/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit pancake/i })).not.toBeInTheDocument();
  });
});
