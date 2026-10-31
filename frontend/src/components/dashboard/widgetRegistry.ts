/**
 * One declarative source of truth for operational dashboard widgets.
 *
 * The API paths intentionally point at the module that owns each workflow;
 * widgets consume aggregates and link to filtered queues instead of loading
 * sensitive record collections into the dashboard.
 *
 * Most of this file is design intent, not a description of what runs (DASH-1,
 * owner decision 2026-10-05: mark the unwired entries rather than build or
 * delete them). `wired` and `aggregateEndpoint` say which parts are real, so
 * the next contributor wiring a widget does not trust a path that was never
 * built. `widgetRegistry.test.ts` holds `wired` to the actual
 * `dashboardWidget(...)` readers in the source tree.
 */
export interface DashboardWidgetDefinition {
  id: string;
  title: string;
  permission: string;
  aggregatePath: string;
  queuePath: string;
  defaultEnabled: boolean | 'while-incomplete';
  /** True only when a screen reads this entry through `dashboardWidget()`. */
  wired: boolean;
  /**
   * Whether `aggregatePath` resolves to a mounted backend route. `not-built`
   * means the endpoint does not exist and a fetch would 404; building it, with
   * its own permission scoping, comes before wiring the widget.
   */
  aggregateEndpoint: 'mounted' | 'not-built';
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  {
    id: 'prospect-pipeline',
    title: 'Prospective-member pipeline',
    // Counts every applicant, so it takes what sees every applicant.
    permission: 'prospective_members.view_all',
    aggregatePath: '/prospective-members/widget-summary',
    queuePath: '/prospective-members?status=active',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'mounted',
  },
  {
    id: 'onboarding-completion',
    title: 'Onboarding completion',
    permission: 'members.manage',
    aggregatePath: '/onboarding/widget-summary',
    queuePath: '/onboarding?status=incomplete',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'not-built',
  },
  {
    id: 'membership-status',
    title: 'Membership status changes',
    permission: 'members.manage',
    aggregatePath: '/users/status/widget-summary',
    queuePath: '/members?status_change=pending',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'not-built',
  },
  {
    id: 'leave-oversight',
    title: 'Leave of absence',
    permission: 'members.manage',
    aggregatePath: '/users/leaves-of-absence/widget-summary',
    queuePath: '/members?leave=active',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'mounted',
  },
  {
    id: 'admin-hours',
    title: 'Admin-hours approvals',
    permission: 'admin_hours.manage',
    aggregatePath: '/admin-hours/widget-summary',
    queuePath: '/admin-hours/manage?status=pending',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'not-built',
  },
  {
    id: 'meeting-governance',
    title: 'Meeting governance',
    permission: 'minutes.view',
    aggregatePath: '/meetings/widget-summary',
    queuePath: '/minutes?status=pending',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'not-built',
  },
  {
    id: 'communications',
    title: 'Communications acknowledgment',
    permission: 'notifications.manage',
    aggregatePath: '/messages/widget-summary',
    queuePath: '/messages/manage?acknowledgment=pending',
    defaultEnabled: true,
    wired: false,
    aggregateEndpoint: 'not-built',
  },
  {
    id: 'department-setup',
    title: 'Organization setup',
    permission: 'settings.manage',
    aggregatePath: '/organization/setup-checklist',
    queuePath: '/setup',
    defaultEnabled: 'while-incomplete',
    wired: true,
    aggregateEndpoint: 'mounted',
  },
] as const;

export const dashboardWidget = (id: string) => DASHBOARD_WIDGETS.find((widget) => widget.id === id);
