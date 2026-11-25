/**
 * This year's outreach goals on Outreach Impact: each figure against its
 * target and its pace. Goals run for the calendar year, so the section shows
 * the current year whichever period the page is set to, and says so.
 */

import React from 'react';
import { Link } from 'react-router';
import { Target } from 'lucide-react';
import type { OutreachGoalYear } from '../../services/outreachGoalServices';
import GoalProgressBar from './GoalProgressBar';
import { GOAL_SETTINGS_PATH } from './goalProgress';

interface OutreachGoalsSectionProps {
  goals: OutreachGoalYear;
}

const OutreachGoalsSection: React.FC<OutreachGoalsSectionProps> = ({ goals }) => (
  <section className="card mb-5 p-4" aria-labelledby="ce-goals-heading">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 id="ce-goals-heading" className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
          Goals for {goals.year}
        </h3>
        <p className="text-theme-text-muted mt-0.5 text-xs">
          Goals run for the calendar year, whichever period is chosen above. The mark on each bar is where it should be
          by now.
        </p>
      </div>
      <Link to={GOAL_SETTINGS_PATH} className="btn-secondary btn-sm">
        {goals.goals.length ? 'Edit goals' : 'Set goals'}
      </Link>
    </div>
    {goals.goals.length ? (
      <ul className="space-y-4">
        {goals.goals.map((goal) => (
          <li key={goal.id}>
            <GoalProgressBar goal={goal} yearComplete={goals.year_complete} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-theme-text-muted text-sm">
        No goals set for {goals.year}. Set a target for events held, people reached, member hours or any CRR count.
      </p>
    )}
  </section>
);

export default OutreachGoalsSection;
