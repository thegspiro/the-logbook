/**
 * One training requirement as a member's standing against it: the total, the
 * progress bar, the month-by-month hours and why a target was reduced.
 *
 * Shared by the member's own My Training page and the training officer's view
 * of that member, so the two read the same server figures the same way
 * (CLAUDE.md pitfall 29). `audience` only changes who the sentences address.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { RequirementMonthlyHours } from './RequirementMonthlyHours';
import { RequirementCourseList } from './RequirementCourseList';
import { countingWindowLabel } from '../../utils/requirementMonths';
import { formatCalendarDate, formatDate } from '../../utils/dateFormatting';
import { getProgressBarColor } from '../../utils/trainingColors';
import { excusedMonthsPhrase } from '../../utils/requirementMonths';
import { requirementUnitSuffix } from '../../utils/requirementUnits';
import type { RequirementDetail } from '../../types/training';

interface RequirementDetailCardProps {
  requirement: RequirementDetail;
  timezone: string;
  /** `self` addresses the member ("you"); `officer` describes them. */
  audience?: 'self' | 'officer';
}

export const RequirementDetailCard: React.FC<RequirementDetailCardProps> = ({
  requirement: req,
  timezone,
  audience = 'self',
}) => {
  // No session held yet: nothing to have attended, so neither met nor owed,
  // and not "0/0 - Complete" (workflow review W80-9).
  const notYetHeld = req.not_applicable === true;
  const isOverdue = !notYetHeld && req.days_until_due != null && req.days_until_due < 0 && !req.is_met;
  const isDueSoon =
    !notYetHeld && req.days_until_due != null && req.days_until_due <= 30 && req.days_until_due >= 0 && !req.is_met;
  const self = audience === 'self';
  const unitFor = (count: number) => requirementUnitSuffix(req.requirement_type, count);
  // A shift or call target is rounded down to whole units, so enough months
  // of leave can bring it to zero. That is met, and reads as such, not 0/0.
  const nothingOwed =
    !notYetHeld && req.required_hours === 0 && (req.original_required_hours ?? 0) > 0 && (req.waived_months ?? 0) > 0;

  return (
    <div
      className={`card p-4 ${isOverdue ? 'border-red-500/40' : isDueSoon ? 'border-yellow-500/30' : req.is_met ? 'border-green-500/20' : 'border-theme-surface-border'}`}
    >
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center space-x-2">
          {req.is_met ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700 dark:text-green-400" />
          ) : isOverdue ? (
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
          ) : notYetHeld ? (
            <Clock className="text-theme-text-muted h-5 w-5 shrink-0" />
          ) : (
            <Clock className="h-5 w-5 shrink-0 text-yellow-700 dark:text-yellow-400" />
          )}
          <div>
            <p className="text-theme-text-primary text-sm font-medium">{req.name}</p>
            {req.description && <p className="text-theme-text-muted mt-0.5 text-xs">{req.description}</p>}
          </div>
        </div>
        <div className="ml-4 shrink-0 text-right">
          <span
            className={`text-sm font-bold ${
              req.is_met
                ? 'text-green-700 dark:text-green-400'
                : isOverdue
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-theme-text-primary'
            }`}
          >
            {notYetHeld ? (
              <span className="text-theme-text-muted font-normal">No sessions held yet</span>
            ) : nothingOwed ? (
              <>Nothing owed (on leave)</>
            ) : (
              <>
                {req.completed_hours}/{req.required_hours}
                {unitFor(req.required_hours)}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {!notYetHeld && (
        <div className="bg-theme-surface-hover mb-2 h-2 w-full rounded-full">
          <div
            className={`h-2 rounded-full transition-all ${getProgressBarColor(req.progress_percentage, req.is_met, isOverdue)}`}
            style={{ width: `${Math.min(req.progress_percentage, 100)}%` }}
          />
        </div>
      )}

      <RequirementMonthlyHours requirement={req} />
      <RequirementCourseList requirement={req} timezone={timezone} />

      {/* Expired certification / blocks activity warning */}
      {req.blocks_activity && (
        <div className="mb-2 rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1.5">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">
            {self
              ? 'Certification expired — renew ASAP. This may prevent you from signing up for shifts.'
              : 'Certification expired. This may prevent the member from signing up for shifts.'}
          </p>
        </div>
      )}

      {/* Existing member inside the requirement's catch-up period */}
      {req.catch_up_deadline && !req.is_met && (
        <div className="mb-2 rounded-sm border border-blue-500/20 bg-blue-500/10 px-2 py-1">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            {self ? 'You joined' : 'This member joined'} before this requirement took effect.{' '}
            {self ? 'You have' : 'They have'} until {formatCalendarDate(req.catch_up_deadline)} to complete it, and it
            won&rsquo;t count against {self ? 'your' : 'their'} compliance before then.
          </p>
        </div>
      )}

      {/* Waiver adjustment notice */}
      {req.waived_months != null && req.waived_months > 0 && (
        <div className="mb-2 rounded-sm border border-blue-500/20 bg-blue-500/10 px-2 py-1">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Adjusted for {excusedMonthsPhrase(req)}
            {req.original_required_hours != null && req.original_required_hours !== req.required_hours && (
              <>
                {' '}
                (originally {req.original_required_hours}
                {unitFor(req.original_required_hours)},{' '}
                {nothingOwed ? (
                  <>so nothing is owed for this period</>
                ) : (
                  <>
                    adjusted to {req.required_hours}
                    {unitFor(req.required_hours)} for {req.active_months} active month
                    {req.active_months !== 1 ? 's' : ''}
                  </>
                )}
                )
              </>
            )}
          </p>
        </div>
      )}

      <div className="text-theme-text-muted flex items-center justify-between text-xs">
        <span className="capitalize">
          {req.frequency.replace('_', ' ')}
          {req.training_type ? ` (${req.training_type.replace('_', ' ')})` : ''}
        </span>
        <div className="flex items-center space-x-2">
          {notYetHeld ? (
            <span>Not graded until a session is held</span>
          ) : req.is_met ? (
            <span className="text-green-700 dark:text-green-400">Complete</span>
          ) : req.catch_up_deadline ? (
            <span>Due by {formatCalendarDate(req.catch_up_deadline)}</span>
          ) : req.cert_expired ? (
            <span className="font-medium text-red-700 dark:text-red-400">Expired — Renew ASAP</span>
          ) : isOverdue ? (
            <span className="font-medium text-red-700 dark:text-red-400">
              Overdue by {Math.abs(req.days_until_due ?? 0)} days
            </span>
          ) : req.days_until_due != null ? (
            <span className={isDueSoon ? 'text-yellow-700 dark:text-yellow-400' : ''}>
              Due: {formatDate(req.due_date, timezone)} ({req.days_until_due} days)
            </span>
          ) : req.monthly_hours && req.monthly_hours.length > 0 ? (
            <span>Counting {countingWindowLabel(req.monthly_hours)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
