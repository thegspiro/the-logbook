import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';

const listRequests = vi.fn();
const getRequest = vi.fn();
const postponeRequest = vi.fn();
const assignRequest = vi.fn();
const updateRequestStatus = vi.fn();
const createRequest = vi.fn();
const scheduleRequest = vi.fn();
const getOutreachTypeLabels = vi.fn(() => Promise.resolve({}));
const toastError = vi.fn();
const sendVolunteerCall = vi.fn();
const getAudienceOptions = vi.fn();
const previewAudience = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastError(...args) as unknown,
    success: vi.fn(),
  }),
}));

vi.mock('../services/api', () => ({
  eventRequestService: {
    listRequests: (...args: unknown[]) => listRequests(...args) as unknown,
    getRequest: (...args: unknown[]) => getRequest(...args) as unknown,
    postponeRequest: (...args: unknown[]) => postponeRequest(...args) as unknown,
    assignRequest: (...args: unknown[]) => assignRequest(...args) as unknown,
    updateRequestStatus: (...args: unknown[]) => updateRequestStatus(...args) as unknown,
    createRequest: (...args: unknown[]) => createRequest(...args) as unknown,
    scheduleRequest: (...args: unknown[]) => scheduleRequest(...args) as unknown,
    getOutreachTypeLabels: () => getOutreachTypeLabels(),
    listEmailTemplates: () => Promise.resolve([]),
    getOutreachRoles: () => Promise.resolve([]),
    getStaffing: () => Promise.resolve(null),
    sendVolunteerCall: (...args: unknown[]) => sendVolunteerCall(...args) as unknown,
  },
  memberAudienceService: {
    getOptions: (...args: unknown[]) => getAudienceOptions(...args) as unknown,
    preview: (...args: unknown[]) => previewAudience(...args) as unknown,
  },
  eventService: {
    getModuleSettings: () =>
      Promise.resolve({
        request_pipeline: {
          tasks: [
            { id: 'review', label: 'Review Request', description: '' },
            { id: 'confirm', label: 'Confirm Date', description: '' },
          ],
        },
      }),
  },
  userService: {
    getUsers: () =>
      Promise.resolve([
        { id: 'u2', first_name: 'Sam', last_name: 'Ortiz', rank: 'fire_chief', status: 'active' },
        { id: 'u3', first_name: 'Lee', last_name: 'Park', status: 'archived' },
      ]),
  },
  locationsService: { getLocations: () => Promise.resolve([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    formatRank: (code: string | null | undefined) => (code === 'fire_chief' ? 'Fire Chief' : (code ?? '')),
  }),
}));

import { ConfirmProvider } from '../contexts/ConfirmContext';
import { useAuthStore } from '../stores/authStore';
import type { CurrentUser } from '../types/auth';
import EventRequestsTab from './EventRequestsTab';
import EventRequestPage from './EventRequestPage';

/**
 * The board with the request page routed beside it, as the app has them, so a
 * click on a row really navigates. A request opens as a page (owner decision,
 * 2026-11-21), which these tests find as the `article` named by its heading.
 */
const renderBoard = (initialPath = '/events/admin') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ConfirmProvider>
        <Routes>
          <Route path="/events/admin" element={<EventRequestsTab />} />
          <Route path="/events/admin/requests/:requestId" element={<EventRequestPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

const request = {
  id: 'req-1',
  contact_name: 'Pat Requester',
  contact_email: 'pat@example.com',
  outreach_type: 'station_tour',
  status: 'in_progress',
  description: 'A tour for a scout troop.',
  task_completions: { review: { completed: true, completed_by: 'u1', completed_at: '2026-09-29T00:00:00Z' } },
  created_at: '2026-09-28T00:00:00Z',
};

describe('EventRequestsTab pipeline tasks', () => {
  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    listRequests.mockResolvedValue([request]);
    getRequest.mockResolvedValue({ ...request, activity_log: [] });
  });

  it('says which tasks are done, not only with an icon', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));

    // The checklist lives in the drawer; the row behind it also names the next
    // step ("Next: Confirm Date"), so the lookup is scoped to the dialog.
    const drawer = await screen.findByRole('article', { name: 'Pat Requester' });
    expect(await within(drawer).findByRole('button', { name: /Review Request/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(drawer).getByRole('button', { name: /Confirm Date/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names a coordinator by their rank, not its code', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'Assign' }));

    expect(screen.getByRole('option', { name: 'Sam Ortiz — Fire Chief' })).toBeInTheDocument();
  });

  it('does not offer a former member as coordinator', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'Assign' }));

    expect(screen.getByRole('option', { name: 'Sam Ortiz — Fire Chief' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Lee Park/ })).not.toBeInTheDocument();
  });
});

