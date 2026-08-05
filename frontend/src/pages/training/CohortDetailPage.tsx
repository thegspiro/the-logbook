/**
 * Cohort Detail
 *
 * The management surface for a running course: the class timeline with live
 * attendance counts, and the roster with each member's pipeline progress.
 *
 * Recruit schools change — instructors call out, weather moves an evolution,
 * a make-up class gets added. Every one of those is an action here rather than
 * fifteen manual edits in the events UI: reschedule one class, cancel one,
 * add an ad-hoc class, or slide everything still to come by N days.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { courseCohortService } from '../../services/api';
import { SkeletonPage } from '../../components/ux/Skeleton';
import { EmptyState } from '../../components/ux/EmptyState';
import { ConfirmDialog } from '../../components/ux/ConfirmDialog';
import DateTimeQuarterHour from '../../components/ux/DateTimeQuarterHour';
import { useTimezone } from '../../hooks/useTimezone';
import {
  formatDate,
  formatForDateTimeInput,
  formatShortDateTime,
  localToUTC,
} from '../../utils/dateFormatting';
import {
  COHORT_CLASS_STATUS_COLORS,
  COHORT_MEMBER_STATUS_COLORS,
  COHORT_STATUS_COLORS,
  COHORT_STATUS_LABELS,
  CohortClassStatus,
} from '../../constants/enums';
import { getErrorMessage } from '../../utils/errorHandling';
import type {
  CourseCohortClass,
  CourseCohortDetail,
} from '../../types/training';

type TabId = 'classes' | 'roster';

export const CohortDetailPage: React.FC = () => {
  const { cohortId } = useParams<{ cohortId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();

  const [cohort, setCohort] = useState<CourseCohortDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('classes');
  const [busy, setBusy] = useState(false);

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState('');
  const [cancelTarget, setCancelTarget] = useState<CourseCohortClass | null>(
    null,
  );
  const [showShift, setShowShift] = useState(false);
  const [shiftDays, setShiftDays] = useState('7');
  const [removeTarget, setRemoveTarget] = useState<{
    userId: string;
    name: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!cohortId) return;
    setLoading(true);
    try {
      setCohort(await courseCohortService.getCohort(cohortId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the cohort'));
    } finally {
      setLoading(false);
    }
  }, [cohortId]);

  useEffect(() => {
    void load();
  }, [load]);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const handleReschedule = (item: CourseCohortClass) =>
    withBusy(async () => {
      if (!cohortId || !rescheduleValue) return;
      try {
        const utcStart = localToUTC(rescheduleValue, tz);
        const durationMs =
          new Date(item.scheduled_end).getTime() -
          new Date(item.scheduled_start).getTime();
        await courseCohortService.rescheduleClass(cohortId, item.id, {
          scheduled_start: utcStart,
          scheduled_end: new Date(
            new Date(utcStart).getTime() + durationMs,
          ).toISOString(),
        });
        toast.success('Class moved — the calendar event moved with it');
        setReschedulingId(null);
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not move the class'));
      }
    });

  const handleCancelClass = () =>
    withBusy(async () => {
      if (!cohortId || !cancelTarget) return;
      try {
        await courseCohortService.cancelClass(
          cohortId,
          cancelTarget.id,
          'Cancelled by the training officer',
        );
        toast.success('Class cancelled — attendees will see the cancellation');
        setCancelTarget(null);
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not cancel the class'));
      }
    });

  const handleShift = () =>
    withBusy(async () => {
      if (!cohortId) return;
      const days = Number(shiftDays);
      if (!days) {
        toast.error('Enter a number of days');
        return;
      }
      try {
        const result = await courseCohortService.shiftClasses(cohortId, {
          days,
        });
        toast.success(
          `Moved ${result.success_count} upcoming class${result.success_count === 1 ? '' : 'es'}`,
        );
        setShowShift(false);
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not shift the schedule'));
      }
    });

  const handleRegenerate = () =>
    withBusy(async () => {
      if (!cohortId) return;
      try {
        const result = await courseCohortService.regenerate(cohortId);
        if (result.success_count === 0) {
          toast.success('Every class already has an event');
        } else {
          toast.success(
            `Created ${result.success_count} missing event${result.success_count === 1 ? '' : 's'}`,
          );
        }
        result.warnings.forEach((w) => toast.error(w));
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not regenerate events'));
      }
    });

  const handleRemoveMember = () =>
    withBusy(async () => {
      if (!cohortId || !removeTarget) return;
      try {
        await courseCohortService.removeMember(cohortId, removeTarget.userId);
        toast.success('Member withdrawn from the cohort');
        setRemoveTarget(null);
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not remove the member'));
      }
    });

  if (loading) return <SkeletonPage />;

  if (!cohort) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          icon={AlertTriangle}
          title="Cohort not found"
          description="It may have been removed, or you may not have access to it."
          actions={[
            {
              label: 'Back to cohorts',
              onClick: () => { void navigate('/training/cohorts'); },
            },
          ]}
        />
      </div>
    );
  }

  const missingEvents = cohort.classes.filter(
    (c) => !c.event_id && c.status !== CohortClassStatus.CANCELLED,
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => { void navigate('/training/cohorts'); }}
        className="mb-4 flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>All cohorts</span>
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-theme-text-primary">
              {cohort.name}
            </h1>
            <span
              className={`badge ${COHORT_STATUS_COLORS[cohort.status] ?? ''}`}
            >
              {COHORT_STATUS_LABELS[cohort.status] ?? cohort.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-theme-text-muted">
            {cohort.course_name} · starts {formatDate(cohort.start_date, tz)}
            {cohort.program_name ? ` · ${cohort.program_name}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShift((s) => !s)}
            disabled={busy}
            className="btn-icon flex items-center gap-2 border border-theme-surface-border px-3 text-sm"
          >
            <CalendarClock className="h-4 w-4" />
            <span>Shift remaining</span>
          </button>
          {missingEvents > 0 && (
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={busy}
              className="btn-icon flex items-center gap-2 border border-amber-500/40 px-3 text-sm text-amber-700 dark:text-amber-400"
            >
              <RefreshCw className="h-4 w-4" />
              <span>
                Create {missingEvents} missing event
                {missingEvents === 1 ? '' : 's'}
              </span>
            </button>
          )}
        </div>
      </div>

      {showShift && (
        <div className="card-secondary mb-6 flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="form-label" htmlFor="shift-days">
              Move upcoming classes by
            </label>
            <input
              id="shift-days"
              type="number"
              value={shiftDays}
              onChange={(e) => setShiftDays(e.target.value)}
              className="form-input md:max-w-[10rem]"
            />
            <p className="mt-1 text-xs text-theme-text-muted">
              Days. Negative pulls the schedule forward. Classes that already
              happened are left alone.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleShift()}
            disabled={busy}
            className="btn-primary"
          >
            Apply
          </button>
        </div>
      )}

      <div className="tab-scroll mb-4">
        {(
          [
            { id: 'classes' as const, label: `Classes (${cohort.classes.length})` },
            { id: 'roster' as const, label: `Roster (${cohort.members.length})` },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`mobile-touch-target whitespace-nowrap px-4 text-sm ${
              tab === t.id
                ? 'border-b-2 border-red-500 font-medium text-theme-text-primary'
                : 'text-theme-text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'classes' && (
        <ol className="space-y-2">
          {cohort.classes.map((item) => {
            const cancelled = item.status === CohortClassStatus.CANCELLED;
            return (
              <li
                key={item.id}
                className={`card-secondary p-4 ${cancelled ? 'opacity-60' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-theme-surface text-xs font-semibold">
                        {item.sequence}
                      </span>
                      <span className="font-medium text-theme-text-primary">
                        {item.title}
                      </span>
                      <span
                        className={`badge ${COHORT_CLASS_STATUS_COLORS[item.status] ?? ''}`}
                      >
                        {item.status}
                      </span>
                      {!item.event_id && !cancelled && (
                        <span className="badge bg-amber-500/20 text-amber-700 dark:text-amber-400">
                          No event
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-theme-text-secondary">
                      {formatShortDateTime(item.scheduled_start, tz)}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                      {item.credit_hours != null && (
                        <span>{item.credit_hours} credits</span>
                      )}
                      {item.instructor && <span>{item.instructor}</span>}
                      {item.rsvp_count != null && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {item.rsvp_count} signed up
                        </span>
                      )}
                      {item.checked_in_count != null &&
                        item.checked_in_count > 0 && (
                          <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" />
                            {item.checked_in_count} attended
                          </span>
                        )}
                      {item.event_id && (
                        <Link
                          to={`/events/${item.event_id}`}
                          className="flex items-center gap-1 text-red-700 hover:underline dark:text-red-400"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Event
                        </Link>
                      )}
                    </div>

                    {cancelled && item.cancellation_reason && (
                      <p className="mt-1 text-xs text-theme-text-muted">
                        {item.cancellation_reason}
                      </p>
                    )}
                  </div>

                  {!cancelled && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setReschedulingId(item.id);
                          setRescheduleValue(
                            formatForDateTimeInput(item.scheduled_start, tz),
                          );
                        }}
                        className="btn-icon"
                        aria-label={`Reschedule ${item.title}`}
                        title="Reschedule"
                      >
                        <CalendarClock className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelTarget(item)}
                        className="btn-icon hover:text-red-700 dark:hover:text-red-400"
                        aria-label={`Cancel ${item.title}`}
                        title="Cancel class"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {reschedulingId === item.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-theme-surface-border pt-3">
                    <DateTimeQuarterHour
                      value={rescheduleValue}
                      onChange={(value: string) => setRescheduleValue(value)}
                    />
                    <button
                      type="button"
                      onClick={() => void handleReschedule(item)}
                      disabled={busy}
                      className="btn-primary"
                    >
                      Move class
                    </button>
                    <button
                      type="button"
                      onClick={() => setReschedulingId(null)}
                      className="btn-icon px-3"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            );
          })}

          {cohort.classes.length === 0 && (
            <EmptyState
              icon={CalendarRange}
              title="No classes on this cohort"
              description="Generation may not have run yet."
            />
          )}
        </ol>
      )}

      {tab === 'roster' && (
        <div className="space-y-2">
          {cohort.members.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="Nobody on the roster yet"
              description="Add members so they see the classes on their calendar and earn credit as they attend."
            />
          ) : (
            <ul className="space-y-2">
              {cohort.members.map((member) => (
                <li
                  key={member.id}
                  className="card-secondary flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-theme-text-primary">
                        {member.full_name ?? 'Member'}
                      </span>
                      <span
                        className={`badge ${COHORT_MEMBER_STATUS_COLORS[member.status] ?? ''}`}
                      >
                        {member.status}
                      </span>
                    </div>
                    {member.email && (
                      <p className="text-xs text-theme-text-muted">
                        {member.email}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {member.progress_percentage != null && (
                      <div className="w-32">
                        <div className="mb-1 flex justify-between text-xs text-theme-text-muted">
                          <span>Progress</span>
                          <span>{Math.round(member.progress_percentage)}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-theme-surface">
                          <div
                            className="h-1.5 rounded-full bg-red-600"
                            style={{
                              width: `${Math.min(100, member.progress_percentage)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {member.enrollment_id && (
                      <Link
                        to={`/training/my-progress/${member.enrollment_id}`}
                        className="text-xs text-red-700 hover:underline dark:text-red-400"
                      >
                        View progress
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setRemoveTarget({
                          userId: member.user_id,
                          name: member.full_name ?? 'this member',
                        })
                      }
                      className="btn-icon hover:text-red-700 dark:hover:text-red-400"
                      aria-label={`Remove ${member.full_name ?? 'member'}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={cancelTarget !== null}
        title="Cancel this class?"
        message={`"${cancelTarget?.title ?? 'This class'}" will be marked cancelled and its calendar event cancelled too, so anyone signed up sees the change. The class stays on the cohort for the record.`}
        confirmLabel="Cancel class"
        variant="danger"
        loading={busy}
        onConfirm={() => void handleCancelClass()}
        onClose={() => setCancelTarget(null)}
      />

      <ConfirmDialog
        isOpen={removeTarget !== null}
        title="Remove from this cohort?"
        message={`${removeTarget?.name ?? 'This member'} will be withdrawn from the roster and taken off the classes still to come. Their pipeline enrollment, training records, and any class they already attended are kept.`}
        confirmLabel="Remove"
        variant="warning"
        loading={busy}
        onConfirm={() => void handleRemoveMember()}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
};

export default CohortDetailPage;
