import type { Page, Request } from '@playwright/test';
import type {
  AdminHoursReport,
  AnnualTrainingReport,
  ApparatusStatusReport,
  CallVolumeReport,
  CertExpirationReport,
  ComplianceStatusReport,
  DepartmentOverviewReport,
  EventAttendanceReport,
  InventoryStatusReport,
  MemberRosterReport,
  PipelineOverviewReport,
  TrainingProgressReport,
  TrainingSummaryReport,
} from '../modules/reports/types';

/**
 * Shared E2E fixtures and API mocking.
 *
 * These specs run against the Vite dev server with no backend: every
 * `/api/v1/**` call is fulfilled by Playwright. That keeps the suite fast and
 * hermetic, but it means the mocked URLs are a contract with the real service
 * layer. When an endpoint moves, the mock stops matching, the request falls
 * through to a proxy with nothing behind it, and the assertion fails somewhere
 * far from the cause. Route globs therefore live here — one place to correct —
 * and `mockApi` installs a permissive catch-all so a missed endpoint degrades
 * to empty data rather than a 500.
 */

export const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export const TEST_USER = {
  id: 'e2e-user-id',
  username: 'e2euser',
  email: 'e2e@example.com',
  first_name: 'Alex',
  last_name: 'Tester',
  is_active: true,
  // E2E represents an administrator so permission-gated pages exercise their
  // substantive body rather than merely proving that AppLayout rendered.
  permissions: [
    'members.view',
    'members.manage',
    'users.view',
    'scheduling.view',
    'scheduling.manage',
    'scheduling.reports',
    'forms.view',
    'forms.manage',
    'prospective_members.view',
    'prospective_members.manage',
    'communications.view',
    'communications.manage',
    'settings.view',
    'organization.manage',
    'positions.manage_permissions',
    'events.view',
    'events.manage',
    'training.view',
    'training.manage',
    'inventory.view',
    'inventory.manage',
    'documents.view',
    'documents.manage',
    'admin.access',
  ],
  roles: [],
  positions: [],
};

export const TEST_DEPARTMENT = 'Oakville Fire Department';

export const NOTIFICATION_SUBJECTS = ['New event scheduled', 'Training reminder'];

export const SHIFT_OFFICER = 'Captain Smith';

export const TRAINING_PROGRAMS = ['Firefighter I Certification', 'EMT Refresher'];

/** Progress percentage of the first enrolled program, as rendered. */
export const TRAINING_FIRST_PROGRESS = 65;

const notificationLogs = () => ({
  logs: [
    {
      id: 'notif-1',
      subject: NOTIFICATION_SUBJECTS[0],
      message: 'Monthly drill has been scheduled for next week.',
      sent_at: new Date().toISOString(),
      read: false,
      action_url: '/events',
    },
    {
      id: 'notif-2',
      subject: NOTIFICATION_SUBJECTS[1],
      message: 'Your CPR certification expires in 30 days.',
      sent_at: new Date(Date.now() - 86_400_000).toISOString(),
      read: true,
      action_url: '/training',
    },
  ],
  total: 2,
  skip: 0,
  limit: 10,
});

/**
 * One shift that ended yesterday and was never closed out.
 *
 * The close-out queue's whole subject. Without it the route's mobile ratchet
 * entry measured the filter bar, the empty state and the settings mirror —
 * never a queue row or its Close out control, which is the principal UI that
 * route exists to render. A budget met by a page with nothing on it is not
 * coverage.
 *
 * Dated relative to the run for the same reason `myShifts` is: a hard-coded
 * date stops being "yesterday" the day after it is written, and the row would
 * quietly leave the queue.
 */