// The request queue reads as "nothing to handle" when empty, so a 200 whose
// body is not a list (a captive portal's HTML page) must show the tab's error
// rather than an empty queue — and must not crash on `requests.reduce`, which
// took the whole Events hub down.
describe('EventRequestsTab with a malformed request list', () => {
  beforeEach(() => {
    listRequests.mockReset();
    listRequests.mockResolvedValue('<html>Sign in to Wi-Fi</html>');
    getRequest.mockReset();
  });

  it('shows its load error', async () => {
    renderBoard();

    expect(await screen.findByText('Failed to load event requests.')).toBeInTheDocument();
  });
});

describe('EventRequestsTab refusals', () => {
  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    postponeRequest.mockReset();
    toastError.mockReset();
    listRequests.mockResolvedValue([request]);
    getRequest.mockResolvedValue({ ...request, activity_log: [] });
  });

  it("shows the server's reason when a postpone is refused", async () => {
    // A closed event's attendance and a bad date are different fixes; the
    // coordinator can only tell which by reading the sentence.
    const detail = "This event's attendance has been finalized, so postponing it is not allowed.";
    postponeRequest.mockRejectedValue({ response: { status: 409, data: { detail } } });
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Postpone' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Postpone' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(detail));
  });

  it('falls back to a generic message when the server gave no reason', async () => {
    postponeRequest.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Postpone' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Postpone' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to postpone request.'));
  });
});

const ME: CurrentUser = {
  id: 'me',
  username: 'schen',
  email: 'schen@example.test',
  organization_id: 'org-1',
  timezone: 'America/New_York',
  roles: [],
  positions: [],
  rank: null,
  membership_type: null,
  permissions: ['events.manage'],
  is_active: true,
  email_verified: true,
  mfa_enabled: true,
  password_expired: false,
  must_change_password: false,
};

const daysFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

const QUEUE = [
  {
    ...request,
    id: 'new-1',
    contact_name: 'Maria Lopez',
    organization_name: 'Oakville Elementary',
    status: 'submitted',
    task_completions: {},
    date_flexibility: 'specific_dates',
    preferred_date_start: daysFromNow(4),
    short_notice: true,
    created_at: daysFromNow(-3),
  },
  {
    ...request,
    id: 'work-1',
    contact_name: 'Tom Becker',
    organization_name: 'Maple Street HOA',
    assigned_to: 'me',
    assignee_name: 'Lt. Sarah Chen',
  },
  {
    ...request,
    id: 'sched-1',
    contact_name: 'Kevin Wu',
    organization_name: 'Scout Troop 12',
    status: 'scheduled',
    assigned_to: 'u2',
    assignee_name: 'Sam Ortiz',
    event_date: daysFromNow(3),
    staffing_slots_filled: 4,
    staffing_slots_total: 6,
  },
  { ...request, id: 'done-1', contact_name: 'Greg Holt', organization_name: 'Holt Auto Group', status: 'completed' },
];

