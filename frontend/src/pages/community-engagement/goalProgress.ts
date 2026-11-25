/**
 * How a yearly outreach goal reads: its status and its share of the target.
 * Every figure comes from the server (OutreachGoalService); this only words
 * them, so the settings list, Outreach Impact and the Overview agree.
 */

import type { OutreachGoalProgress } from '../../services/outreachGoalServices';
import { formatNumber } from '../../utils/dateFormatting';

/** Events Settings, opened on its goals section. */
export const GOAL_SETTINGS_PATH = '/events/admin?tab=settings&section=goals';

export type GoalStatus = 'met' | 'missed' | 'on_pace' | 'behind';

export const goalStatus = (goal: OutreachGoalProgress, yearComplete: boolean): GoalStatus => {
  if (goal.met) return 'met';
  if (yearComplete) return 'missed';
  return goal.on_pace ? 'on_pace' : 'behind';
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  met: 'Met',
  missed: 'Missed',
  on_pace: 'On pace',
  behind: 'Behind pace',
};

/** Share of the target reached, 0–100, for the bar; past 100 reads as full. */
export const goalPercent = (goal: OutreachGoalProgress): number =>
  goal.target > 0 ? Math.min(100, Math.round((goal.actual / goal.target) * 100)) : 0;

/** Where the pace marker sits on the bar, 0–100. */
export const pacePercent = (goal: OutreachGoalProgress): number =>
  goal.target > 0 ? Math.min(100, Math.round((goal.pace_target / goal.target) * 100)) : 0;

/** "120 of 200": member hours can be fractional, and say so. */
export const goalFigures = (goal: OutreachGoalProgress): string =>
  `${formatNumber(goal.actual)} of ${formatNumber(goal.target)}`;

/** The goals furthest behind their pace first, for the Overview. */
export const behindPace = (goals: OutreachGoalProgress[]): OutreachGoalProgress[] =>
  goals
    .filter((g) => !g.met && !g.on_pace)
    .sort((a, b) => a.actual / a.pace_target - b.actual / b.pace_target || a.label.localeCompare(b.label));