const closeoutBacklog = () => {
  const yesterday = new Date(Date.now() - 86_400_000);
  const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(
    yesterday.getDate()
  ).padStart(2, '0')}`;
  return {
    shifts: [
      {
        id: 'closeout-1',
        organization_id: 'org-1',
        shift_date: day,
        start_time: `${day}T08:00:00Z`,
        end_time: `${day}T16:00:00Z`,
        apparatus_unit_number: 'Engine 1',
        shift_officer_name: SHIFT_OFFICER,
        attendee_count: 3,
        call_count: 0,
        is_finalized: false,
        created_at: `${day}T00:00:00Z`,
      },
    ],
    total: 1,
    skip: 0,
    limit: 200,
  };
};

const myShifts = () => {
  // Keep the shifts in the future relative to the run so the dashboard's
  // "upcoming" filtering keeps them; a hard-coded date silently empties this
  // section once it passes.
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return {
    shifts: [
      {
        id: 'shift-1',
        shift_date: day(2),
        start_time: '08:00',
        end_time: '16:00',
        shift_officer_name: SHIFT_OFFICER,
      },
      {
        id: 'shift-2',
        shift_date: day(6),
        start_time: '16:00',
        end_time: '00:00',
        shift_officer_name: null,
      },
    ],
    total: 2,
  };
};

const enrollments = () => [
  {
    id: 'enrollment-1',
    program: {
      id: 'prog-1',
      name: TRAINING_PROGRAMS[0],
      description: 'Basic firefighter certification program',
    },
    status: 'active',
    progress_percentage: TRAINING_FIRST_PROGRESS,
  },
  {
    id: 'enrollment-2',
    program: {
      id: 'prog-2',
      name: TRAINING_PROGRAMS[1],
      description: 'Annual EMT certification renewal',
    },
    status: 'active',
    progress_percentage: 30,
  },
];

/**
 * Events module settings, shaped as `EVENT_SETTINGS_DEFAULTS` in
 * backend/app/api/v1/endpoints/events.py returns them, plus two custom
 * categories. The page rejects a body that is not this shape, so without it the
 * settings tab measures its error state instead of its sections.
 *
 * `auxiliary_fundraising_dinner` is deliberately long: an unbreakable slug is
 * what pushed the remove button off a 320px card, and a short one cannot
 * reproduce that.
 */
const requestDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/**
 * The Community Engagement report, shaped as
 * backend/app/api/v1/endpoints/dashboard.py returns it. Without it the tab
 * reads the catch-all `{}` and the sweep measures its error state. One event
 * of each reach kind — estimated, signed in against an expectation, signed in
 * with none — because each draws a different cell, and the long organization
 * name is the one that wraps on a phone.
 */
const COMMUNITY_ENGAGEMENT = {
  total_public_events: 21,
  total_member_attendees: 160,
  total_external_attendees: 610,
  upcoming_public_events: 3,
  period: 'year',
  period_start: requestDay(-300),
  period_end: requestDay(0),
  current: {
    events_held: 19,
    people_reached: 2140,
    signed_in: 412,
    estimated: 1728,
    member_hours: 312.5,
    members_involved: 41,
    requests_received: 18,
    requests_completed: 14,
  },
  previous: {
    events_held: 15,
    people_reached: 1634,
    signed_in: 300,
    estimated: 1334,
    member_hours: 332,
    members_involved: 38,
    requests_received: 16,
    requests_completed: 12,
  },
  upcoming_events: 3,
  turnout: { events: 6, signed_in: 412, expected: 480 },
  granularity: 'month',
  by_period: [
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
    '2026-10',
    '2026-11',
  ].map((period, i) => ({ period, events: (i % 4) + 1, signed_in: 20 + i * 9, estimated: (i * 37) % 260 })),
  by_type: [
    { label: 'School Visit', events: 6, people_reached: 860 },
    { label: 'Station Tour', events: 5, people_reached: 520 },
    { label: 'Fire Safety Demonstration', events: 3, people_reached: 410 },
    { label: 'CPR / First Aid', events: 2, people_reached: 200 },
    { label: 'Fundraiser', events: 1, people_reached: 150 },
  ],
  recent_events: [
    {
      event_id: 'ce-1',
      title: 'Fire prevention assembly',
      start_datetime: requestDay(-6),
      type_label: 'School Visit',
      organization_name: 'Oakville Elementary School Parent-Teacher Association',
      request_id: 'req-1',
      signed_in: 0,
      expected: 120,
      people_reached: 120,
      reach_is_estimate: true,
      crew: 4,
      member_hours: 10,
    },
    {
      event_id: 'ce-2',
      title: 'CPR class',
      start_datetime: requestDay(-12),
      type_label: 'CPR / First Aid',
      organization_name: 'Holt Auto Group',
      request_id: 'req-2',
      signed_in: 25,
      expected: 30,
      people_reached: 25,
      reach_is_estimate: false,
      crew: 2,
      member_hours: 6,
    },
    {
      event_id: 'ce-3',
      title: 'Open house',
      start_datetime: requestDay(-29),
      type_label: 'Public Education',
      organization_name: null,
      request_id: null,
      signed_in: 285,
      expected: null,
      people_reached: 285,
      reach_is_estimate: false,
      crew: 14,
      member_hours: 70,
    },
  ],
};

const EVENT_REQUESTS = [
  {
    id: 'req-demo-1',
    contact_name: 'Maria Lopez',
    contact_email: 'mlopez@example.test',
    organization_name: 'Oakville Elementary',
    outreach_type: 'fire_safety_demo',
    status: 'submitted',
    date_flexibility: 'specific_dates',
    preferred_date_start: requestDay(9),
    audience_size: 120,
    short_notice: false,
    created_at: requestDay(-1),
  },
  {
    id: 'req-demo-2',
    contact_name: 'Tom Becker',
    contact_email: 'tbecker@example.test',
    organization_name: 'Maple Street HOA',
    outreach_type: 'station_tour',
    status: 'in_progress',
    date_flexibility: 'specific_dates',
    preferred_date_start: requestDay(5),
    audience_size: 200,
    assigned_to: TEST_USER.id,
    assignee_name: 'Alex Tester',
    short_notice: true,
    task_completions: {
      review_request: { completed: true, completed_by: TEST_USER.id, completed_at: requestDay(-2) },
    },
    created_at: requestDay(-6),
  },
  {
    id: 'req-demo-3',
    contact_name: 'Kevin Wu',
    contact_email: 'kwu@example.test',
    organization_name: 'Scout Troop 12',
    outreach_type: 'station_tour',
    status: 'scheduled',
    date_flexibility: 'specific_dates',
    event_date: requestDay(3),
    audience_size: 14,
    assigned_to: TEST_USER.id,
    assignee_name: 'Alex Tester',
    staffing_shift_id: 'shift-demo-1',
    staffing_slots_filled: 4,
    staffing_slots_total: 6,
    created_at: requestDay(-20),
  },
  {
    id: 'req-demo-4',
    contact_name: 'Greg Holt',
    contact_email: 'gholt@example.test',
    organization_name: 'Holt Auto Group',
    outreach_type: 'other',
    status: 'completed',
    date_flexibility: 'specific_dates',
    event_date: requestDay(-10),
    created_at: requestDay(-45),
  },
];

const EVENT_REQUEST_DETAIL = {
  organization_id: 'org-1',
  contact_phone: '(555) 201-4410',
  description: 'Our block party would love an engine and a short talk on home fire escape plans.',
  preferred_time_of_day: 'afternoon',
  age_group: 'Families, all ages',
  venue_preference: 'their_location',
  venue_address: '400 block of Maple Street',
  special_requests: 'Street closed to traffic from 3 to 8 pm.',
  status_token: 'tok-demo',
  updated_at: requestDay(-1),
  activity_log: [],
};

const eventSettings = () => ({
  enabled_event_types: [
    'business_meeting',
    'public_education',
    'training',
    'social',
    'fundraiser',
    'ceremony',
    'other',
    'recruitment',
  ],
  visible_event_types: ['business_meeting', 'public_education', 'training', 'other'],
  event_type_labels: {},
  custom_event_categories: [
    {
      value: 'apparatus_parade',
      label: 'Apparatus Parade',
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
    },
    {
      value: 'auxiliary_fundraising_dinner',
      label: 'Auxiliary Fundraising Dinner',
      color: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
    },
  ],
  visible_custom_categories: ['apparatus_parade'],
  outreach_event_types: [
    { value: 'fire_safety_demo', label: 'Fire Safety Demo' },
    { value: 'station_tour', label: 'Station Tour' },
    { value: 'cpr_first_aid', label: 'CPR / First Aid Class' },
    { value: 'other', label: 'Other' },
  ],
  outreach_roles: [
    { value: 'tour_guide', label: 'Tour Guide' },
    { value: 'educator', label: 'Educator' },
    { value: 'setup_teardown', label: 'Setup & Teardown' },
  ],
  request_pipeline: {
    min_lead_time_days: 21,
    default_assignee_id: null,
    public_progress_visible: false,
    accept_public_requests: false,
    public_daily_limit: 50,
    tasks: [
      { id: 'review_request', label: 'Review Request', description: 'Review the incoming request details' },
      {
        id: 'assign_coordinator',
        label: 'Assign Coordinator',
        description: 'Assign a team member to coordinate this event',
      },
      { id: 'confirm_date', label: 'Confirm Date', description: 'Confirm the event date with the requester' },
    ],
    email_triggers: {
      on_submitted: { enabled: true, notify_assignee: true, notify_requester: true },
      on_assigned: { enabled: true, notify_assignee: true, notify_requester: false },
      on_scheduled: { enabled: true, notify_requester: true },
      days_before_event: { enabled: true, notify_requester: true, days: [7, 1] },
      volunteer_call: { enabled: true },
    },
  },
  defaults: {
    event_type: 'other',
    check_in_window_type: 'flexible',
    check_in_minutes_before: 60,
    check_in_minutes_after: 15,
    require_checkout: false,
    requires_rsvp: false,
    allowed_rsvp_statuses: ['going', 'not_going'],
    allow_guests: false,
    attendee_visibility: 'managers',
    is_mandatory: false,
    send_reminders: true,
    reminder_target: 'going',
    reminder_schedule: [24],
    default_reminder_time: '09:00',
    default_duration_minutes: 120,
  },
  qr_code: { show_event_description: true, show_location_details: true, custom_instructions: '' },
  cancellation: { require_reason: false, notify_attendees: true },
});

/** The Events hub's metric choices, keyed as `admin_hub_service.py` declares them. */
const eventMetricSettings = () => {
  const option = (key: string, label: string, description: string, value: string) => ({
    key,
    label,
    description,
    value,
    unavailableReason: null,
    fixed: false,
  });
  const defaults = ['upcoming_events', 'rsvps_this_week', 'check_ins_logged'];
  return {
    moduleKey: 'events',
    options: [
      option('upcoming_events', 'Upcoming', 'Events starting in the next 30 days', '6'),
      option('rsvps_this_week', 'RSVPs this week', 'Responses recorded in the last seven days', '18'),
      option('check_ins_logged', 'Check-ins logged', 'Attendance captured in the last 30 days', '42'),
      option('attendance_rate', 'Attendance rate', 'Check-ins against members who said they were going', '81%'),
      {
        key: 'needs_attention',
        label: 'Needs attention',
        description: 'Items waiting on you',
        value: '0',
        unavailableReason: null,
        fixed: true,
      },
    ],
    selected: defaults,
    appliesToEveryone: true,
    isPersonal: false,
    departmentDefault: [],
    builtInDefault: defaults,
  };
};

/** Training Administration's metric choices, keyed as `admin_hub_service.py` declares them. */
const trainingMetricSettings = () => {
  const option = (key: string, label: string, description: string, value: string) => ({
    key,
    label,
    description,
    value,
    unavailableReason: null,
    fixed: false,
  });
  const defaults = ['compliance_rate', 'hours_this_quarter', 'active_programs'];
  return {
    moduleKey: 'training',
    options: [
      option('compliance_rate', 'Compliance', 'Share of active members current on required training', '87%'),
      option(
        'hours_this_quarter',
        'Hours this quarter',
        'Approved training hours completed since the quarter began',
        '1,840'
      ),
      option('active_programs', 'Active programs', 'Training programs currently open for enrollment', '6'),
      option(
        'avg_hours_per_member',
        'Avg hours / member',
        'Rolling twelve months of approved hours per active member',
        '31'
      ),
      option('certs_this_year', 'Certifications this year', 'New certifications recorded since January 1', '37'),
      {
        key: 'needs_attention',
        label: 'Needs attention',
        description: 'Items waiting on you',
        value: '0',
        unavailableReason: null,
        fixed: true,
      },
    ],
    selected: defaults,
    appliesToEveryone: true,
    isPersonal: false,
    departmentDefault: [],
    builtInDefault: defaults,
  };
};

export interface MockOptions {
  /**
   * Serve empty collections everywhere so the dashboard's empty states render.
   */
  empty?: boolean;
  /** Permissions granted to the signed-in fixture user. */
  permissions?: string[];
  /**
   * Whether the department runs platoon (A/B/C) scheduling.
   *
   * Off by default — the shape most departments have, and what the closeout
   * fixtures below were written against. Opt-in per test rather than simply
   * switched on, because the flag hides a whole settings section:
   * SchedulingSettingsPage drops Platoons from its section list when this is
   * false and falls back to General, so anything visiting
   * /scheduling/admin/settings/platoons without it measures the General body
   * under the Platoons URL — green, and about the wrong page.
   */
  platoonsEnabled?: boolean;
  /**
   * Serve a member record at `/users/:id/with-roles` (and its name at
   * `/users/:id/roles`) and an empty audit history beside it.
   *
   * Opt-in because the catch-all `{}` is what every other ratcheted page that
   * reads a member was measured against; the member edit and audit-history
   * pages need a record with an id to get past their load-error states, and a
   * pass over those would otherwise measure the error panel under their names.
   */
  memberRecord?: boolean;
  /**
   * Lengthen every display string the fixtures serve: names, titles, labels,
   * descriptions, messages.
   *
   * The fixtures are written with short, tidy values — "Engine 1", "Alex
   * Tester" — and a layout that fits those says little about a department
   * called "Greater Northfield-Oakville Township Volunteer Fire & Rescue". Long
   * text is where headers, tiles and table cells overflow. Opt-in because
   * several specs assert on the exact fixture strings.
   */
  longText?: boolean;
}

/** Keys whose string values a person reads; anything else may be an id, enum or date. */
const DISPLAY_KEYS = new Set([
  'name',
  'title',
  'label',
  'description',
  'subject',
  'message',
  'first_name',
  'last_name',
  'full_name',
  'display_name',
  'shift_officer_name',
  'apparatus_unit_number',
  'storeName',
  'tagline',
  'location',
  'location_name',
  'category_name',
  'program_name',
]);

const LONG_SUFFIX = ' of the Greater Northfield-Oakville Township Volunteer Fire & Rescue Department';
const LONG_NAME_SUFFIX = '-Montgomery-Fitzgerald';

const lengthen = (value: unknown, key = ''): unknown => {
  if (Array.isArray(value)) return value.map((item) => lengthen(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, lengthen(v, k)]));
  }
  if (typeof value === 'string' && value.trim() && DISPLAY_KEYS.has(key)) {
    return key.endsWith('_name') && key !== 'location_name' && key !== 'category_name' && key !== 'program_name'
      ? `${value}${LONG_NAME_SUFFIX}`
      : `${value}${LONG_SUFFIX}`;
  }
  return value;
};

// Finance. Fourteen finance screens sat in the route inventory as exempt, and
// a visit could not have measured them: the catch-all's `{}` drew every list as
// empty and took /finance/budget-amendments down through the ErrorBoundary,
// which maps the pending list. Camel-cased, as schemas/finance.py serializes,
// with money as a string, as its Decimal fields do. Statuses vary so the badges
// a reviewer reads all render.
const FINANCE_STAMP = {
  organizationId: 'e2e-org',
  createdBy: 'e2e-user-id',
  createdAt: '2026-01-02T15:00:00Z',
  updatedAt: '2026-02-10T15:00:00Z',
};

interface FiscalYearFixture {
  id: string;
  name: string;
  status: string;
  requestDeadline?: string;
  requestsOpen?: boolean;
  planningStage?: string;
}

const FY_2026 = {
  id: 'e2e-fy-2026',
  name: 'FY 2026',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'active',
  isLocked: false,
  ...FINANCE_STAMP,
};

// Next year's, open for budget requests: what the request and review screens list.
const FY_2027 = {
  id: 'e2e-fy-2027',
  name: 'FY 2027',
  startDate: '2027-01-01',
  endDate: '2027-12-31',
  status: 'draft',
  isLocked: false,
  requestDeadline: '2026-12-01',
  requestsOpen: true,
  planningStage: 'requests',
  ...FINANCE_STAMP,
};

const FISCAL_YEARS = [FY_2026, FY_2027];

const BUDGET_CATEGORIES = [
  ['e2e-cat-apparatus', 'Apparatus Maintenance'],
  ['e2e-cat-ppe', 'Personal Protective Equipment'],
  ['e2e-cat-training', 'Training & Certification'],
].map(([id, name], i) => ({ id, name, sortOrder: i, isActive: true, ...FINANCE_STAMP }));

const BUDGETS = (
  [
    ['e2e-budget-1', 'e2e-cat-apparatus', 'Apparatus Maintenance', '48000.00', '31250.40', '6200.00'],
    ['e2e-budget-2', 'e2e-cat-ppe', 'Personal Protective Equipment', '125000.00', '98410.15', '18900.00'],
    ['e2e-budget-3', 'e2e-cat-training', 'Training & Certification', '22500.00', '4180.00', '0.00'],
  ] as const
).map(([id, categoryId, categoryName, amountBudgeted, amountSpent, amountEncumbered]) => ({
  id,
  fiscalYearId: 'e2e-fy-2026',
  fiscalYearName: 'FY 2026',
  fiscalYearStatus: 'active',
  categoryId,
  categoryName,
  amountBudgeted,
  amountSpent,
  amountEncumbered,
  ...FINANCE_STAMP,
}));

const approvalStep = (entityType: string, entityId: string, status: string) => ({
  id: `${entityId}-step`,
  chainId: 'e2e-chain',
  stepId: 'e2e-chain-step-1',
  entityType,
  entityId,
  status,
  stepName: 'Chief approval',
  stepOrder: 1,
  assigneeLabel: 'Fire Chief',
  createdAt: '2026-02-01T15:00:00Z',
});

const PURCHASE_REQUESTS = (
  [
    [
      'e2e-pr-1',
      'PR-2026-0012',
      'Replacement SCBA cylinders (6)',
      'MSA Safety',
      '14820.00',
      'pending_approval',
      'high',
    ],
    ['e2e-pr-2', 'PR-2026-0009', 'Hose testing and repair', 'Northeast Hose Co.', '2350.00', 'approved', 'medium'],
    ['e2e-pr-3', 'PR-2026-0004', 'Station 2 kitchen range', 'City Appliance', '1899.99', 'paid', 'low'],
  ] as const
).map(([id, requestNumber, title, vendor, estimatedAmount, status, priority]) => ({
  id,
  requestNumber,
  fiscalYearId: 'e2e-fy-2026',
  budgetId: 'e2e-budget-1',
  requestedBy: 'e2e-user-id',
  title,
  vendor,
  estimatedAmount,
  status,
  priority,
  ...FINANCE_STAMP,
  approvalSteps: [approvalStep('purchase_request', id, status === 'pending_approval' ? 'pending' : 'approved')],
}));

const EXPENSE_REPORTS = (
  [
    ['e2e-er-1', 'ER-2026-0031', 'State fire academy — Instructor II', '486.20', 'submitted'],
    ['e2e-er-2', 'ER-2026-0027', 'Mileage to regional drill', '112.56', 'approved'],
    ['e2e-er-3', 'ER-2026-0018', 'Boot allowance', '175.00', 'paid'],
  ] as const
).map(([id, reportNumber, title, totalAmount, status]) => ({
  id,
  reportNumber,
  submittedBy: 'e2e-user-id',
  fiscalYearId: 'e2e-fy-2026',
  title,
  totalAmount,
  status,
  submittedAt: '2026-02-05T15:00:00Z',
  ...FINANCE_STAMP,
  lineItems: [],
  approvalSteps: [approvalStep('expense_report', id, status === 'submitted' ? 'pending' : 'approved')],
}));

const CHECK_REQUESTS = (
  [
    ['e2e-cr-1', 'CR-2026-0008', 'Oakville Ladies Auxiliary', '750.00', 'pending_approval'],
    ['e2e-cr-2', 'CR-2026-0006', 'County Fire Training Council', '1200.00', 'issued'],
    ['e2e-cr-3', 'CR-2026-0002', 'Valley Septic Services', '385.00', 'voided'],
  ] as const
).map(([id, requestNumber, payeeName, amount, status]) => ({
  id,
  requestNumber,
  requestedBy: 'e2e-user-id',
  fiscalYearId: 'e2e-fy-2026',
  payeeName,
  amount,
  purpose: 'Department operating expense',
  status,
  ...(status === 'issued' ? { checkNumber: '10482', checkDate: '2026-02-12' } : {}),
  ...FINANCE_STAMP,
  approvalSteps: [approvalStep('check_request', id, status === 'pending_approval' ? 'pending' : 'approved')],
}));

const PENDING_APPROVALS = [
  {
    stepRecordId: 'e2e-pr-1-step',
    entityType: 'purchase_request',
    entityId: 'e2e-pr-1',
    entityTitle: 'Replacement SCBA cylinders (6)',
    entityAmount: '14820.00',
    requesterName: 'Alex Tester',
    stepName: 'Chief approval',
    stepOrder: 1,
    submittedAt: '2026-02-03T15:00:00Z',
    approverType: 'position',
    assigneeLabel: 'Fire Chief',
    canAct: true,
    requiresOverride: false,
  },
  {
    stepRecordId: 'e2e-er-1-step',
    entityType: 'expense_report',
    entityId: 'e2e-er-1',
    entityTitle: 'State fire academy — Instructor II',
    entityAmount: '486.20',
    requesterName: 'Jordan Captain',
    stepName: 'Treasurer review',
    stepOrder: 1,
    submittedAt: '2026-02-05T15:00:00Z',
    approverType: 'position',
    assigneeLabel: 'Treasurer',
    canAct: false,
    requiresOverride: true,
  },
];

const BUDGET_REQUESTS = (
  [
    [
      'e2e-breq-1',
      'e2e-cat-apparatus',
      'Apparatus Maintenance',
      '52000.00',
      'submitted',
      'Engine 2 pump overhaul is due in the spring.',
    ],
    ['e2e-breq-2', 'e2e-cat-ppe', 'Personal Protective Equipment', '131500.00', 'draft', null],
  ] as const
).map(([id, categoryId, lineLabel, requestedAmount, status, justification]) => ({
  id,
  fiscalYearId: 'e2e-fy-2027',
  fiscalYearName: 'FY 2027',
  categoryId,
  categoryName: lineLabel,
  lineLabel,
  isProposedLine: false,
  requestedAmount,
  status,
  justification,
  submittedByName: status === 'submitted' ? 'Alex Tester' : null,
  lastYearFiscalYearName: 'FY 2026',
  lastYearBudgeted: categoryId === 'e2e-cat-ppe' ? '125000.00' : '48000.00',
  ...FINANCE_STAMP,
}));

const fiscalYearOption = ({ id, name, status, requestDeadline, requestsOpen, planningStage }: FiscalYearFixture) => ({
  id,
  name,
  status,
  requestDeadline: requestDeadline ?? null,
  requestsOpen: requestsOpen ?? false,
  planningStage: planningStage ?? null,
});

// Grants & fundraising, on the same footing as Finance above: nine screens sat
// in the inventory as exempt, seven drew as empty, and Zeffy and Reports threw
// into the ErrorBoundary. Camel-cased, as schemas/grant.py serializes. Its money
// fields are Decimal, which goes over the wire as a string, so money is a
// string here even where the frontend type says number — that is what a page
// receives, and what it has to cope with.
const GRANT_STAMP = {
  organizationId: 'e2e-org',
  createdBy: 'e2e-user-id',
  createdAt: '2026-01-05T15:00:00Z',
  updatedAt: '2026-02-12T15:00:00Z',
};

const GRANT_OPPORTUNITIES = (
  [
    [
      'e2e-opp-afg',
      'Assistance to Firefighters Grant (AFG)',
      'FEMA',
      'equipment',
      '10000.00',
      '1000000.00',
      10,
      'fixed',
      '2026-12-15',
    ],
    [
      'e2e-opp-safer',
      'Staffing for Adequate Fire & Emergency Response (SAFER)',
      'FEMA',
      'staffing',
      '50000.00',
      '2000000.00',
      null,
      'fixed',
      '2027-02-28',
    ],
    [
      'e2e-opp-state',
      'State Volunteer Fire Assistance',
      'State Forestry Division',
      'training',
      '1000.00',
      '20000.00',
      50,
      'rolling',
      null,
    ],
  ] as const
).map(
  ([id, name, agency, category, typicalAwardMin, typicalAwardMax, matchPercentage, deadlineType, deadlineDate]) => ({
    id,
    name,
    agency,
    description: `${agency} funding for fire departments`,
    eligibleUses: null,
    typicalAwardMin,
    typicalAwardMax,
    eligibilityCriteria: null,
    applicationUrl: null,
    programUrl: null,
    matchRequired: matchPercentage !== null,
    matchPercentage: matchPercentage === null ? null : String(matchPercentage),
    matchDescription: null,
    deadlineType,
    deadlineDate,
    recurringSchedule: null,
    requiredDocuments: [],
    tags: [],
    category,
    federalProgramCode: null,
    isActive: true,
    notes: null,
    ...GRANT_STAMP,
  })
);

const GRANT_APPLICATIONS = (
  [
    [
      'e2e-app-1',
      'e2e-opp-afg',
      'Assistance to Firefighters Grant (AFG)',
      'FEMA',
      'submitted',
      '342000.00',
      null,
      'high',
    ],
    [
      'e2e-app-2',
      'e2e-opp-safer',
      'Staffing for Adequate Fire & Emergency Response (SAFER)',
      'FEMA',
      'preparing',
      '780000.00',
      null,
      'critical',
    ],
    [
      'e2e-app-3',
      'e2e-opp-state',
      'State Volunteer Fire Assistance',
      'State Forestry Division',
      'active',
      '18500.00',
      '15000.00',
      'medium',
    ],
    [
      'e2e-app-4',
      null,
      'Community Foundation Safety Grant',
      'Oakville Community Foundation',
      'denied',
      '7500.00',
      null,
      'low',
    ],
  ] as const
).map(
  ([
    id,
    opportunityId,
    grantProgramName,
    grantAgency,
    applicationStatus,
    amountRequested,
    amountAwarded,
    priority,
  ]) => ({
    id,
    opportunityId,
    grantProgramName,
    grantAgency,
    applicationStatus,
    amountRequested,
    amountAwarded,
    matchAmount: null,
    matchSource: null,
    applicationDeadline: '2026-12-15',
    submittedDate: applicationStatus === 'preparing' ? null : '2026-02-01',
    awardDate: amountAwarded ? '2026-04-10' : null,
    grantStartDate: amountAwarded ? '2026-05-01' : null,
    grantEndDate: amountAwarded ? '2027-04-30' : null,
    projectDescription: null,
    narrativeSummary: null,
    budgetSummary: null,
    keyContacts: null,
    federalAwardId: null,
    nfirsCompliant: null,
    performancePeriodMonths: null,
    reportingFrequency: null,
    nextReportDue: amountAwarded ? '2026-11-30' : null,
    finalReportDue: null,
    assignedTo: null,
    priority,
    linkedCampaignId: null,
    notes: null,
    ...GRANT_STAMP,
  })
);

const FUNDRAISING_CAMPAIGNS = (
  [
    ['e2e-camp-1', 'Thermal Imaging Camera Drive', 'equipment', '24000.00', '17350.00', 'active'],
    ['e2e-camp-2', 'Annual Fund 2026', 'general', '60000.00', '41275.50', 'active'],
    ['e2e-camp-3', 'Fallen Firefighters Memorial', 'memorial', '15000.00', '15000.00', 'completed'],
  ] as const
).map(([id, name, campaignType, goalAmount, currentAmount, status]) => ({
  id,
  name,
  description: null,
  campaignType,
  goalAmount,
  currentAmount,
  startDate: '2026-01-15',
  endDate: status === 'completed' ? '2026-05-30' : '2026-12-31',
  status,
  publicPageEnabled: false,
  publicPageUrl: null,
  heroImageUrl: null,
  thankYouMessage: null,
  allowAnonymous: true,
  minimumDonation: null,
  suggestedAmounts: null,
  ...GRANT_STAMP,
}));

const DONORS = (
  [
    ['e2e-donor-1', 'individual', 'Margaret', 'Okafor', null, '2500.00', 6],
    ['e2e-donor-2', 'business', null, null, 'Oakville Hardware & Supply', '8000.00', 3],
    ['e2e-donor-3', 'foundation', null, null, 'Harrington Family Foundation', '15000.00', 1],
  ] as const
).map(([id, donorType, firstName, lastName, companyName, totalDonated, donationCount]) => ({
  id,
  userId: null,
  firstName,
  lastName,
  email: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: 'Oakville',
  state: 'NY',
  postalCode: null,
  country: null,
  donorType,
  companyName,
  totalDonated,
  donationCount,
  firstDonationDate: '2024-03-02',
  lastDonationDate: '2026-02-10',
  notes: null,
  tags: null,
  communicationPreferences: null,
  isAnonymous: false,
  active: true,
  organizationId: 'e2e-org',
  createdAt: '2024-03-02T15:00:00Z',
  updatedAt: '2026-02-10T15:00:00Z',
}));

const DONATIONS = (
  [
    ['e2e-don-1', 'e2e-camp-1', 'e2e-donor-1', '500.00', 'check', '2026-02-10', 'Margaret Okafor'],
    ['e2e-don-2', 'e2e-camp-1', 'e2e-donor-2', '2500.00', 'bank_transfer', '2026-02-03', 'Oakville Hardware & Supply'],
    ['e2e-don-3', 'e2e-camp-2', 'e2e-donor-3', '15000.00', 'check', '2026-01-28', 'Harrington Family Foundation'],
    ['e2e-don-4', 'e2e-camp-2', null, '75.00', 'cash', '2026-01-20', null],
  ] as const
).map(([id, campaignId, donorId, amount, paymentMethod, donationDate, donorName]) => ({
  id,
  organizationId: 'e2e-org',
  campaignId,
  donorId,
  pledgeId: null,
  amount,
  currency: 'USD',
  donationDate,
  paymentMethod,
  paymentStatus: 'completed',
  transactionId: null,
  checkNumber: paymentMethod === 'check' ? '2214' : null,
  isRecurring: false,
  recurringFrequency: null,
  isAnonymous: donorName === null,
  donorName,
  donorEmail: null,
  dedicationType: null,
  dedicationName: null,
  notes: null,
  receiptSent: true,
  thankYouSent: donorName !== null,
  taxDeductible: true,
  recordedBy: 'e2e-user-id',
  createdAt: `${donationDate}T15:00:00Z`,
  updatedAt: `${donationDate}T15:00:00Z`,
}));

const PLEDGES = (
  [
    ['e2e-pledge-1', 'e2e-camp-1', 'e2e-donor-2', '5000.00', '2500.00', 'partial', '2026-06-30'],
    ['e2e-pledge-2', 'e2e-camp-2', 'e2e-donor-1', '1200.00', '0.00', 'pending', '2026-12-31'],
    ['e2e-pledge-3', 'e2e-camp-2', 'e2e-donor-3', '10000.00', '0.00', 'overdue', '2026-03-31'],
  ] as const
).map(([id, campaignId, donorId, pledgedAmount, fulfilledAmount, status, dueDate]) => ({
  id,
  campaignId,
  donorId,
  pledgedAmount,
  fulfilledAmount,
  pledgeDate: '2026-01-10',
  dueDate,
  status,
  paymentSchedule: null,
  reminderEnabled: true,
  notes: null,
  ...GRANT_STAMP,
}));

const FUNDRAISING_EVENTS = (
  [
    [
      'e2e-fevent-1',
      'e2e-camp-2',
      'Pancake Breakfast',
      'dinner',
      '2026-03-14',
      '12.00',
      '3480.00',
      '640.00',
      'completed',
    ],
    [
      'e2e-fevent-2',
      'e2e-camp-1',
      'Fire Prevention Week Golf Outing',
      'golf_outing',
      '2026-10-04',
      '150.00',
      '0.00',
      '0.00',
      'open',
    ],
  ] as const
).map(([id, campaignId, name, eventType, eventDate, ticketPrice, actualRevenue, expenses, status]) => ({
  id,
  campaignId,
  eventId: null,
  name,
  description: null,
  eventType,
  eventDate,
  location: 'Station 1',
  ticketPrice,
  maxAttendees: 200,
  currentAttendees: status === 'completed' ? 290 : 64,
  revenueGoal: '5000.00',
  actualRevenue,
  expenses,
  status,
  registrationUrl: null,
  sponsors: null,
  notes: null,
  ...GRANT_STAMP,
}));

/**
 * Route glob → response body. Ordered least to most specific; `mockApi`
 * registers them in order and Playwright matches the last registration first,
 * so later entries win.
 */
const routes = ({
  empty = false,
  permissions = [],
  platoonsEnabled = false,
  memberRecord = false,
}: MockOptions): [string, (request: Request) => unknown][] => [
  // Catch-all. Anything not listed below answers with an empty object rather
  // than reaching the dev-server proxy, which has no backend behind it.
  ['**/api/v1/**', () => ({})],

  ['**/api/v1/auth/me', () => ({ ...TEST_USER, permissions })],
  // A report is generated by type, and each renderer reads the lists its type
  // always carries; answered by the catch-all's `{}`, every one of them threw.
  ['**/api/v1/reports/generate', (request) => emptyReport(reportTypeOf(request))],
  ['**/api/v1/auth/branding', () => ({ name: TEST_DEPARTMENT, logo: null })],
  ['**/api/v1/auth/oauth-config', () => ({ googleEnabled: false, microsoftEnabled: false })],
  ['**/api/v1/auth/session-settings', () => ({ session_timeout_minutes: 60 })],
  ['**/api/v1/auth/logout', () => ({ message: 'Logged out' })],
  ['**/api/v1/onboarding/status', () => ({ is_complete: true })],

  ['**/api/v1/organization/modules', () => ({})],
  // History home: nothing awaiting clearance, two published records.
  ['**/api/v1/history/clearance/queue', () => []],
  [
    '**/api/v1/history/people**',
    () => ({
      items: [
        {
          id: 'e2e-history-1',
          display_name: 'John "Jack" Smith Jr.',
          last_name: 'Smith',
          first_name: 'John',
          nickname: 'Jack',
          service_years: '1951–1972',
          titles: ['Chief', 'Foreman'],
          is_memorial: false,
          is_line_of_duty_death: false,
          publication_level: 'members',
        },
        {
          id: 'e2e-history-2',
          display_name: 'Robert Doyle',
          last_name: 'Doyle',
          first_name: 'Robert',
          nickname: null,
          service_years: 'c. 1923–1940',
          titles: ['Assistant Engineer'],
          is_memorial: true,
          is_line_of_duty_death: true,
          publication_level: 'public',
        },
      ],
      total: 2,
    }),
  ],

  // History gallery: a recording and a photo with no thumbnail, so the page
  // is measured with its tiles and not with broken image requests.
  ['**/api/v1/history/albums', () => []],
  [
    '**/api/v1/history/media**',
    () => ({
      items: [
        {
          id: 'e2e-media-1',
          kind: 'audio',
          title: 'Interview with Chief Smith, 1972',
          taken_date: '1972-01-01',
          taken_date_precision: 'year',
          taken_date_circa: false,
          duration_seconds: 1834,
          has_thumbnail: false,
          publication_level: 'members',
        },
        {
          id: 'e2e-media-2',
          kind: 'photo',
          title: 'Engine 3 at the Fourth of July parade',
          taken_date: '1962-07-01',
          taken_date_precision: 'month',
          taken_date_circa: true,
          duration_seconds: null,
          has_thumbnail: false,
          publication_level: 'public',
        },
      ],
      total: 2,
    }),
  ],

  // Three pages now reject a payload that is valid JSON but not their declared
  // type, rather than substituting empty lists: an audit log that reads "no
  // events" over a broken endpoint, or a check-in board showing blank totals as
  // though they were live, is worse than an error. The catch-all `{}` above is
  // exactly such a payload, so without these fixtures those routes render their
  // error state — and the mobile passes would be measuring an error page, the
  // very thing this suite exists to catch.
  [
    '**/api/v1/audit-logs**',
    () => ({
      logs: [
        {
          id: 1,
          event_type: 'user.login',
          event_category: 'authentication',
          severity: 'info',
          username: 'e2euser',
          description: 'Signed in from a new device',
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          event_type: 'settings.update',
          event_category: 'settings',
          severity: 'warning',
          username: 'e2euser',
          description: 'Changed the session timeout',
          created_at: new Date().toISOString(),
        },
      ],
      total: 2,
      skip: 0,
      limit: 25,
    }),
  ],
  // Registered after the list glob above, which also matches this URL: a later
  // `page.route` takes precedence, so the more specific pattern has to come
  // last or it never runs.
  [
    '**/api/v1/audit-logs/stats**',
    () => ({
      total: 2,
      by_severity: { info: 1, warning: 1, critical: 0 },
      by_category: { authentication: 1, settings: 1 },
    }),
  ],

  // The security alerts screen rejects the catch-all `{}` for the same reason
  // as the audit log: "nothing waiting" over a broken endpoint is the wrong
  // answer. One open alert, so the pass measures its actions.
  [
    '**/api/v1/security/alerts**',
    () => ({
      alerts: [
        {
          id: 'alert-1',
          alert_type: 'brute_force',
          threat_level: 'high',
          timestamp: new Date().toISOString(),
          description: 'Brute force attack detected from 198.51.100.4',
          source_ip: '198.51.100.4',
          user_id: null,
          details: { failed_attempts: 10, time_window: '1 hour' },
          acknowledged: false,
          acknowledged_by: null,
          acknowledged_at: null,
          resolved: false,
          resolved_by: null,
          resolved_at: null,
          resolution_note: null,
        },
      ],
      total: 1,
      counts: { open: 1, unacknowledged: 1, acknowledged: 0, resolved: 0 },
    }),
  ],
  ['**/api/v1/security/download-activity**', () => ({ exports: [] })],

  // Both pages print these numbers straight into stat tiles, so the catch-all
  // `{}` rendered "NaN MB" and a bare "%" — screenshots of a broken page that
  // the real API, whose schemas make every field required, never produces.
  [
    '**/api/v1/documents/stats/summary**',
    () => ({ total_documents: 48, total_folders: 6, total_size_bytes: 157_286_400, documents_this_month: 5 }),
  ],
  [
    '**/api/v1/analytics/metrics**',
    () => ({
      total_scans: 1_284,
      successful_check_ins: 1_197,
      failed_check_ins: 87,
      success_rate: 93.2,
      avg_time_to_check_in: 14,
      device_breakdown: { mobile: 1_032, desktop: 141, tablet: 98, unknown: 13 },
      error_breakdown: { expired_qr: 52, outside_window: 35 },
      hourly_activity: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: hour >= 7 && hour <= 20 ? 40 + hour : 2,
      })),
    }),
  ],

  // Dues. The page prints the summary straight into stat tiles and threw on
  // the catch-all's `{}` (`collectionRate.toFixed`), so every visit measured
  // the ErrorBoundary. A schedule and one member in each state a row can show;
  // the summary totals agree with them. Money is a string, as the API's
  // Decimal fields serialize. `dues**` also matches `dues-schedules` and
  // `dues/summary`, and a later route wins, so the list is registered first.
  [
    '**/api/v1/finance/dues**',
    () =>
      (
        [
          ['e2e-dues-1', 'Alex Tester', '150.00', 'paid', '2026-02-10T15:00:00Z'],
          ['e2e-dues-2', 'Jordan Captain', '75.00', 'partial', null],
          ['e2e-dues-3', 'Sam Probationary', '0.00', 'overdue', null],
          ['e2e-dues-4', 'Riley Lifetime', '0.00', 'waived', null],
        ] as const
      ).map(([id, memberName, amountPaid, status, paidDate]) => ({
        id,
        organizationId: 'e2e-org',
        duesScheduleId: 'e2e-dues-schedule',
        userId: `${id}-member`,
        amountDue: '150.00',
        amountPaid,
        status,
        dueDate: '2026-03-01T05:00:00Z',
        ...(paidDate ? { paidDate, paymentMethod: 'check' } : {}),
        ...(status === 'waived' ? { waivedAt: '2026-01-15T15:00:00Z', waiveReason: 'Life member' } : {}),
        memberName,
        createdAt: '2026-01-02T15:00:00Z',
        updatedAt: '2026-02-10T15:00:00Z',
      })),
  ],
  [
    '**/api/v1/finance/dues-schedules**',
    () => [
      {
        id: 'e2e-dues-schedule',
        organizationId: 'e2e-org',
        name: '2026 Annual Membership Dues',
        amount: '150.00',
        frequency: 'annual',
        dueDate: '2026-03-01T05:00:00Z',
        gracePeriodDays: 30,
        lateFeeAmount: '10.00',
        isActive: true,
        createdBy: TEST_USER.id,
        createdAt: '2026-01-02T15:00:00Z',
        updatedAt: '2026-01-02T15:00:00Z',
      },
    ],
  ],
  [
    '**/api/v1/finance/dues/summary**',
    () => ({
      totalExpected: '600.00',
      totalCollected: '225.00',
      totalOutstanding: '225.00',
      totalWaived: '150.00',
      collectionRate: 37.5,
      membersPaid: 1,
      membersOverdue: 1,
      membersWaived: 1,
    }),
  ],

  // Finance, with the fixtures declared above `routes`. Each general glob also
  // matches its own sub-paths (`fiscal-years**` matches `fiscal-years/options`),
  // so it is registered before the specific one that has to win.
  ['**/api/v1/finance/fiscal-years**', () => (empty ? [] : FISCAL_YEARS)],
  ['**/api/v1/finance/fiscal-years/options**', () => (empty ? [] : FISCAL_YEARS.map(fiscalYearOption))],
  ['**/api/v1/finance/budget-categories**', () => (empty ? [] : BUDGET_CATEGORIES)],
  ['**/api/v1/finance/budgets**', () => (empty ? [] : BUDGETS)],
  [
    '**/api/v1/finance/budgets/summary**',
    () => ({
      totalBudgeted: empty ? '0.00' : '195500.00',
      totalSpent: empty ? '0.00' : '133840.55',
      totalEncumbered: empty ? '0.00' : '25100.00',
      totalRemaining: empty ? '0.00' : '36559.45',
      percentUsed: empty ? 0 : 68.5,
      categoryBreakdown: [],
    }),
  ],
  [
    '**/api/v1/finance/my-budgets**',
    () =>
      empty
        ? []
        : BUDGETS.map((budget) => {
            const remaining =
              Number(budget.amountBudgeted) - Number(budget.amountSpent) - Number(budget.amountEncumbered);
            return {
              ...budget,
              amountRemaining: remaining.toFixed(2),
              percentUsed: Math.round((1 - remaining / Number(budget.amountBudgeted)) * 1000) / 10,
            };
          }),
  ],
  // Every page's navigation asks this, so it keeps the catch-all's answer:
  // owning a line would add a navigation entry to every route the sweeps measure.
  ['**/api/v1/finance/my-budgets/summary**', () => ({})],
  ['**/api/v1/finance/charge-access**', () => ({ categories: empty ? [] : BUDGET_CATEGORIES, positions: [] })],
  [
    '**/api/v1/finance/budget-amendments/pending**',
    () =>
      empty
        ? []
        : [
            {
              id: 'e2e-amend-1',
              organizationId: 'e2e-org',
              budgetId: 'e2e-budget-2',
              amount: '8500.00',
              reason: 'Grant award for turnout gear replacement',
              approvedBy: 'Board of Commissioners',
              approvedOn: '2026-02-09',
              enteredByName: 'Alex Tester',
              status: 'pending',
              categoryName: 'Personal Protective Equipment',
              fiscalYearId: 'e2e-fy-2026',
              fiscalYearName: 'FY 2026',
              yearLocked: false,
              createdAt: '2026-02-10T15:00:00Z',
            },
          ],
  ],
  ['**/api/v1/finance/budget-requests**', () => (empty ? [] : BUDGET_REQUESTS)],
  [
    '**/api/v1/finance/budget-requests/proposal-options**',
    () => ({
      positions: [{ id: 'e2e-position-chief', name: 'Fire Chief' }],
      categories: BUDGET_CATEGORIES.map(({ id, name }) => ({ id, name })),
      stations: [{ id: 'e2e-station-1', name: 'Station 1' }],
    }),
  ],
  [
    '**/api/v1/finance/budget-requests/my-lines**',
    () => ({
      fiscalYear: fiscalYearOption(FY_2027),
      // Two lines the member's position owns, one already requested and one
      // not, so both the submitted card and the blank request form are drawn.
      lines: empty
        ? []
        : BUDGETS.slice(0, 2).map((budget) => ({
            budget: {
              ...budget,
              fiscalYearId: FY_2027.id,
              fiscalYearName: FY_2027.name,
              fiscalYearStatus: FY_2027.status,
            },
            request:
              BUDGET_REQUESTS.find(
                (request) => request.categoryId === budget.categoryId && request.status === 'submitted'
              ) ?? null,
            lastYearFiscalYearName: FY_2026.name,
            lastYearBudgeted: budget.amountBudgeted,
            lastYearSpent: budget.amountSpent,
          })),
    }),
  ],
  ['**/api/v1/finance/purchase-requests**', () => (empty ? [] : PURCHASE_REQUESTS)],
  ['**/api/v1/finance/expense-reports**', () => (empty ? [] : EXPENSE_REPORTS)],
  ['**/api/v1/finance/check-requests**', () => (empty ? [] : CHECK_REQUESTS)],
  [
    '**/api/v1/finance/my-dues**',
    () =>
      empty
        ? []
        : [
            {
              id: 'e2e-mydues-1',
              scheduleName: '2026 Annual Membership Dues',
              amountDue: '150.00',
              amountPaid: '75.00',
              balance: '75.00',
              status: 'partial',
              dueDate: '2026-03-01T05:00:00Z',
              payments: [
                { id: 'e2e-mydues-pay-1', amount: '75.00', paymentMethod: 'check', receivedAt: '2026-02-01T15:00:00Z' },
              ],
            },
            {
              id: 'e2e-mydues-2',
              scheduleName: '2025 Annual Membership Dues',
              amountDue: '150.00',
              amountPaid: '150.00',
              balance: '0.00',
              status: 'paid',
              dueDate: '2025-03-01T05:00:00Z',
              paidDate: '2025-02-14T15:00:00Z',
              payments: [
                { id: 'e2e-mydues-pay-2', amount: '150.00', paymentMethod: 'cash', receivedAt: '2025-02-14T15:00:00Z' },
              ],
            },
          ],
  ],
  ['**/api/v1/finance/approvals/pending**', () => (empty ? [] : PENDING_APPROVALS)],
  [
    '**/api/v1/finance/approvals/unrouted**',
    () =>
      empty
        ? []
        : [
            {
              entityType: 'check_request',
              entityId: 'e2e-cr-1',
              entityTitle: 'Oakville Ladies Auxiliary',
              entityAmount: '750.00',
              requesterName: 'Alex Tester',
              submittedAt: '2026-02-06T15:00:00Z',
            },
          ],
  ],
  [
    '**/api/v1/finance/approval-chains**',
    () =>
      empty
        ? []
        : [
            {
              id: 'e2e-chain',
              name: 'Purchases over $1,000',
              description: 'Chief, then the treasurer, for anything over a thousand dollars',
              appliesTo: 'purchase_request',
              minAmount: '1000.00',
              isDefault: false,
              isActive: true,
              ...FINANCE_STAMP,
              steps: [
                ['e2e-chain-step-1', 1, 'Chief approval', 'Fire Chief'],
                ['e2e-chain-step-2', 2, 'Treasurer review', 'Treasurer'],
              ].map(([id, stepOrder, name, approverValue]) => ({
                id,
                chainId: 'e2e-chain',
                stepOrder,
                name,
                stepType: 'approval',
                approverType: 'position',
                approverValue,
                allowSelfApproval: false,
                required: true,
                createdAt: '2026-01-02T15:00:00Z',
              })),
            },
          ],
  ],
  ['**/api/v1/finance/approval-chains/approver-coverage**', () => []],
  // The reports screen opens on this one for the active year; the others run
  // only when picked. Built from BUDGETS so its lines agree with /finance/budgets.
  [
    '**/api/v1/finance/reports/budget-vs-actual**',
    (request) => {
      const rows = empty
        ? []
        : BUDGETS.map((budget) => {
            const spent = Number(budget.amountSpent);
            const committed = Number(budget.amountEncumbered);
            const total = Number(budget.amountBudgeted);
            return {
              budgetId: budget.id,
              categoryName: budget.categoryName,
              originalBudget: budget.amountBudgeted,
              amendments: '0.00',
              budget: budget.amountBudgeted,
              spent: budget.amountSpent,
              committed: budget.amountEncumbered,
              remaining: (total - spent - committed).toFixed(2),
              percentUsed: Math.round(((spent + committed) / total) * 1000) / 10,
              runningSpentDiffers: false,
            };
          });
      const sum = (key: 'originalBudget' | 'budget' | 'spent' | 'committed' | 'remaining') =>
        rows.reduce((total, row) => total + Number(row[key]), 0).toFixed(2);
      return {
        fiscalYearId: FY_2026.id,
        fiscalYearName: FY_2026.name,
        asOf: new URL(request.url()).searchParams.get('as_of') ?? FY_2026.endDate,
        includesCommitted: true,
        rows,
        totals: {
          originalBudget: sum('originalBudget'),
          amendments: '0.00',
          budget: sum('budget'),
          spent: sum('spent'),
          committed: sum('committed'),
          remaining: sum('remaining'),
        },
      };
    },
  ],
  [
    '**/api/v1/finance/settings/budget-request-reminders**',
    () => ({ offsetsDays: [30, 7, 1], bellNotices: true, isDefault: true }),
  ],

  // Grants & fundraising, with the fixtures declared above `routes`. The
  // opportunity list is `/grants?…`; the applications screen asks once per
  // status, so the answer is filtered by the request's own `status`.
  ['**/api/v1/grants?**', () => (empty ? [] : GRANT_OPPORTUNITIES)],
  [
    '**/api/v1/grants/applications**',
    (request) => {
      const status = new URL(request.url()).searchParams.get('status');
      return empty ? [] : GRANT_APPLICATIONS.filter((app) => !status || app.applicationStatus === status);
    },
  ],
  ['**/api/v1/grants/campaigns**', () => (empty ? [] : FUNDRAISING_CAMPAIGNS)],
  ['**/api/v1/grants/donors**', () => (empty ? [] : DONORS)],
  ['**/api/v1/grants/donations**', () => (empty ? [] : DONATIONS)],
  ['**/api/v1/grants/pledges**', () => (empty ? [] : PLEDGES)],
  ['**/api/v1/grants/fundraising-events**', () => (empty ? [] : FUNDRAISING_EVENTS)],
  // Zeffy connected, with one campaign linked and one payment of each kind a
  // reviewer sorts: applied, and waiting on a decision.
  [
    '**/api/v1/grants/zeffy/status**',
    () => ({
      connected: !empty,
      integrationId: empty ? null : 'e2e-zeffy',
      webhookConfigured: !empty,
      lastSyncAt: empty ? null : '2026-02-12T14:00:00Z',
      stateCounts: empty ? {} : { applied: 1, needs_review: 1 },
    }),
  ],
  ['**/api/v1/grants/zeffy/campaigns**', () => []],
  [
    '**/api/v1/grants/zeffy/links**',
    () =>
      empty
        ? []
        : [
            {
              id: 'e2e-zlink-1',
              zeffyCampaignId: 'zf-camp-1',
              zeffyCampaignTitle: 'Thermal Imaging Camera Drive',
              targetType: 'fundraising_campaign',
              targetId: 'e2e-camp-1',
              targetName: 'Thermal Imaging Camera Drive',
              applyFrom: '2026-01-15',
              syncedThrough: '2026-02-12T14:00:00Z',
              createdAt: '2026-01-15T15:00:00Z',
              updatedAt: '2026-02-12T14:00:00Z',
            },
          ],
  ],
  [
    '**/api/v1/grants/zeffy/payments**',
    () => {
      const payment = (id: string, payerName: string, amount: string, state: string, donationId: string | null) => ({
        id,
        zeffyPaymentId: `zf-${id}`,
        zeffyCampaignId: 'zf-camp-1',
        campaignTitle: 'Thermal Imaging Camera Drive',
        campaignCategory: 'donation',
        paymentType: 'donation',
        zeffyStatus: 'succeeded',
        refundStatus: null,
        amount,
        refundedAmount: '0.00',
        currency: 'USD',
        ticketCount: 0,
        paidAt: '2026-02-11T18:30:00Z',
        payerName,
        receiptUrl: null,
        state,
        stateDetail: state === 'needs_review' ? 'More than one donor matches this payer' : null,
        appliedTargetType: donationId ? 'fundraising_campaign' : null,
        donationId,
        fundraisingEventId: null,
        memberDuesId: null,
        appliedAmount: donationId ? amount : '0.00',
        updatedAt: '2026-02-12T14:00:00Z',
      });
      const items = empty
        ? []
        : [
            payment('zpay-1', 'Margaret Okafor', '250.00', 'applied', 'e2e-don-1'),
            payment('zpay-2', 'D. Alvarez', '100.00', 'needs_review', null),
          ];
      return { items, total: items.length };
    },
  ],
  // Reports: money is Decimal, so a string, except monthlyTotals, which the
  // service builds as an untyped list of floats.
  [
    '**/api/v1/grants/reports/grants**',
    () => ({
      totalApplications: empty ? 0 : GRANT_APPLICATIONS.length,
      totalRequested: empty ? '0' : '1148000.00',
      totalAwarded: empty ? '0' : '15000.00',
      totalSpent: empty ? '0' : '9420.75',
      successRate: empty ? '0' : '50.0',
      awardedCount: empty ? 0 : 1,
      deniedCount: empty ? 0 : 1,
      complianceSummary: {
        totalTasks: empty ? 0 : 4,
        completed: empty ? 0 : 2,
        overdue: empty ? 0 : 1,
        pending: empty ? 0 : 1,
      },
      spendingByCategory: empty ? {} : { equipment: '7800.00', training: '1620.75' },
    }),
  ],
  [
    '**/api/v1/grants/reports/fundraising**',
    () => ({
      totalDonations: empty ? '0' : '18075.00',
      donationCount: empty ? 0 : DONATIONS.length,
      uniqueDonors: empty ? 0 : 3,
      averageGift: empty ? '0' : '4518.75',
      donationsByMethod: empty ? {} : { check: '15500.00', bank_transfer: '2500.00', cash: '75.00' },
      monthlyTotals: empty
        ? []
        : [
            { month: '2026-01', total: 15075.0 },
            { month: '2026-02', total: 3000.0 },
          ],
    }),
  ],

  ['**/api/v1/medical-supplies/lots/expiring**', () => []],
  ['**/api/v1/medical-supplies/categories**', () => []],
  ['**/api/v1/medical-supplies/items**', () => ({ items: [], total: 0, skip: 0, limit: 200 })],
  ['**/api/v1/medical-supplies/recalls**', () => []],

  // The department store's admin page. Unmocked, the catch-all's `{}` reached
  // StoreSettingsTab as a settings object with no `notifyEmails`, which the
  // API never sends (the schema turns a stored null into `[]`), and the tab
  // threw on `.join` — so every Store route in the mobile sweeps was measuring
  // a page of error toasts. Shapes, not stubs: a store set up but quiet.
  [
    '**/api/v1/store/settings',
    () => ({
      id: 'store-settings-1',
      organizationId: 'e2e-org',
      isEnabled: true,
      storeName: 'Department Store',
      tagline: null,
      description: null,
      currency: 'USD',
      showOpenOrderBanner: true,
      acceptedPaymentMethods: ['cash', 'check'],
      paymentPolicy: 'before_pickup',
      checkPayableTo: 'Oakville Fire Department',
      cashInstructions: 'Pay at the station office.',
      taxRate: '0.0600',
      shippingFlatRate: null,
      allowPickup: true,
      allowShipping: false,
      pickupLocation: 'Station 1',
      notifyEmails: ['quartermaster@example.com'],
      notifyAdminsOnOrder: true,
      sendOrderConfirmation: true,
      sendStatusUpdates: true,
      sendPaymentReminders: true,
      sendPaymentReceipts: true,
      sendWindowOpened: true,
      sendWindowClosingReminder: true,
      sendWindowClosed: true,
      sendVendorOrderUpdates: false,
      paymentReminderDays: 3,
      windowReminderHours: 24,
      termsText: null,
      receiptFooter: null,
    }),
  ],
  [
    '**/api/v1/store/dashboard',
    () => ({
      isEnabled: true,
      activeWindow: null,
      newOrderCount: 0,
      openOrderCount: 0,
      awaitingPaymentCount: 0,
      pendingVerificationCount: 0,
      readyForPickupCount: 0,
      outstandingBalance: '0.00',
      collectedThisWindow: '0.00',
      activeProductCount: 0,
      statusCounts: {},
      recentActivity: [],
      recentOrders: [],
    }),
  ],

  // Every Administration hub reads this. Unmocked, the catch-all answered `{}`
  // — truthy, so `AdminHubFrame` rendered the attention queue, but with no
  // `attention` array, and the page died on `items.length`. No hub route had
  // ever reached this code: they are all gated on a `*.manage` grant the base
  // fixture does not hold, so the loop was measuring Access Denied and the
  // crash sat behind it. A shape, not a stub, so the frame gets what the API
  // actually promises.
  [
    '**/api/v1/admin-hub/*/summary**',
    () => ({
      moduleKey: 'scheduling',
      generatedAt: new Date().toISOString(),
      timezone: 'UTC',
      metrics: [
        { key: 'shifts_needing_closeout', label: 'To close out', value: '1', context: 'waiting 1 day', fixed: false },
        { key: 'needs_attention', label: 'Needs attention', value: '0', context: 'nothing waiting', fixed: true },
      ],
      attention: [],
    }),
  ],

  ['**/api/v1/notifications/my', () => (empty ? { logs: [] } : notificationLogs())],
  ['**/api/v1/notifications/my?**', () => (empty ? { logs: [] } : notificationLogs())],
  ['**/api/v1/notifications/my/unread-count', () => ({ unread_count: empty ? 0 : 1 })],

  ['**/api/v1/messages/inbox**', () => []],
  ['**/api/v1/messages/inbox/unread-count', () => ({ unread_count: 0 })],
  ['**/api/v1/messages/threads**', () => ({ threads: [], total: 0 })],

  ['**/api/v1/scheduling/my-shifts**', () => (empty ? { shifts: [], total: 0 } : myShifts())],
  ['**/api/v1/scheduling/shifts/open**', () => []],
  // Registered after `/shifts/open` and before the generic entries below, the
  // same ordering the real router needs: a literal segment behind a path
  // parameter is unreachable.
  [
    '**/api/v1/scheduling/shifts/needing-closeout**',
    () => (empty ? { shifts: [], total: 0, skip: 0, limit: 200 } : closeoutBacklog()),
  ],
  // Stated rather than left to the catch-all. `{}` happens to resolve, so the
  // store marks the settings loaded and falls back to its defaults — the queue
  // renders either way, but only by accident, and a fixture nobody can read is
  // one nobody will maintain. `detailed` is the default mode, which is the
  // branch where a row offers "Open the shift to close it".
  [
    '**/api/v1/scheduling/settings**',
    () => ({
      platoons_enabled: platoonsEnabled,
      require_end_of_shift_checks: false,
      call_tracking: { mode: 'detailed', call_types: [] },
      signup_closes_minutes_before: 0,
      late_signup_grace_minutes: 60,
      open_ended_shift_cushion_hours: 12,
    }),
  ],
  ['**/api/v1/scheduling/summary**', () => ({ hours_worked_this_month: 24 })],
  ['**/api/v1/scheduling/reports**', () => ({ reports: [], total: 0 })],
  [
    '**/api/v1/scheduling/reports/member-hours**',
    () => ({ members: [], period_start: '2026-08-01', period_end: '2026-08-20', total_members: 0 }),
  ],
  ['**/api/v1/ranks**', () => []],
  // The admin banner in the app shell maps over this list; none is the state
  // of a scanned installation.
  ['**/api/v1/system-notices', () => []],
  // The rank ladder under Members Administration reads these. Without them the
  // catch-all above fulfils both with `{}`, and the section maps over it.
  ['**/api/v1/operational-ranks', () => []],
  ['**/api/v1/operational-ranks?**', () => []],
  ['**/api/v1/operational-ranks/validate**', () => ({ issues: [], total: 0 })],
  // The membership ladder, with rungs rather than an empty list: this section's
  // reorder, rights and remove controls only exist once a tier renders, and an
  // empty ladder would ratchet a screen that has none of them on it. The counts
  // are what make the remove button's disabled state reachable.
  [
    '**/api/v1/users/membership-tiers/config**',
    () => ({
      auto_advance: true,
      tiers: [
        { id: 'probationary', name: 'Probationary', years_required: 0, sort_order: 0, benefits: {} },
        {
          id: 'active',
          name: 'Active Member',
          years_required: 1,
          sort_order: 1,
          benefits: { voting_eligible: true, can_hold_office: true },
        },
      ],
      member_counts: { active: 2 },
    }),
  ],

  ['**/api/v1/admin-hours/summary**', () => ({ totalHours: 8 })],

  ['**/api/v1/training/module-config/my-training**', () => ({ hours_summary: { total_hours: 12 } })],
  // Per-enrollment progress detail. The service fetches
  // `/enrollments/{id}` — not `/{id}/progress` — so this glob must stay a
  // single trailing segment, and must be registered before the `/me` route
  // below so `/enrollments/me` still resolves to the enrollment list.
  [
    '**/api/v1/training/programs/enrollments/*',
    () => ({
      requirement_progress: [
        { id: 'req-1', requirement: { name: 'Written Exam' }, status: 'not_started' },
        { id: 'req-2', requirement: { name: 'Practical Skills' }, status: 'in_progress' },
      ],
      time_remaining_days: 45,
    }),
  ],
  ['**/api/v1/training/programs/enrollments/me**', () => (empty ? [] : enrollments())],

  ['**/api/v1/inventory/summary**', () => ({})],
  ['**/api/v1/inventory/low-stock**', () => []],
  ['**/api/v1/inventory/items**', () => ({ items: [], total: 0 })],
  ['**/api/v1/inventory/categories**', () => []],
  ['**/api/v1/inventory/storage-areas**', () => []],
  ['**/api/v1/inventory/vendors**', () => []],
  ['**/api/v1/inventory/summary/by-location**', () => []],
  ['**/api/v1/inventory/not-seen**', () => ({ items: [], total: 0, cutoff: new Date().toISOString() })],
  ['**/api/v1/locations**', () => []],

  [
    '**/api/v1/facilities/dashboard**',
    () => ({
      totalFacilities: 0,
      operationalFacilities: 0,
      overdueMaintenance: 0,
      upcomingInspections: 0,
      overdueMaintenanceRecords: [],
      upcomingInspectionRecords: [],
      recentMaintenanceCompletions: [],
    }),
  ],
  ['**/api/v1/facilities/page**', () => ({ items: [], total: 0, skip: 0, limit: 24 })],
  ['**/api/v1/facilities/types**', () => []],
  ['**/api/v1/facilities/statuses**', () => []],
  ['**/api/v1/facilities/maintenance-types**', () => []],

  ['**/api/v1/forms**', () => ({ forms: [], total: 0 })],
  ['**/api/v1/prospective-members**', () => ({ applicants: [], total: 0 })],
  ['**/api/v1/members**', () => ({ members: [], users: [], total: 0 })],
  ['**/api/v1/settings**', () => ({})],
  ['**/api/v1/events**', () => []],

  // After the broad `events**` glob above for the same reason: it matches this
  // URL too, and the last matching route registered is the one that answers.
  [
    '**/api/v1/events/*/check-in-monitoring**',
    () => ({
      event_id: '1',
      event_name: 'Monthly Drill',
      event_type: 'training',
      created_by_name: 'Alex Tester',
      start_datetime: new Date().toISOString(),
      end_datetime: new Date(Date.now() + 7_200_000).toISOString(),
      is_check_in_active: true,
      check_in_window_start: new Date(Date.now() - 900_000).toISOString(),
      check_in_window_end: new Date(Date.now() + 7_200_000).toISOString(),
      total_eligible_members: 24,
      total_rsvps: 18,
      total_checked_in: 12,
      check_in_rate: 50,
      recent_check_ins: [],
      early_check_ins: [],
      early_check_in_count: 0,
      early_check_in_threshold_minutes: 30,
      avg_check_in_time_minutes: null,
      last_check_in_at: null,
    }),
  ],
  // After `events**` for the same reason as check-in monitoring above.
  ['**/api/v1/events/settings', eventSettings],
  [
    '**/api/v1/event-requests/email-templates**',
    () => [
      {
        id: 'tpl-1',
        name: 'Request received confirmation',
        subject: 'We received your request',
        body_html: '<p>Thank you, {{contact_name}}.</p>',
        trigger: 'on_submitted',
        is_active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  ],
  ['**/api/v1/event-requests/forms**', () => ({ forms: [], total: 0, skip: 0, limit: 50 })],
  // The Requests tab's triage list. Without these the phone sweep measured only
  // the tab's load-error state, so the list and the drawer it opens had no
  // layout coverage at all. One request per open group, one closed.
  ['**/api/v1/event-requests', () => (empty ? [] : EVENT_REQUESTS)],
  // One route per request, so the drawer the sweep opens shows the row it
  // clicked, not one shared detail behind every id.
  ...EVENT_REQUESTS.map((request): [string, () => unknown] => [
    `**/api/v1/event-requests/${request.id}`,
    () => ({ ...request, ...EVENT_REQUEST_DETAIL }),
  ]),
  ['**/api/v1/dashboard/community-engagement**', () => COMMUNITY_ENGAGEMENT],
  ['**/api/v1/admin-hub/events/metrics', eventMetricSettings],
  ['**/api/v1/admin-hub/training/metrics', trainingMetricSettings],
  // The notifications page lists rules and needs a list, not the catch-all
  // `{}`. One enabled rule, so the list renders a row.
  [
    '**/api/v1/notifications/rules**',
    () => ({
      rules: [
        {
          id: 'rule-1',
          organization_id: 'org-1',
          name: 'New Assignment',
          trigger: 'schedule_change',
          category: 'scheduling',
          channel: 'email',
          enabled: true,
          enforced: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      total: 1,
    }),
  ],
  ...(memberRecord ? memberRecordRoutes() : []),
];

const memberRecordRoutes = (): [string, () => unknown][] => [
  [
    '**/api/v1/users/*/with-roles',
    () => ({
      ...TEST_USER,
      organization_id: 'org-1',
      full_name: `${TEST_USER.first_name} ${TEST_USER.last_name}`,
      membership_number: '100',
      status: 'active',
      membership_type: 'active',
      emergency_contacts: [],
      roles: [],
    }),
  ],
  // The audit-history page reads the member's name here rather than from
  // `with-roles`, which records a profile view.
  [
    '**/api/v1/users/*/roles',
    () => ({
      user_id: TEST_USER.id,
      username: TEST_USER.username,
      full_name: `${TEST_USER.first_name} ${TEST_USER.last_name}`,
      roles: [],
    }),
  ],
  ['**/api/v1/users/*/audit-history**', () => []],

  // Member evaluations: one in progress, and the member's figures measured
  // now, so the evaluation pages are measured with their content rather than
  // an empty state.
  ['**/api/v1/evaluations?**', () => [EVALUATION_SUMMARY]],
  ['**/api/v1/evaluations', () => [EVALUATION_SUMMARY]],
  ['**/api/v1/evaluations/mine', () => [EVALUATION_SUMMARY]],
  [
    '**/api/v1/evaluations/draft-options',
    () => ({
      members: [
        { id: TEST_USER.id, name: `${TEST_USER.first_name} ${TEST_USER.last_name}` },
        { id: 'e2e-evaluator', name: 'Jordan Captain' },
      ],
      evaluators: [{ id: 'e2e-evaluator', name: 'Jordan Captain' }],
      periods: [{ id: 'e2e-period', name: '2026 Annual Review', start_date: '2026-01-01', end_date: '2026-12-31' }],
    }),
  ],
  [
    '**/api/v1/evaluations/mine/live-data',
    () => ({
      period_id: 'e2e-period',
      period_name: '2026 Annual Review',
      coverage_start: '2026-01-01',
      coverage_end: '2026-11-01',
      excluded_ranges: [],
      sources: [
        {
          key: 'training.hours',
          label: 'Training hours',
          unit: 'hours',
          module: 'training',
          description: 'Hours of completed training records in the period.',
          scoreable: true,
        },
        {
          key: 'events.meeting_attendance_pct',
          label: 'Business meeting attendance',
          unit: 'percent',
          module: 'events',
          description: 'Business meetings attended out of those held.',
          scoreable: true,
        },
      ],
      data: {
        'training.hours': { available: true, value: 42.5 },
        'events.meeting_attendance_pct': { available: true, value: 75, attended: 6, held: 8 },
      },
      note: null,
    }),
  ],
];

const EVALUATION_SUMMARY = {
  id: 'e2e-evaluation',
  member: { id: TEST_USER.id, name: `${TEST_USER.first_name} ${TEST_USER.last_name}` },
  evaluator: { id: 'e2e-evaluator', name: 'Jordan Captain' },
  period_id: 'e2e-period',
  period_name: '2026 Annual Review',
  period_start: '2026-01-01',
  period_end: '2026-12-31',
  template_name: 'Operational Annual',
  kind: 'annual',
  status: 'in_progress',
  current_step: 'Self-evaluation',
  current_step_due: '2027-01-14',
  created_at: '2026-11-01T12:00:00Z',
};

const GENERATED_AT = '2026-11-01T12:00:00Z';
const PERIOD = { period_start: '2026-01-01', period_end: '2026-12-31' };

const reportTypeOf = (request: Request): string => {
  const body: unknown = request.postDataJSON();
  return body && typeof body === 'object' && 'report_type' in body ? String(body.report_type) : '';
};

/**
 * A report of the requested type with nothing in it: every list present and
 * empty, every count zero, as `reports_service` returns for a department with
 * no records. Each is checked against the app's own type, so a report whose
 * shape changes breaks this fixture at the type check rather than at runtime.
 */
const emptyReport = (type: string): unknown => {
  switch (type) {
    case 'member_roster':
      return {
        report_type: 'member_roster',
        generated_at: GENERATED_AT,
        total_members: 0,
        active_members: 0,
        inactive_members: 0,
        members: [],
      } satisfies MemberRosterReport;
    case 'training_summary':
      return {
        report_type: 'training_summary',
        generated_at: GENERATED_AT,
        ...PERIOD,
        total_courses: 0,
        total_records: 0,
        completion_rate: 0,
        entries: [],
        course_breakdown: [],
        requirement_breakdown: [],
      } satisfies TrainingSummaryReport;
    case 'event_attendance':
      return {
        report_type: 'event_attendance',
        generated_at: GENERATED_AT,
        ...PERIOD,
        total_events: 0,
        average_attendance_rate: 0,
        events: [],
      } satisfies EventAttendanceReport;
    case 'training_progress':
      return {
        report_type: 'training_progress',
        generated_at: GENERATED_AT,
        total_enrollments: 0,
        status_summary: {},
        average_progress: 0,
        entries: [],
      } satisfies TrainingProgressReport;
    case 'annual_training':
      return {
        report_type: 'annual_training',
        generated_at: GENERATED_AT,
        ...PERIOD,
        year: 2026,
        summary: {
          total_members: 0,
          total_training_hours: 0,
          total_shift_hours: 0,
          total_combined_hours: 0,
          total_completions: 0,
          total_calls_responded: 0,
          avg_hours_per_member: 0,
          training_by_type: {},
        },
        entries: [],
      } satisfies AnnualTrainingReport;
    case 'admin_hours':
      return {
        report_type: 'admin_hours',
        generated_at: GENERATED_AT,
        ...PERIOD,
        summary: { total_hours: 0, total_entries: 0, unique_members: 0, hours_by_category: {} },
        entries: [],
      } satisfies AdminHoursReport;
    case 'department_overview':
      return {
        report_type: 'department_overview',
        generated_at: GENERATED_AT,
        ...PERIOD,
        members: { total: 0, active: 0, inactive: 0 },
        training: { total_records: 0, completed: 0, completion_rate: 0, total_hours: 0, avg_hours_per_member: 0 },
        events: { total_events: 0, total_checkins: 0 },
        action_items: { open_from_meetings: 0, open_from_minutes: 0 },
      } satisfies DepartmentOverviewReport;
    case 'certification_expiration':
      return {
        report_type: 'certification_expiration',
        generated_at: GENERATED_AT,
        total_certifications: 0,
        expired_count: 0,
        expiring_soon_count: 0,
        valid_count: 0,
        no_expiry_count: 0,
        entries: [],
      } satisfies CertExpirationReport;
    case 'apparatus_status':
      return {
        report_type: 'apparatus_status',
        generated_at: GENERATED_AT,
        total_apparatus: 0,
        in_service_count: 0,
        out_of_service_count: 0,
        maintenance_due_count: 0,
        entries: [],
      } satisfies ApparatusStatusReport;
    case 'inventory_status':
      return {
        report_type: 'inventory_status',
        generated_at: GENERATED_AT,
        total_items: 0,
        low_stock_count: 0,
        assigned_count: 0,
        entries: [],
      } satisfies InventoryStatusReport;
    case 'compliance_status':
      return {
        report_type: 'compliance_status',
        generated_at: GENERATED_AT,
        total_members: 0,
        fully_compliant_count: 0,
        partially_compliant_count: 0,
        non_compliant_count: 0,
        not_applicable_count: 0,
        overall_compliance_rate: null,
        entries: [],
      } satisfies ComplianceStatusReport;
    case 'call_volume':
      return {
        report_type: 'call_volume',
        generated_at: GENERATED_AT,
        ...PERIOD,
        summary: {
          total_calls: 0,
          avg_calls_per_day: 0,
          busiest_day: '',
          busiest_day_count: 0,
          by_type_totals: {},
        },
        entries: [],
      } satisfies CallVolumeReport;
    case 'pipeline_overview':
      return {
        report_type: 'pipeline_overview',
        generated_at: GENERATED_AT,
        pipeline_name: 'Membership',
        total_applicants: 0,
        active_applicants: 0,
        converted_count: 0,
        rejected_count: 0,
        withdrawn_count: 0,
        on_hold_count: 0,
        avg_days_to_convert: 0,
        conversion_rate: 0,
        yearly_trends: [],
        referral_sources: [],
        groups: [],
        prospects: [],
      } satisfies PipelineOverviewReport;
    default:
      return {};
  }
};

/**
 * Fulfil every `/api/v1/**` request with fixture data.
 *
 * Call before navigating to a protected page. `page.goto` must already have
 * put the page on the app origin if the caller also seeds localStorage.
 */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<void> {
  for (const [glob, body] of routes(options)) {
    await page.route(glob, (route) => {
      const payload = body(route.request());
      void route.fulfill(json(options.longText ? lengthen(payload) : payload));
    });
  }
}