describe('EventRequestsTab triage list', () => {
  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    assignRequest.mockReset();
    updateRequestStatus.mockReset();
    listRequests.mockResolvedValue(QUEUE);
    getRequest.mockImplementation((id: string) =>
      Promise.resolve({ ...QUEUE.find((r) => r.id === id), activity_log: [] })
    );
    assignRequest.mockResolvedValue({ message: 'ok', assigned_to: 'me', assignee_name: 'Lt. Sarah Chen' });
    updateRequestStatus.mockResolvedValue({ message: 'ok', status: 'declined' });
    useAuthStore.setState({ user: ME });
  });

  it('groups open requests by what needs doing and folds the closed ones away', async () => {
    const user = userEvent.setup();
    renderBoard();

    const reply = await screen.findByRole('region', { name: 'Needs a reply' });
    expect(within(reply).getByText('Oakville Elementary')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'In progress' })).getByText('Maple Street HOA')
    ).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Scheduled' })).getByText('Scout Troop 12')).toBeInTheDocument();

    const closedToggle = screen.getByRole('button', { name: /Closed \(1\)/ });
    expect(closedToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Holt Auto Group')).not.toBeInTheDocument();
    await user.click(closedToggle);
    expect(screen.getByText('Holt Auto Group')).toBeInTheDocument();
  });

  it('shows the short-notice flag, the countdown and volunteer coverage on the row', async () => {
    renderBoard();

    const reply = await screen.findByRole('region', { name: 'Needs a reply' });
    expect(within(reply).getByText('Short notice')).toBeInTheDocument();
    expect(within(reply).getByText('in 4 days')).toBeInTheDocument();
    expect(within(reply).getByText('Unassigned')).toBeInTheDocument();

    const scheduled = screen.getByRole('region', { name: 'Scheduled' });
    expect(within(scheduled).getByText('4 of 6 signed up')).toBeInTheDocument();
    expect(within(scheduled).getByText(/Find 2 more volunteers/)).toBeInTheDocument();
  });

  it('takes an unassigned request for the signed-in member', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: 'Take it: Oakville Elementary' }));

    await waitFor(() => expect(assignRequest).toHaveBeenCalledWith('new-1', { assigned_to: 'me' }));
    // The board stays: taking a request from the list is not opening it.
    expect(getRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('offers Take it only on an unassigned new request', async () => {
    renderBoard();

    await screen.findByRole('region', { name: 'Needs a reply' });
    expect(screen.getAllByRole('button', { name: /^Take / })).toHaveLength(1);
  });

  it('narrows to my requests, and to a search', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: 'Mine' }));
    expect(screen.getByText('Maple Street HOA')).toBeInTheDocument();
    expect(screen.queryByText('Oakville Elementary')).not.toBeInTheDocument();
    expect(screen.queryByText('Scout Troop 12')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'scout');
    expect(screen.getByText('Scout Troop 12')).toBeInTheDocument();
    expect(screen.queryByText('Maple Street HOA')).not.toBeInTheDocument();
  });

  it('says so when nothing open matches, rather than showing an empty page', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.type(await screen.findByRole('searchbox', { name: 'Search requests' }), 'library');

    expect(screen.getByText(/No open requests match/)).toBeInTheDocument();
  });

  it('opens a request on its own page that leads with its next action', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /^Oakville Elementary/ }));

    const page = await screen.findByRole('article', { name: 'Oakville Elementary' });
    expect(within(page).getByRole('heading', { level: 1, name: 'Oakville Elementary' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: 'Take it' })).toBeInTheDocument();
    expect(within(page).getByText('Assign a coordinator')).toBeInTheDocument();
    // The board is gone, not hidden behind a panel.
    expect(screen.queryByRole('region', { name: 'Needs a reply' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'All requests' }));
    expect(await screen.findByRole('region', { name: 'Needs a reply' })).toBeInTheDocument();
  });

  it('opens straight onto a request from its address', async () => {
    renderBoard('/events/admin/requests/work-1');

    expect(await screen.findByRole('article', { name: 'Maple Street HOA' })).toBeInTheDocument();
    expect(getRequest).toHaveBeenCalledWith('work-1');
    // A request page loads one request, not the whole board.
    expect(listRequests).not.toHaveBeenCalled();
  });

  it('says so when the request cannot be loaded', async () => {
    getRequest.mockRejectedValue(new Error('Not found'));
    renderBoard('/events/admin/requests/gone');

    expect(await screen.findByRole('heading', { level: 1, name: 'Request not available' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All requests' })).toBeInTheDocument();
  });

  it('declines through a dialog that carries the reason to the requester', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /^Maple Street HOA/ }));
    const drawer = await screen.findByRole('article', { name: 'Maple Street HOA' });
    await user.click(within(drawer).getByRole('button', { name: 'More' }));
    await user.click(within(drawer).getByRole('button', { name: 'Decline…' }));

    await user.type(await screen.findByRole('textbox', { name: /Reason/ }), 'No crew that weekend');
    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    await waitFor(() =>
      expect(updateRequestStatus).toHaveBeenCalledWith('work-1', {
        status: 'declined',
        notes: undefined,
        decline_reason: 'No crew that weekend',
      })
    );
  });

  it('asks before cancelling, and keeps the request on Keep it', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /^Maple Street HOA/ }));
    const drawer = await screen.findByRole('article', { name: 'Maple Street HOA' });
    await user.click(within(drawer).getByRole('button', { name: 'More' }));
    await user.click(within(drawer).getByRole('button', { name: 'Cancel Request' }));

    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(updateRequestStatus).not.toHaveBeenCalled();
  });
});

