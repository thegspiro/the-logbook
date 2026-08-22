export const TRAINING_WIDGET_METADATA = {
  'compliance-overview': { title: 'Compliance Overview', module: 'training', permission: 'training.manage' },
  'upcoming-expirations': { title: 'Upcoming Expirations', module: 'training', permission: 'training.manage' },
  'recent-completions': { title: 'Recent Completions', module: 'training', permission: 'training.manage' },
  'training-hours': { title: 'Training Hours Summary', module: 'training', permission: 'training.manage' },
  'requirements-status': { title: 'Requirements Status', module: 'training', permission: 'training.manage' },
  'members-needing-intervention': {
    title: 'Members Needing Intervention',
    module: 'training',
    permission: 'training.manage',
  },
  'upcoming-session-capacity': {
    title: 'Upcoming Session Capacity',
    module: 'training',
    permission: 'training.manage',
  },
  'pending-validation': { title: 'Pending Validation', module: 'training', permission: 'training.manage' },
  'requirements-at-risk': { title: 'Requirements at Risk', module: 'training', permission: 'training.manage' },
} as const;
export type TrainingWidgetId = keyof typeof TRAINING_WIDGET_METADATA;
