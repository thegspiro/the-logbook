/**
 * One declarative source of truth for operational dashboard widgets.
 *
 * The API paths intentionally point at the module that owns each workflow;
 * widgets consume aggregates and link to filtered queues instead of loading
 * sensitive record collections into the dashboard.
 */
export interface DashboardWidgetDefinition {
  id: string;
  title: string;
  permission: string;
  aggregatePath: string;
  queuePath: string;
  defaultEnabled: boolean | 'while-incomplete';
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  {
    id: 'prospect-pipeline',
    title: 'Prospective-member pipeline',
    permission: 'prospective_members.view',
    aggregatePath: '/membership-pipeline/widget-summary',
    queuePath: '/prospective-members?status=active',
    defaultEnabled: true,
  },
  {
    id: 'onboarding-completion',
    title: 'Onboarding completion',
    permission: 'members.manage',
    aggregatePath: '/onboarding/widget-summary',
    queuePath: '/onboarding?status=incomplete',
    defaultEnabled: true,
  },
  {
    id: 'membership-status',
    title: 'Membership status changes',
    permission: 'members.manage',
    aggregatePath: '/users/status/widget-summary',
    queuePath: '/members?status_change=pending',
    defaultEnabled: true,
  },
  {
    id: 'leave-oversight',
    title: 'Leave of absence',
    permission: 'members.manage',
    aggregatePath: '/users/leaves-of-absence/widget-summary',
    queuePath: '/members?leave=active',
    defaultEnabled: true,
  },
  {
    id: 'admin-hours',
    title: 'Admin-hours approvals',
    permission: 'admin_hours.manage',
    aggregatePath: '/admin-hours/widget-summary',
    queuePath: '/admin-hours/manage?status=pending',
    defaultEnabled: true,
  },
  {
    id: 'meeting-governance',
    title: 'Meeting governance',
    permission: 'minutes.view',
    aggregatePath: '/meetings/widget-summary',
    queuePath: '/minutes?status=pending',
    defaultEnabled: true,
  },
  {
    id: 'communications',
    title: 'Communications acknowledgment',
    permission: 'notifications.manage',
    aggregatePath: '/messages/widget-summary',
    queuePath: '/messages/manage?acknowledgment=pending',
    defaultEnabled: true,
  },
  {
    id: 'department-setup',
    title: 'Organization setup',
    permission: 'settings.manage',
    aggregatePath: '/organizations/setup-checklist',
    queuePath: '/setup',
    defaultEnabled: 'while-incomplete',
  },
] as const;

export const dashboardWidget = (id: string) => DASHBOARD_WIDGETS.find((widget) => widget.id === id);