/** Answer every min-width query against a real pixel width (CLAUDE.md pitfall #28a). */
const mockViewportWidth = (width: number) => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: (() => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query);
      return minWidth ? width >= Number(minWidth[1]) : false;
    })(),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('EventRequestsTab at desktop width', () => {
  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    listRequests.mockResolvedValue(QUEUE);
    getRequest.mockImplementation((id: string) =>
      Promise.resolve({ ...QUEUE.find((r) => r.id === id), activity_log: [] })
    );
    useAuthStore.setState({ user: ME });
    mockViewportWidth(1280);
  });

  afterEach(() => {
    // Back to the phone default src/test/setup.ts installs, where every
    // min-width query answers false. This used to hand the mock its own
    // function as an implementation, so any test after this block recursed
    // until the stack ran out; it went unseen while the block came last.
    mockViewportWidth(0);
  });

  it("labels the request page's actions in words and keeps Take it beside the row", async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(await screen.findByRole('button', { name: 'Take it: Oakville Elementary' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Maple Street HOA/ }));
    const drawer = await screen.findByRole('article', { name: 'Maple Street HOA' });
    expect(within(drawer).getByRole('button', { name: 'Schedule event' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Email requester' })).toBeInTheDocument();
  });
});

describe('EventRequestsTab entering a request taken by phone', () => {
  const CREATED = {
    id: 'phone-1',
    contact_name: 'Pat Rivera',
    contact_email: null,
    contact_phone: '703-555-0142',
    outreach_type: 'station_tour',
    status: 'submitted',
    source: 'phone',
    description: 'Tour for a Cub Scout den.',
    venue_preference: 'their_location',
    date_flexibility: 'flexible',
    created_at: '2026-11-20T00:00:00Z',
    activity_log: [],
  };

  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    createRequest.mockReset();
    getOutreachTypeLabels.mockReset();
    listRequests.mockResolvedValue([]);
    getRequest.mockResolvedValue(CREATED);
    createRequest.mockResolvedValue(CREATED);
    getOutreachTypeLabels.mockResolvedValue({ station_tour: 'Station Tour', fire_safety_demo: 'Fire Safety Demo' });
  });

  afterEach(() => {
    // Back to the module default, so a block after this one does not inherit the types.
    getOutreachTypeLabels.mockReset();
    getOutreachTypeLabels.mockImplementation(() => Promise.resolve({}));
  });

  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    renderBoard();
    await user.click(await screen.findByRole('button', { name: 'New request' }));
    const dialog = await screen.findByRole('dialog', { name: 'New request' });
    // The types arrive with the tab's settings; wait for them in the picker.
    await within(dialog).findByRole('option', { name: 'Station Tour' });
    return dialog;
  };

  const fillRequired = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => {
    await user.type(within(dialog).getByLabelText(/Requester name/), 'Pat Rivera');
    await user.type(within(dialog).getByLabelText('Phone'), '703-555-0142');
    await user.selectOptions(within(dialog).getByLabelText(/Type of event/), 'station_tour');
    await user.type(within(dialog).getByLabelText(/What they asked for/), 'Tour for a Cub Scout den.');
  };

  it('opens straight into the dialog from ?new=1, and drops the flag once read', async () => {
    const LocationEcho = () => <output aria-label="Location">{useLocation().search}</output>;
    render(
      <MemoryRouter initialEntries={['/events/admin?tab=requests&new=1']}>
        <ConfirmProvider>
          <Routes>
            <Route
              path="/events/admin"
              element={
                <>
                  <EventRequestsTab />
                  <LocationEcho />
                </>
              }
            />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>
    );

    const dialog = await screen.findByRole('dialog', { name: 'New request' });
    expect(await within(dialog).findByRole('option', { name: 'Station Tour' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Location' })).toHaveTextContent('?tab=requests');
    expect(screen.getByRole('status', { name: 'Location' })).not.toHaveTextContent('new=1');
  });

  it('flags every missing field on its field and sends nothing', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Add request' }));

    expect(await within(dialog).findByText('Enter who the request is from.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a phone number or an email address.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose the type of event.')).toBeInTheDocument();
    expect(within(dialog).getByText('Note what they asked for.')).toBeInTheDocument();
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('files a phone-only request without asking for an email, then opens it', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await fillRequired(user, dialog);

    // No email, so there is nobody to send the confirmation to.
    const confirmation = within(dialog).getByRole('checkbox', { name: /Email the requester a confirmation/ });
    expect(confirmation).toBeDisabled();
    expect(confirmation).not.toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Add request' }));

    await waitFor(() =>
      expect(createRequest).toHaveBeenCalledWith({
        source: 'phone',
        contact_name: 'Pat Rivera',
        contact_phone: '703-555-0142',
        outreach_type: 'station_tour',
        description: 'Tour for a Cub Scout den.',
        date_flexibility: 'flexible',
        preferred_time_of_day: 'flexible',
        venue_preference: 'their_location',
        notify_requester: false,
      })
    );
    await waitFor(() => expect(getRequest).toHaveBeenCalledWith('phone-1'));
    expect(screen.queryByRole('dialog', { name: 'New request' })).not.toBeInTheDocument();
  });

  it('sends the confirmation by default once there is an email, and not once unticked', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await fillRequired(user, dialog);
    await user.selectOptions(within(dialog).getByLabelText('How it came in'), 'email');
    await user.type(within(dialog).getByLabelText('Email'), 'pat@example.org');

    const confirmation = within(dialog).getByRole('checkbox', { name: /Email the requester a confirmation/ });
    expect(confirmation).toBeEnabled();
    expect(confirmation).toBeChecked();
    await user.click(confirmation);
    await user.click(within(dialog).getByRole('button', { name: 'Add request' }));

    await waitFor(() => expect(createRequest).toHaveBeenCalledTimes(1));
    expect(createRequest.mock.calls[0]?.[0]).toMatchObject({
      source: 'email',
      contact_email: 'pat@example.org',
      notify_requester: false,
    });
  });

  it('sends the dates the caller named as plain calendar dates', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await fillRequired(user, dialog);
    await user.selectOptions(within(dialog).getByLabelText('Dates'), 'specific_dates');
    await user.type(within(dialog).getByLabelText(/Earliest date/), '2027-01-15');
    await user.type(within(dialog).getByLabelText(/Latest date/), '2027-01-29');
    await user.click(within(dialog).getByRole('button', { name: 'Add request' }));

    await waitFor(() => expect(createRequest).toHaveBeenCalledTimes(1));
    expect(createRequest.mock.calls[0]?.[0]).toMatchObject({
      date_flexibility: 'specific_dates',
      preferred_date_start: '2027-01-15',
      preferred_date_end: '2027-01-29',
    });
  });

  it('refuses a latest date before the earliest', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await fillRequired(user, dialog);
    await user.selectOptions(within(dialog).getByLabelText('Dates'), 'specific_dates');
    await user.type(within(dialog).getByLabelText(/Earliest date/), '2027-01-29');
    await user.type(within(dialog).getByLabelText(/Latest date/), '2027-01-15');
    await user.click(within(dialog).getByRole('button', { name: 'Add request' }));

    expect(await within(dialog).findByText('The latest date cannot be before the earliest.')).toBeInTheDocument();
    expect(createRequest).not.toHaveBeenCalled();
  });
});

