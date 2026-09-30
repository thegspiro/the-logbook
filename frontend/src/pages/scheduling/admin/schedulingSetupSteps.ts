/**
 * The scheduling setup guide's steps, and where its dismissal is remembered.
 * Kept apart from the component so that file exports only a component.
 */

import type { SchedulingSummary } from '../../../modules/scheduling/services/api';

export const SCHEDULING_SETUP_GUIDE_HIDDEN_KEY = 'scheduling_setup_guide_hidden';

export interface SchedulingSetupStep {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
  done: boolean;
  optional?: boolean;
}

export const buildSchedulingSetupSteps = (summary: SchedulingSummary): SchedulingSetupStep[] => [
  {
    id: 'template',
    title: 'Create a shift template',
    description:
      'A template is a reusable shift: its hours, the seats it needs filled (officer, driver, firefighter) and the vehicle it staffs. Every shift you schedule starts from one.',
    href: '/scheduling/admin/planning/templates',
    action: 'Open Shift Templates',
    done: summary.active_templates > 0,
  },
  {
    id: 'pattern',
    title: 'Set up a repeating pattern',
    description:
      'A pattern repeats a template on a rotation, such as 24 on and 48 off, so you can generate weeks of shifts at once instead of one at a time.',
    href: '/scheduling/admin/planning/patterns',
    action: 'Open Shift Patterns',
    done: summary.active_patterns > 0,
    optional: true,
  },
  {
    id: 'shifts',
    title: 'Put shifts on the calendar',
    description:
      'Generate shifts from a pattern, or add a single shift with Create Shift on the Schedule page. Members can then see them and sign up for open seats.',
    href: '/scheduling',
    action: 'Go to the Schedule',
    done: summary.shifts_scheduled > 0,
  },
];
