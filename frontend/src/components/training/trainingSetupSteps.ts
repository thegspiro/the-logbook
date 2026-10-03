/**
 * The training setup guide's steps, and where its dismissal is remembered.
 * Kept apart from the component so that file exports only a component.
 */

import type { TrainingDashboardSummary } from '../../services/trainingServices';

export const SETUP_GUIDE_HIDDEN_KEY = 'training_setup_guide_hidden';

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
  done: boolean;
  optional?: boolean;
}

export const buildSetupSteps = (stats: TrainingDashboardSummary['stats']): SetupStep[] => [
  {
    id: 'courses',
    title: 'Add the courses your department teaches or accepts',
    description:
      'A course is one class, such as Firefighter I or CPR, with the hours it is worth. Members and officers pick from this list when training is recorded.',
    href: '/training/admin?page=setup&tab=courses',
    action: 'Open the Course Library',
    done: stats.active_courses > 0,
  },
  {
    id: 'requirements',
    title: 'Create your training requirements',
    description:
      'A requirement is what each member must complete, such as 24 hours a year or a current CPR card. Compliance on this dashboard is measured against them.',
    href: '/training/admin?page=setup&tab=requirements',
    action: 'Open Requirements',
    done: stats.active_requirements > 0,
  },
  {
    id: 'session',
    title: 'Put a first training session on the calendar',
    description:
      'Members check in at the session. When you approve the attendance, the hours are credited to each of them automatically.',
    href: '/training/admin?page=records&tab=sessions',
    action: 'Create a session',
    done: stats.training_sessions > 0,
  },
  {
    id: 'program',
    title: 'Build a training program',
    description:
      'A program is a step-by-step path toward a role, such as probationary firefighter to full member. Enroll members and track their progress in one place.',
    href: '/training/admin?page=setup&tab=pipelines',
    action: 'Open Pipelines',
    done: stats.active_programs > 0,
    optional: true,
  },
];
