/**
 * Sections of the shift-planning screen.
 *
 * Planning a stretch of calendar used to be three unconnected places: the
 * templates that say what a shift is, the patterns that repeat it, and — for
 * the gaps the generation leaves — the shift board, one day at a time. They are
 * one screen now, in the order the work happens: see what is short, then fix
 * the pattern or the template that keeps leaving it short.
 *
 * Each section is its own route, so a section can be linked to and bookmarked,
 * and `planningSections.ts` is the one place those URLs are written down —
 * the routes, the hub cards and this screen's own nav all read them from here.
 */

import { CalendarRange, ClipboardList, Repeat } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type PlanningSection = 'gaps' | 'templates' | 'patterns';

export interface PlanningSectionDef {
  key: PlanningSection;
  label: string;
  icon: LucideIcon;
  description: string;
  path: string;
}

export const PLANNING_SECTIONS: PlanningSectionDef[] = [
  {
    key: 'gaps',
    label: 'Staffing gaps',
    icon: CalendarRange,
    description: 'Upcoming shifts carrying fewer people than they ask for',
    path: '/scheduling/admin/planning',
  },
  {
    key: 'templates',
    label: 'Templates',
    icon: ClipboardList,
    description: 'The shapes a shift comes in — hours, crew seats and vehicle',
    path: '/scheduling/admin/planning/templates',
  },
  {
    key: 'patterns',
    label: 'Patterns',
    icon: Repeat,
    description: 'Repeating rotations, and generating a stretch of calendar from them',
    path: '/scheduling/admin/planning/patterns',
  },
];

/** Where a section is reached. Falls back to the gaps view for an unknown key. */
export const planningPathFor = (section: PlanningSection): string =>
  PLANNING_SECTIONS.find((entry) => entry.key === section)?.path ?? '/scheduling/admin/planning';