describe('EventRequestsTab showing a request with no email', () => {
  const mailtoLinks = (scope: HTMLElement) =>
    within(scope)
      .queryAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('mailto:'));

  const PHONE_ONLY = {
    id: 'phone-1',
    contact_name: 'Pat Rivera',
    contact_email: null,
    contact_phone: '703-555-0142',
    outreach_type: 'station_tour',
    status: 'in_progress',
    source: 'phone',
    description: 'Tour for a Cub Scout den.',
    venue_preference: 'their_location',
    date_flexibility: 'flexible',
    created_at: '2026-11-20T00:00:00Z',
  };

  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    listRequests.mockResolvedValue([PHONE_ONLY]);
    getRequest.mockResolvedValue({
      ...PHONE_ONLY,
      activity_log: [
        {
          id: 'act-1',
          action: 'submitted',
          new_status: 'submitted',
          notes: 'Entered by Casey Morgan from a phone call',
          details: { source: 'phone' },
          performer_name: 'Casey Morgan',
          created_at: '2026-11-20T00:00:00Z',
        },
      ],
    });
  });

  it('says how it came in, and offers the phone rather than an email link', async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole('button', { name: /Pat Rivera/ }));
    const drawer = await screen.findByRole('article', { name: 'Pat Rivera' });

    expect(within(drawer).getByText('Came in by: Phone call')).toBeInTheDocument();
    expect(within(drawer).getByText('Entered by Casey Morgan from a phone call')).toBeInTheDocument();
    expect(within(drawer).getByText('No email given')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /703-555-0142/ })).toHaveAttribute('href', 'tel:703-555-0142');
    expect(within(drawer).queryByRole('link', { name: /email app/ })).not.toBeInTheDocument();
    expect(mailtoLinks(drawer)).toHaveLength(0);

    await user.click(within(drawer).getByRole('button', { name: 'Email requester' }));
    expect(within(drawer).getByText(/gave no email address\. Call them on 703-555-0142 instead\./)).toBeInTheDocument();
    expect(mailtoLinks(drawer)).toHaveLength(0);
  });
});

