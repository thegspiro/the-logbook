import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';

const getModuleSettings = vi.fn();
const getForms = vi.fn();
const createEmailTemplate = vi.fn();

vi.mock('../services/api', () => ({
  eventService: {
    getModuleSettings: (...args: unknown[]) => getModuleSettings(...args) as unknown,
    updateModuleSettings: vi.fn(),
  },
  eventRequestService: {
    listEmailTemplates: () => Promise.resolve([]),
    getForms: (...args: unknown[]) => getForms(...args) as unknown,
    createEmailTemplate: (...args: unknown[]) => createEmailTemplate(...args) as unknown,
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
      await user.click(screen.getByRole('button', { name: 'Email' }));
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
});