/**
 * Mark the browser as holding a session and install the API fixtures.
 *
 * Auth uses httpOnly cookies, so there is no token to plant. The `has_session`
 * flag is the only client-side signal, and it just tells `loadUser` that
 * calling `/auth/me` is worthwhile.
 */
export async function signIn(page: Page, options: MockOptions = {}): Promise<void> {
  // Install routes before the first document load. Login mounts branding and
  // onboarding queries immediately; registering afterward leaked them to the
  // dev-server proxy and made every workflow wait for failed network calls.
  await mockApi(page, options);
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('has_session', '1');
  });
}

/** Ensure no session flag is set, so ProtectedRoute redirects to /login. */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.removeItem('has_session');
  });
}

/**
 * Sign in and land on the dashboard, ready for assertions.
 */
export async function gotoDashboard(page: Page, options: MockOptions = {}): Promise<void> {
  await signIn(page, options);
  await page.goto('/dashboard');
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

/**
 * The sidebar/topbar navigation region.
 *
 * The app renders mobile and desktop variants of the same controls
 * simultaneously (Tailwind `sm:hidden` / `hidden sm:inline`), so an unscoped
 * text locator matches twice and trips Playwright's strict mode. Scope to the
 * navigation landmark and take the first match.
 */
/**
 * Locate text that the layout renders twice — once inside a `sm:hidden` mobile
 * element and once inside a `hidden sm:inline` desktop one.
 *
 * Both copies are in the DOM at every viewport; only one is visible. Plain
 * `.first()` therefore picks whichever comes first in source order, which is
 * the mobile copy and is invisible on a desktop viewport. Filtering to the
 * visible match keeps the assertion viewport-agnostic.
 */
export function visibleText(page: Page, text: string) {
  return page.locator(`text=${text} >> visible=true`).first();
}

export function navItem(page: Page, name: RegExp | string) {
  return page.locator('aside, nav').getByRole('button', { name }).first();
}

/**
 * Make the full navigation reachable at the current viewport.
 *
 * A desktop shows the side navigation permanently. A phone shows a bottom bar
 * with a few tabs and keeps everything else — the grouped sections and Logout —
 * in a drawer opened by "More". Opening it only when the bar is on screen keeps
 * one spec valid at both widths instead of one per layout.
 */
export async function openNavigation(page: Page) {
  const more = page.getByRole('button', { name: /^More/ });
  const navigation = page.locator('aside, nav').getByRole('button');

  // The layout mounts after the session resolves, so neither control is on
  // screen the instant the page loads; deciding on an instant check skips the
  // drawer on a phone whenever the bar is a moment late.
  await more.or(navigation).first().waitFor({ state: 'visible' });
  if (await more.isVisible()) {
    await more.click();
  }
}