describe('EventRequestsTab completing a scheduled request', () => {
  const scheduled = (eventDate: string) => ({
    id: 'sched-1',
    contact_name: 'Dana Whitfield',
    contact_email: 'dana@example.org',
    organization_name: 'Oakwood Library',
    outreach_type: 'station_tour',
    status: 'scheduled',
    description: 'Summer reading visit.',
    venue_preference: 'our_station',
    date_flexibility: 'flexible',
    event_date: eventDate,
    created_at: '2026-11-01T00:00:00Z',
    activity_log: [],
  });

  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    listRequests.mockResolvedValue([]);
  });

  it('does not offer Mark completed before the event has happened', async () => {
    getRequest.mockResolvedValue(scheduled(new Date(Date.now() + 2 * 86_400_000).toISOString()));
    renderBoard('/events/admin/requests/sched-1');

    const page = await screen.findByRole('article', { name: 'Oakwood Library' });
    expect(within(page).queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
  });

  it('offers it once the event date has passed', async () => {
    getRequest.mockResolvedValue(scheduled(new Date(Date.now() - 2 * 86_400_000).toISOString()));
    renderBoard('/events/admin/requests/sched-1');

    const page = await screen.findByRole('article', { name: 'Oakwood Library' });
    expect(within(page).getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });
});

