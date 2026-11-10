import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listRequests = vi.fn();
const getRequest = vi.fn();
const postponeRequest = vi.fn();
const assignRequest = vi.fn();
const updateRequestStatus = vi.fn();
const toastError = vi.fn();

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
    getOutreachTypeLabels: () => Promise.resolve({}),
    listEmailTemplates: () => Promise.resolve([]),
    getOutreachRoles: () => Promise.resolve([]),
    getStaffing: () => Promise.resolve(null),
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
    getUsers: () => Promise.resolve([{ id: 'u2', first_name: 'Sam', last_name: 'Ortiz', rank: 'fire_chief' }]),
  },
  locationsService: { getLocations: () => Promise.resolve([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    formatRank: (code: string | null | undefined) => (code === 'fire_chief' ? 'Fire Chief' : (code ?? '')),
  }),
}));

import { renderWithRouter } from '../test/utils';
import { useAuthStore } from '../stores/authStore';
import type { CurrentUser } from '../types/auth';
import EventRequestsTab from './EventRequestsTab';

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
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));

    // The checklist lives in the drawer; the row behind it also names the next
    // step ("Next: Confirm Date"), so the lookup is scoped to the dialog.
    const drawer = await screen.findByRole('dialog', { name: 'Pat Requester' });
    expect(await within(drawer).findByRole('button', { name: /Review Request/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(drawer).getByRole('button', { name: /Confirm Date/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names a coordinator by their rank, not its code', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'Assign' }));

    expect(screen.getByRole('option', { name: 'Sam Ortiz — Fire Chief' })).toBeInTheDocument();
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
    renderWithRouter(<EventRequestsTab />);

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
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Postpone' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Postpone' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(detail));
  });

  it('falls back to a generic message when the server gave no reason', async () => {
    postponeRequest.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    renderWithRouter(<EventRequestsTab />);

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
    renderWithRouter(<EventRequestsTab />);

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
    renderWithRouter(<EventRequestsTab />);

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
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: 'Take it: Oakville Elementary' }));

    await waitFor(() => expect(assignRequest).toHaveBeenCalledWith('new-1', { assigned_to: 'me' }));
    // The drawer stays closed: taking a request from the list is not opening it.
    expect(getRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers Take it only on an unassigned new request', async () => {
    renderWithRouter(<EventRequestsTab />);

    await screen.findByRole('region', { name: 'Needs a reply' });
    expect(screen.getAllByRole('button', { name: /^Take / })).toHaveLength(1);
  });

  it('narrows to my requests, and to a search', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventRequestsTab />);

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
    renderWithRouter(<EventRequestsTab />);

    await user.type(await screen.findByRole('searchbox', { name: 'Search requests' }), 'library');

    expect(screen.getByText(/No open requests match/)).toBeInTheDocument();
  });

  it('opens a request as a dialog that leads with its next action', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /^Oakville Elementary/ }));

    const drawer = await screen.findByRole('dialog', { name: 'Oakville Elementary' });
    expect(within(drawer).getByRole('button', { name: 'Take it' })).toBeInTheDocument();
    expect(within(drawer).getByText('Assign a coordinator')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('declines through a dialog that carries the reason to the requester', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /^Maple Street HOA/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Maple Street HOA' });
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
    renderWithRouter(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /^Maple Street HOA/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Maple Street HOA' });
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
  const phoneMatchMedia = window.matchMedia;

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
    vi.mocked(window.matchMedia).mockImplementation(phoneMatchMedia);
  });

  it('labels the drawer actions in words and keeps Take it beside the row', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventRequestsTab />);

    expect(await screen.findByRole('button', { name: 'Take it: Oakville Elementary' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Maple Street HOA/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Maple Street HOA' });
    expect(within(drawer).getByRole('button', { name: 'Schedule event' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Email requester' })).toBeInTheDocument();
  });
});
