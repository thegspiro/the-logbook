/**
 * One yearly outreach goal: its name, how far it has got, a bar with a mark
 * where it should be by now, and whether it is on pace.
 */

import React from 'react';
import type { OutreachGoalProgress } from '../../services/outreachGoalServices';
import { GOAL_STATUS_LABELS, goalFigures, goalPercent, goalStatus, pacePercent } from './goalProgress';

const STATUS_TONE = {
  met: 'text-green-900 dark:text-green-300',
  on_pace: 'text-green-900 dark:text-green-300',
  behind: 'text-red-900 dark:text-red-300',
  missed: 'text-red-900 dark:text-red-300',
} as const;

interface GoalProgressBarProps {
  goal: OutreachGoalProgress;
  yearComplete: boolean;
}

const GoalProgressBar: React.FC<GoalProgressBarProps> = ({ goal, yearComplete }) => {
  const status = goalStatus(goal, yearComplete);
  const percent = goalPercent(goal);
  const pace = pacePercent(goal);
  const statusLabel = GOAL_STATUS_LABELS[status];
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="text-theme-text-primary min-w-0 font-medium">{goal.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-theme-text-secondary tabular-nums">
            {goalFigures(goal)} ({Math.round((goal.actual / goal.target) * 100)}%)
          </span>
          <span className={`text-xs font-semibold ${STATUS_TONE[status]}`}>{statusLabel}</span>
        </span>
      </div>
      <div
        className="bg-theme-surface-secondary border-theme-surface-border relative mt-1 h-2.5 overflow-hidden rounded-full border"
        role="progressbar"
        aria-label={goal.label}
        aria-valuemin={0}
        aria-valuemax={goal.target}
        aria-valuenow={Math.min(goal.actual, goal.target)}
        aria-valuetext={`${goalFigures(goal)}, ${statusLabel.toLowerCase()}`}
      >
        <div className="h-full rounded-full bg-red-800 dark:bg-red-400" style={{ width: `${percent}%` }} />
        {!yearComplete && pace > 0 && pace < 100 && (
          <div
            className="bg-theme-text-primary absolute top-0 h-full w-0.5"
            style={{ left: `${pace}%` }}
            aria-hidden="true"
            title="Where the goal should be by now"
          />
        )}
      </div>
    </div>
  );
};

export default GoalProgressBar;
