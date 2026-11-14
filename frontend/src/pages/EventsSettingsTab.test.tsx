import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';

const getModuleSettings = vi.fn();
const getForms = vi.fn();
const createEmailTemplate = vi.fn();
const listEmailTemplates = vi.fn();
const deleteEmailTemplate = vi.fn();
const getUsers = vi.fn();

vi.mock('../services/api', () => ({
  eventService: {
    getModuleSettings: (...args: unknown[]) => getModuleSettings(...args) as unknown,
    updateModuleSettings: vi.fn(),
  },
  eventRequestService: {
    listEmailTemplates: (...args: unknown[]) => listEmailTemplates(...args) as unknown,
    deleteEmailTemplate: (...args: unknown[]) => deleteEmailTemplate(...args) as unknown,
    getForms: (...args: unknown[]) => getForms(...args) as unknown,
    createEmailTemplate: (...args: unknown[]) => createEmailTemplate(...args) as unknown,
  },
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { renderWithRouter } from '../test/utils';
import EventsSettingsTab from './EventsSettingsTab';

/**
 * Opens one page of the Public Requests section. Scoped to the section's page
 * rail because the overview's step list carries buttons with the same names.
 */
const openRequestsPage = async (user: ReturnType<typeof userEvent.setup>, page: RegExp) => {
  await user.click(screen.getByRole('button', { name: 'Public Requests' }));
  const rail = await screen.findByRole('navigation', { name: 'Public Requests pages' });
  await user.click(within(rail).getByRole('button', { name: page }));
};

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
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
    listEmailTemplates.mockReset();
    listEmailTemplates.mockResolvedValue([]);
    deleteEmailTemplate.mockReset();
    deleteEmailTemplate.mockResolvedValue({ message: 'Template deleted' });
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
  // rather than taking the Request form page down.
  it('renders the Request form page when the forms list is malformed', async () => {
    getForms.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithRouter(<EventsSettingsTab />);

    await screen.findByRole('heading', { name: 'Event Settings' });
    await openRequestsPage(user, /^Request form/);
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
    await openRequestsPage(user, /^Handling/);

    expect(await screen.findByRole('button', { name: 'Move "Review Request" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "Review Request" down' })).toBeDisabled();
  });

  describe('public requests section', () => {
    it('groups every request setting under one section that opens on its overview', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });

      const sections = screen.getByRole('navigation', { name: 'Event settings sections' });
      for (const retired of ['Pipeline', 'Email', 'Public Form', 'Outreach Types']) {
        expect(within(sections).queryByRole('button', { name: retired })).not.toBeInTheDocument();
      }

      await user.click(within(sections).getByRole('button', { name: 'Public Requests' }));

      expect(await screen.findByRole('heading', { name: 'Public Event Requests' })).toBeInTheDocument();
      const rail = screen.getByRole('navigation', { name: 'Public Requests pages' });
      expect(
        within(rail)
          .getAllByRole('button')
          .map((b) => b.firstChild?.textContent)
      ).toEqual(['Overview', 'Request form', 'Types & roles', 'Handling', 'Emails']);
      expect(within(rail).getByRole('button', { name: /^Overview/ })).toHaveAttribute('aria-current', 'page');
    });

    it('shows the intake switch on the overview and keeps it off the handling page', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Overview/);

      expect(screen.getByRole('switch', { name: 'Accept public event requests' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      expect(screen.getByRole('spinbutton', { name: 'Minimum Lead Time' })).toHaveValue(21);

      const rail = screen.getByRole('navigation', { name: 'Public Requests pages' });
      await user.click(within(rail).getByRole('button', { name: /^Handling/ }));
      expect(await screen.findByRole('heading', { name: 'Request Handling' })).toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Accept public event requests' })).not.toBeInTheDocument();
    });

    it('reports each step from the stored settings and opens its page', async () => {
      getForms.mockResolvedValue({
        forms: [{ id: 'f1', name: 'Request an event', status: 'draft', is_public: true }],
        total: 1,
        skip: 0,
        limit: 50,
      });
      const user = userEvent.setup();
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Overview/);

      const steps = screen.getByRole('list');
      expect(await within(steps).findByText('1 in draft, not yet published')).toBeInTheDocument();
      expect(within(steps).getByText('1 types · 0 roles')).toBeInTheDocument();
      expect(within(steps).getByText('No default coordinator · 1 checklist step')).toBeInTheDocument();
      expect(within(steps).getByText('0 automatic emails on · 0 templates')).toBeInTheDocument();

      await user.click(within(steps).getByRole('button', { name: /^Emails/ }));
      expect(await screen.findByRole('heading', { name: 'Request Emails' })).toBeInTheDocument();
      const rail = screen.getByRole('navigation', { name: 'Public Requests pages' });
      expect(within(rail).getByRole('button', { name: /^Emails/ })).toHaveAttribute('aria-current', 'page');
    });

    // A request with nobody assigned sits until someone notices it, so a
    // missing coordinator leaves the Handling step unfinished even with a
    // checklist in place.
    it('marks Handling unfinished until a default coordinator is set', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Overview/);

      expect(screen.getByText('No default coordinator · 1 checklist step')).toHaveClass('text-amber-800');
    });

    it('marks Handling done once a coordinator and a checklist are set', async () => {
      getModuleSettings.mockResolvedValue({
        ...structuredClone(settings),
        request_pipeline: { ...structuredClone(settings.request_pipeline), default_assignee_id: 'u1' },
      });
      getUsers.mockResolvedValue([{ id: 'u1', first_name: 'Jordan', last_name: 'Avery' }]);
      const user = userEvent.setup();
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Overview/);

      expect(screen.getByText('Jordan Avery · 1 checklist step')).toHaveClass('text-green-800');
    });

    it('returns to the overview when the section is left and reopened', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Handling/);
      await user.click(screen.getByRole('button', { name: 'Categories' }));
      await user.click(screen.getByRole('button', { name: 'Public Requests' }));

      expect(await screen.findByRole('heading', { name: 'Public Event Requests' })).toBeInTheDocument();
    });
  });

  describe('email templates', () => {
    beforeEach(() => {
      createEmailTemplate.mockReset();
      createEmailTemplate.mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve({ id: 'tpl-1', is_active: 1, created_at: '', updated_at: '', ...data })
      );
      vi.mocked(toast.error).mockReset();
    });

    const openTemplateForm = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Emails/);
      await user.click(await screen.findByRole('button', { name: 'New Template' }));
      await user.type(screen.getByPlaceholderText(/Template name/), 'One week out');
      await user.type(screen.getByPlaceholderText('Email subject'), 'Your event is next week');
      await user.type(screen.getByPlaceholderText(/Email body/), '<p>See you soon</p>');
    };

    // The reminder task matches days_before_event templates by
    // trigger_days_before alone; one saved without it never fired.
    it('sends the days-before offset with a days-before-event template', async () => {
      const user = userEvent.setup();
      await openTemplateForm(user);

      expect(screen.queryByRole('spinbutton', { name: 'Days before event' })).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText('Send automatically'), 'days_before_event');
      const days = screen.getByRole('spinbutton', { name: 'Days before event' });
      expect(days).toBeRequired();
      await user.type(days, '7');
      await user.click(screen.getByRole('button', { name: 'Save Template' }));

      await waitFor(() => expect(createEmailTemplate).toHaveBeenCalledTimes(1));
      expect(createEmailTemplate).toHaveBeenCalledWith({
        name: 'One week out',
        subject: 'Your event is next week',
        body_html: '<p>See you soon</p>',
        trigger: 'days_before_event',
        trigger_days_before: 7,
      });
    });

    const refusal = 'Enter how many days before the event to send it, as a whole number from 1 to 90.';

    it('refuses to save a days-before template with the days left blank', async () => {
      const user = userEvent.setup();
      await openTemplateForm(user);

      await user.selectOptions(screen.getByLabelText('Send automatically'), 'days_before_event');
      await user.click(screen.getByRole('button', { name: 'Save Template' }));

      expect(createEmailTemplate).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(refusal);
    });

    it.each(['0', '91', '2.5'])('refuses to save a days-before template with %j days', async (value) => {
      const user = userEvent.setup();
      await openTemplateForm(user);

      await user.selectOptions(screen.getByLabelText('Send automatically'), 'days_before_event');
      await user.type(screen.getByRole('spinbutton', { name: 'Days before event' }), value);
      await user.click(screen.getByRole('button', { name: 'Save Template' }));

      expect(createEmailTemplate).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(refusal);
    });

    it('drops the offset once the trigger moves off days-before-event', async () => {
      const user = userEvent.setup();
      await openTemplateForm(user);

      await user.selectOptions(screen.getByLabelText('Send automatically'), 'days_before_event');
      await user.type(screen.getByRole('spinbutton', { name: 'Days before event' }), '3');
      await user.selectOptions(screen.getByLabelText('Send automatically'), 'on_scheduled');
      await user.click(screen.getByRole('button', { name: 'Save Template' }));

      await waitFor(() => expect(createEmailTemplate).toHaveBeenCalledTimes(1));
      const payload = createEmailTemplate.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.trigger).toBe('on_scheduled');
      expect(payload.trigger_days_before).toBeUndefined();
    });
  });

  describe('deleting an email template', () => {
    const template = {
      id: 'tpl-9',
      name: 'Request received',
      subject: 'We got your request',
      body_html: '<p>Thanks</p>',
      is_active: true,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    };

    beforeEach(() => {
      listEmailTemplates.mockReset();
      listEmailTemplates.mockResolvedValue([structuredClone(template)]);
    });

    const openEmailSection = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithRouter(<EventsSettingsTab />);
      await screen.findByRole('heading', { name: 'Event Settings' });
      await openRequestsPage(user, /^Emails/);
      await screen.findByText('Request received');
    };

    it('asks first, naming the template, and keeps it on cancel', async () => {
      const user = userEvent.setup();
      await openEmailSection(user);

      await user.click(screen.getByRole('button', { name: 'Delete "Request received"' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete email template "Request received"?' });
      expect(dialog).toHaveTextContent('Emails already sent are unaffected');
      await user.click(screen.getByRole('button', { name: 'Keep it' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(deleteEmailTemplate).not.toHaveBeenCalled();
      expect(screen.getByText('Request received')).toBeInTheDocument();
    });

    it('deletes the template once confirmed', async () => {
      const user = userEvent.setup();
      await openEmailSection(user);

      await user.click(screen.getByRole('button', { name: 'Delete "Request received"' }));
      await user.click(await screen.findByRole('button', { name: 'Delete template' }));

      await waitFor(() => expect(deleteEmailTemplate).toHaveBeenCalledWith('tpl-9'));
      await waitFor(() => expect(screen.queryByText('Request received')).not.toBeInTheDocument());
    });
  });
});
