import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getModuleSettings = vi.fn();
const getForms = vi.fn();

vi.mock('../services/api', () => ({
  eventService: {
    getModuleSettings: (...args: unknown[]) => getModuleSettings(...args) as unknown,
    updateModuleSettings: vi.fn(),
  },
  eventRequestService: {
    listEmailTemplates: () => Promise.resolve([]),
    getForms: (...args: unknown[]) => getForms(...args) as unknown,
  },
  userService: { getUsers: () => Promise.resolve([]) },
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { renderWithRouter } from '../test/utils';
import EventsSettingsTab from './EventsSettingsTab';

const settings = {
  enabled_event_types: ['training', 'other'],
  visible_event_types: ['training', 'other'],
  event_type_labels: {},
  custom_event_categories: [
    { value: 'auxiliary_fundraising_dinner', label: 'Auxiliary Fundraising Dinner', color: 'bg-green-100' },
  ],
  visible_custom_categories: [],
  outreach_event_types: [{ value: 'other', label: 'Other' }],
  outreach_roles: [],
  request_pipeline: {
    min_lead_time_days: 21,
    default_assignee_id: null,
    public_progress_visible: false,
    accept_public_requests: false,
    public_daily_limit: 50,
    tasks: [{ id: 'review_request', label: 'Review Request', description: 'Review the incoming request details' }],
    email_triggers: {},
  },
  defaults: { attendee_visibility: 'managers' },
};

describe('EventsSettingsTab', () => {
  beforeEach(() => {
    getModuleSettings.mockReset();
    getModuleSettings.mockResolvedValue(structuredClone(settings));
    getForms.mockReset();
    getForms.mockResolvedValue({ forms: [], total: 0, skip: 0, limit: 50 });
  });

  // A 200 that is not a settings object — a captive portal's HTML page — used
  // to crash the whole hub through the ErrorBoundary on the first section. An
  // empty list would be no better: it reads as "nothing is visible", a claim
  // about the department an admin might act on.
  it('shows its load error for a response that is not a settings object', async () => {
    getModuleSettings.mockResolvedValue('<html>Sign in to Wi-Fi</html>');
    renderWithRouter(<EventsSettingsTab />);

    expect(await screen.findByText('Failed to load event settings.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event Settings' })).not.toBeInTheDocument();
  });

  // The forms list is supplemental, so a malformed one degrades to empty
  // rather than taking the Public Form section down.
  it('renders the Public Form section when the forms list is malformed', async () => {
    getForms.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithRouter(<EventsSettingsTab />);

    await screen.findByRole('heading', { name: 'Event Settings' });
    await user.click(screen.getByRole('button', { name: 'Public Form' }));
    expect(await screen.findByRole('button', { name: /View all forms/ })).toBeInTheDocument();
  });

  // An unbroken slug pushed the remove button out of a 320px card. The slug
  // must be allowed to break, and the button must neither shrink nor fall
  // below the phone touch minimum.
  it('lets a long category slug wrap without squeezing its remove button', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventsSettingsTab />);

    await screen.findByRole('heading', { name: 'Event Settings' });
    await user.click(screen.getByRole('button', { name: 'Categories' }));

    expect(await screen.findByText('auxiliary_fundraising_dinner')).toHaveClass('break-all', 'min-w-0');
    expect(screen.getByTitle('Remove "Auxiliary Fundraising Dinner"')).toHaveClass('touch-target-phone', 'shrink-0');
  });

  it('names the pipeline reorder controls for assistive technology', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventsSettingsTab />);

    await screen.findByRole('heading', { name: 'Event Settings' });
    await user.click(screen.getByRole('button', { name: 'Pipeline' }));

    expect(await screen.findByRole('button', { name: 'Move "Review Request" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "Review Request" down' })).toBeDisabled();
  });
});
