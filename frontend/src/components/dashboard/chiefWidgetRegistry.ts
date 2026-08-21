export type ChiefWidgetKey =
  | 'operational_readiness'
  | 'critical_exceptions'
  | 'membership_health'
  | 'upcoming_command_dates'
  | 'period_trends'
  | 'pending_approvals';

export interface ChiefWidgetDefinition {
  key: ChiefWidgetKey;
  title: string;
  requiredAnyPermission: string[];
}

/**
 * Chief-facing widgets are delegated by ownership of their underlying data.
 * `settings.manage` is intentionally absent: organization configuration is not
 * authority to inspect schedules, member health, minutes, or approvals.
 */
export const CHIEF_WIDGET_REGISTRY: readonly ChiefWidgetDefinition[] = [
  { key: 'operational_readiness', title: 'Operational readiness', requiredAnyPermission: ['scheduling.manage'] },
  {
    key: 'critical_exceptions',
    title: 'Critical exceptions',
    requiredAnyPermission: [
      'meetings.manage',
      'minutes.manage',
      'scheduling.manage',
      'equipment_check.manage',
      'notifications.manage',
    ],
  },
  { key: 'membership_health', title: 'Membership health', requiredAnyPermission: ['members.manage'] },
  { key: 'upcoming_command_dates', title: 'Upcoming command dates', requiredAnyPermission: ['events.manage'] },
  { key: 'period_trends', title: 'Period-over-period trends', requiredAnyPermission: ['training.manage'] },
  { key: 'pending_approvals', title: 'Pending approvals', requiredAnyPermission: ['admin_hours.manage'] },
] as const;

export const canViewChiefDashboard = (checkPermission: (permission: string) => boolean) =>
  CHIEF_WIDGET_REGISTRY.some(({ requiredAnyPermission }) => requiredAnyPermission.some(checkPermission));