describe('EventRequestsTab volunteer call', () => {
  beforeEach(() => {
    for (const mock of [listRequests, getRequest, sendVolunteerCall, getAudienceOptions, previewAudience]) {
      mock.mockReset();
    }
    listRequests.mockResolvedValue([]);
    getRequest.mockResolvedValue({
      id: 'sched-1',
      contact_name: 'Kevin Wu',
      contact_email: 'kwu@example.org',
      organization_name: 'Scout Troop 12',
      outreach_type: 'station_tour',
      status: 'scheduled',
      description: 'A station tour.',
      date_flexibility: 'flexible',
      event_date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      created_at: '2026-11-01T00:00:00Z',
      activity_log: [],
    });
    getAudienceOptions.mockResolvedValue({
      member_classes: ['operational', 'administrative', 'social'],
      member_statuses: [{ value: 'regular', label: null }],
      positions: [{ id: 'pos-lt', name: 'Lieutenant' }],
    });
    previewAudience.mockResolvedValue({ recipients: 7, skipped_opted_out: 0 });
    sendVolunteerCall.mockResolvedValue({ message: 'Volunteer call emailed to 7 members.', recipients: 7 });
    useAuthStore.setState({ user: ME });
  });

  it('asks only the members the coordinator chose', async () => {
    const user = userEvent.setup();
    renderBoard('/events/admin/requests/sched-1');

    const page = await screen.findByRole('article', { name: 'Scout Troop 12' });
    await user.click(within(page).getByRole('button', { name: /Email the Membership/ }));
    await user.click(await within(page).findByRole('checkbox', { name: 'Lieutenant' }));
    expect(await within(page).findByText('7 members will be emailed')).toBeInTheDocument();
    await user.click(within(page).getByRole('button', { name: /Send Request for Help/ }));

    await waitFor(() =>
      expect(sendVolunteerCall).toHaveBeenCalledWith('sched-1', {
        member_classes: [],
        member_statuses: [],
        position_ids: ['pos-lt'],
        message: undefined,
      })
    );
  });
});

describe('EventRequestsTab scheduling a request', () => {
  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    scheduleRequest.mockReset();
    listRequests.mockResolvedValue([request]);
    getRequest.mockResolvedValue({ ...request, activity_log: [] });
    scheduleRequest.mockResolvedValue({ ...request, status: 'scheduled' });
  });

  const openScheduleForm = async (user: ReturnType<typeof userEvent.setup>) => {
    renderBoard();
    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    const page = await screen.findByRole('article', { name: /Pat Requester/ });
    await user.click(within(page).getByRole('button', { name: 'Schedule event' }));
    return page;
  };

  it("offers the event form's quick durations once there is a start", async () => {
    const user = userEvent.setup();
    const page = await openScheduleForm(user);
    const durations = within(page).getByRole('group', { name: 'Quick Duration' });
    const names = within(durations)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['1 hour', '2 hours', '4 hours', '8 hours']);
    for (const button of within(durations).getAllByRole('button')) expect(button).toBeDisabled();

    await user.type(within(page).getByLabelText('Start Date & Time *'), '2026-11-25');
    expect(within(durations).getByRole('button', { name: '2 hours' })).toBeEnabled();
  });

  it("sets the end from the start, in the department's time zone, and sends it", async () => {
    const user = userEvent.setup();
    const page = await openScheduleForm(user);

    // The date picker defaults the time to 9:00 AM.
    await user.type(within(page).getByLabelText('Start Date & Time *'), '2026-11-25');
    await user.click(within(page).getByRole('button', { name: '2 hours' }));

    expect(within(page).getByLabelText('End Date & Time')).toHaveValue('2026-11-25');
    await user.click(within(page).getByRole('button', { name: 'Confirm & Create Calendar Event' }));

    await waitFor(() => expect(scheduleRequest).toHaveBeenCalled());
    // 9:00 and 11:00 America/New_York are 14:00 and 16:00 UTC in November.
    expect(scheduleRequest).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({
        event_date: '2026-11-25T14:00:00.000Z',
        event_end_date: '2026-11-25T16:00:00.000Z',
      })
    );
  });

  it('crosses midnight when the duration runs past it', async () => {
    const user = userEvent.setup();
    const page = await openScheduleForm(user);
    await user.type(within(page).getByLabelText('Start Date & Time *'), '2026-11-25');
    await user.selectOptions(within(page).getByRole('combobox', { name: /Start time hour/ }), '8');
    await user.selectOptions(within(page).getByRole('combobox', { name: /Start time AM\/PM|Start time period/ }), 'PM');
    await user.click(within(page).getByRole('button', { name: '8 hours' }));
    expect(within(page).getByLabelText('End Date & Time')).toHaveValue('2026-11-26');
  });
});
