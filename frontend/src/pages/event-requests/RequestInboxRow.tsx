import React from 'react';
import { AlertTriangle, CalendarClock, ChevronRight, UserPlus } from 'lucide-react';
import type { EventRequestListItem } from '../../types/event';
import { dateUrgency, nextStep, receivedAge, taskProgress, awaitingReplyTooLong } from './requestInbox';
import type { PipelineTaskConfig } from '../../types/event';

interface RequestInboxRowProps {
  request: EventRequestListItem;
  tasks: PipelineTaskConfig[];
  typeLabel: string;
  dateLabel: string;
  timezone: string;
  selected: boolean;
  /** Present only when the signed-in member can take an unassigned request. */
  onTake?: (() => void) | undefined;
  taking: boolean;
  onOpen: () => void;
  /** Wide screens put the coordinator and "Take it" beside the row; phones put them under it. */
  wide: boolean;
}

const initialsOf = (name: string): string =>
  name
    .replace(/^(Lt\.|FF|Chief|Capt\.|Capt|Lt|Sgt\.?)\s+/i, '')
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const CoordinatorChip: React.FC<{ name?: string | undefined; compact?: boolean }> = ({ name, compact }) =>
  name ? (
    <span className="text-theme-text-secondary inline-flex items-center gap-1.5 text-xs" title={name}>
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white"
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      <span className={compact ? 'sr-only' : ''}>{name}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-700 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 dark:border-amber-400 dark:text-amber-300">
      <UserPlus className="h-3 w-3" aria-hidden="true" />
      Unassigned
    </span>
  );

export const ChecklistBar: React.FC<{ done: number; total: number }> = ({ done, total }) =>
  total > 0 ? (
    <span className="inline-flex items-center gap-2">
      <span
        className="bg-theme-surface-hover inline-block h-1.5 w-14 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`Checklist: ${done} of ${total} done`}
      >
        <span className="block h-full rounded-full bg-green-700" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <span className="text-theme-text-muted text-xs" aria-hidden="true">
        {done}/{total}
      </span>
    </span>
  ) : null;

export const RequestDateLine: React.FC<{
  request: EventRequestListItem;
  dateLabel: string;
  timezone: string;
}> = ({ request, dateLabel, timezone }) => {
  const urgency = dateUrgency(request, timezone);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-theme-text-secondary inline-flex items-start gap-1.5">
        <CalendarClock className="text-theme-text-muted mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {dateLabel}
      </span>
      {urgency && (
        <span
          className={`rounded px-1.5 py-0.5 font-medium ${
            urgency.urgent
              ? 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-300'
              : 'bg-theme-surface-hover text-theme-text-secondary'
          }`}
        >
          {urgency.label}
        </span>
      )}
      {request.short_notice && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Short notice
        </span>
      )}
    </span>
  );
};

/**
 * One request in the triage list. The row itself opens the request; "Take it"
 * is a separate button beside it rather than nested inside, so both stay
 * reachable by keyboard and a screen reader announces them as two controls.
 */
const RequestInboxRow: React.FC<RequestInboxRowProps> = ({
  request,
  tasks,
  typeLabel,
  dateLabel,
  timezone,
  selected,
  onTake,
  taking,
  onOpen,
  wide,
}) => {
  const progress = taskProgress(request, tasks);
  const step = request.status === 'submitted' ? null : nextStep(request, tasks);
  const stale = awaitingReplyTooLong(request, timezone);
  const title = request.organization_name || request.contact_name;
  const hasSheet = request.staffing_slots_total != null && request.staffing_slots_filled != null;

  const takeButton = onTake && (
    <button
      type="button"
      onClick={onTake}
      disabled={taking}
      className="btn-secondary btn-sm flex items-center gap-1"
      // The visible words lead the name, so voice control's "click Take it" works.
      aria-label={`Take it: ${title}`}
    >
      <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
      Take it
    </button>
  );

  return (
    <li
      className={`border-theme-surface-border border-b last:border-b-0 ${
        selected ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-theme-surface-hover'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="min-w-0 flex-1 px-4 py-3 text-left focus-visible:outline-offset-[-2px]"
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-theme-text-primary font-medium">{title}</span>
            <span className="text-theme-text-muted text-sm">{typeLabel}</span>
            {request.organization_name && (
              <span className="text-theme-text-muted text-sm">· {request.contact_name}</span>
            )}
            <span
              className={`ml-auto text-xs ${stale ? 'font-medium text-red-800 dark:text-red-300' : 'text-theme-text-muted'}`}
            >
              {receivedAge(request.created_at, timezone)}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <RequestDateLine request={request} dateLabel={dateLabel} timezone={timezone} />
            {request.status === 'in_progress' && <ChecklistBar done={progress.done} total={progress.total} />}
            {hasSheet && (
              <span className="text-theme-text-muted text-xs">
                {request.staffing_slots_filled} of {request.staffing_slots_total} signed up
              </span>
            )}
          </span>
          {step && (
            <span className="text-theme-text-secondary mt-1 block text-xs">
              Next: <span className="font-medium">{step}</span>
            </span>
          )}
        </button>
        {wide && (
          <span className="flex shrink-0 items-center gap-3 pr-4">
            <CoordinatorChip name={request.assignee_name} compact={!!request.assignee_name} />
            {takeButton}
            <ChevronRight className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>
      {!wide && (
        <div className="flex items-center justify-between gap-3 px-4 pb-3">
          <CoordinatorChip name={request.assignee_name} />
          {takeButton}
        </div>
      )}
    </li>
  );
};

export default RequestInboxRow;
