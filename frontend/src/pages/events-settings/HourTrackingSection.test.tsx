import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventHourMapping, AdminHoursCategory } from '../../modules/admin-hours/types';
import type { EventModuleSettings } from '../../types/event';

const mockListMappings = vi.fn();
const mockListCategories = vi.fn();
const mockCreateMapping = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../modules/admin-hours/services/api', () => ({
  eventHourMappingService: {
    list: (...args: unknown[]) => mockListMappings(...args) as unknown,
    create: (...args: unknown[]) => mockCreateMapping(...args) as unknown,
    delete: vi.fn(),
  },
  adminHoursCategoryService: {
    list: (...args: unknown[]) => mockListCategories(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

// Import the component AFTER mocks are in place
import HourTrackingSection from './HourTrackingSection';

const settings: EventModuleSettings = {
  enabled_event_types: [],
  visible_event_types: [],
  event_type_labels: {},
  custom_event_categories: [],
  visible_custom_categories: [],
  defaults: {
    event_type: 'business_meeting',
    check_in_window_type: 'flexible',
    check_in_minutes_before: 30,
    check_in_minutes_after: 30,
    require_checkout: false,
    requires_rsvp: false,
    allowed_rsvp_statuses: [],
    allow_guests: false,
    attendee_visibility: 'managers',
    is_mandatory: false,
    send_reminders: false,
    reminder_target: 'going',
    reminder_schedule: [],
    default_reminder_time: '09:00',
    default_duration_minutes: 60,
  },
  qr_code: { show_event_description: true, show_location_details: true, custom_instructions: '' },
  cancellation: { require_reason: false, notify_attendees: false },
  outreach_event_types: [],
  outreach_roles: [],
  request_pipeline: {
    min_lead_time_days: 14,
    default_assignee_id: null,
    public_progress_visible: false,
    accept_public_requests: false,
    public_daily_limit: 10,
    tasks: [],
    email_triggers: {},
  },
  attendance_request_fallback_positions: {},
};

const category: AdminHoursCategory = {
  id: 'cat-1',
  organizationId: 'org-1',
  name: 'Professional Development',
  description: null,
  color: '#2563eb',
  requireApproval: false,
  autoApproveUnderHours: null,
  maxHoursPerSession: null,
  isActive: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// As a server that predates inEffect / notInEffectReason serves it.
const legacyMapping: EventHourMapping = {
  id: 'map-1',
  organizationId: 'org-1',
  eventType: 'business_meeting',
  customCategory: null,
  adminHoursCategoryId: 'cat-1',
  adminHoursCategoryName: 'Professional Development',
  adminHoursCategoryColor: '#2563eb',
  percentage: 100,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const mapping = (overrides: Partial<EventHourMapping>): EventHourMapping => ({
  ...legacyMapping,
  inEffect: true,
  notInEffectReason: null,
  ...overrides,
});

const trainingMapping = mapping({
  id: 'map-training',
  eventType: 'training',
  inEffect: false,
  notInEffectReason: "Training events are credited to members' training records instead of admin hours",
});

const renderSection = async () => {
  render(<HourTrackingSection settings={settings} />);
  await screen.findByText('Event Hour Tracking');
};

const groupFor = (label: string): HTMLElement => screen.getByRole('group', { name: `${label} mappings` });

describe('HourTrackingSection', () => {
  beforeEach(() => {
    mockListMappings.mockReset();
    mockListCategories.mockReset();
    mockCreateMapping.mockReset();
    mockToastError.mockReset();
    mockListMappings.mockResolvedValue([]);
    mockListCategories.mockResolvedValue([category]);
  });

  it('does not offer training as an event source, since training events earn no admin hours', async () => {
    await renderSection();

    const sourceSelect = screen.getByRole('combobox', { name: 'Event source' });
    const options = within(sourceSelect)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Business Meeting');
    expect(options).not.toContain('Training');
    expect(within(sourceSelect).queryByRole('option', { name: 'Training' })).not.toBeInTheDocument();
  });

  it('says in the section header that training events are credited to training records', async () => {
    await renderSection();

    expect(
      screen.getByText(
        /Training events are not mapped here: their attendance is credited to members' training records instead of admin hours/
      )
    ).toBeInTheDocument();
  });

  it('labels a stored mapping the backend reports as not in effect, with its reason', async () => {
    mockListMappings.mockResolvedValue([trainingMapping]);
    await renderSection();

    const group = groupFor('Training');
    expect(
      within(group).getByText(
        "Not in effect — Training events are credited to members' training records instead of admin hours"
      )
    ).toBeInTheDocument();
  });

  it('falls back to the standard wording when no reason is reported', async () => {
    mockListMappings.mockResolvedValue([{ ...trainingMapping, notInEffectReason: null }]);
    await renderSection();

    expect(
      screen.getByText("Not in effect — training events credit members' training records instead")
    ).toBeInTheDocument();
  });

  it('shows a neutral allocation badge for a group with no mapping in effect', async () => {
    mockListMappings.mockResolvedValue([trainingMapping]);
    await renderSection();

    const badge = within(groupFor('Training')).getByText('100% allocated');
    expect(badge).toHaveClass('text-theme-text-secondary');
    expect(badge.className).not.toMatch(/green|yellow|red/);
  });

  it('keeps the status colours and no "Not in effect" label for a mapping in effect', async () => {
    mockListMappings.mockResolvedValue([mapping({})]);
    await renderSection();

    const group = groupFor('Business Meeting');
    expect(within(group).getByText('100% allocated').className).toMatch(/green/);
    expect(within(group).queryByText(/Not in effect/)).not.toBeInTheDocument();
  });

  it("shows the backend's reason when it refuses a new mapping", async () => {
    const detail = 'Total percentage would be 150%. Maximum is 100% (currently 50% allocated).';
    mockCreateMapping.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { detail } } })
    );
    const user = userEvent.setup();
    await renderSection();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Event source' }), 'Business Meeting');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Admin hours category' }),
      'Professional Development'
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(mockCreateMapping).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'business_meeting', admin_hours_category_id: 'cat-1', percentage: 100 })
    );
    expect(mockToastError).toHaveBeenCalledWith(detail);
  });

  it('treats a mapping without the flag as in effect', async () => {
    mockListMappings.mockResolvedValue([legacyMapping]);
    await renderSection();

    expect(within(groupFor('Business Meeting')).getByText('100% allocated').className).toMatch(/green/);
    expect(screen.queryByText(/Not in effect/)).not.toBeInTheDocument();
  });
});
