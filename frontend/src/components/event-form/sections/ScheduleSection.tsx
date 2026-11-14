import React from 'react';
import { Clock, Repeat, AlertTriangle, Lock } from 'lucide-react';
import type { RecurrencePattern } from '../../../types/event';
import { formatForDateTimeInput } from '../../../utils/dateFormatting';
import DateTimeQuarterHour from '../../ux/DateTimeQuarterHour';
import { FormField } from '../../ux/FormField';
import {
  MONTHS,
  ORDINALS,
  RECURRENCE_PATTERNS,
  WEEKDAYS,
  checkboxClass,
  inputClass,
  labelClass,
  selectClass,
} from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface ScheduleSectionProps {
  model: Pick<
    EventFormModel,
    | 'tz'
    | 'formData'
    | 'update'
    | 'fieldErrors'
    | 'attendanceLocked'
    | 'scheduleLockHintId'
    | 'handleStartDateChange'
    | 'conflicts'
    | 'setDuration'
    | 'isRecurring'
    | 'setIsRecurring'
    | 'recurrencePattern'
    | 'setRecurrencePattern'
    | 'isRolling'
    | 'setIsRolling'
    | 'recurrenceEndDate'
    | 'handleRecurrenceEndDateChange'
    | 'recurrenceCustomDays'
    | 'setRecurrenceCustomDays'
    | 'recurrenceWeekOrdinal'
    | 'setRecurrenceWeekOrdinal'
    | 'recurrenceWeekday'
    | 'setRecurrenceWeekday'
    | 'recurrenceMonth'
    | 'setRecurrenceMonth'
    | 'newExceptionDate'
    | 'setNewExceptionDate'
    | 'recurrenceExceptions'
    | 'setRecurrenceExceptions'
  >;
  /** Offer the recurring-series controls under the schedule. */
  showRecurrence: boolean;
}

/** Start and end, conflicts, quick durations and, when offered, recurrence. */
export const ScheduleSection: React.FC<ScheduleSectionProps> = ({ model, showRecurrence }) => {
  const {
    tz,
    formData,
    update,
    fieldErrors,
    attendanceLocked,
    scheduleLockHintId,
    handleStartDateChange,
    conflicts,
    setDuration,
    isRecurring,
    setIsRecurring,
    recurrencePattern,
    setRecurrencePattern,
    isRolling,
    setIsRolling,
    recurrenceEndDate,
    handleRecurrenceEndDateChange,
    recurrenceCustomDays,
    setRecurrenceCustomDays,
    recurrenceWeekOrdinal,
    setRecurrenceWeekOrdinal,
    recurrenceWeekday,
    setRecurrenceWeekday,
    recurrenceMonth,
    setRecurrenceMonth,
    newExceptionDate,
    setNewExceptionDate,
    recurrenceExceptions,
    setRecurrenceExceptions,
  } = model;
  return (
    <section className="space-y-6">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
        <Clock className="h-5 w-5 text-red-700" />
        <span>Schedule</span>
      </h2>
      {attendanceLocked && (
        <p id={scheduleLockHintId} className="text-theme-text-muted flex items-center gap-1.5 text-sm">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Locked while attendance is finalized.
        </p>
      )}

      {/* A disabled fieldset disables every control inside it, including the
          date and time pickers, which have no disabled prop of their own. */}
      <fieldset
        disabled={attendanceLocked}
        aria-describedby={attendanceLocked ? scheduleLockHintId : undefined}
        className="min-w-0 space-y-6 disabled:opacity-60"
      >
        {/* Every control inside is disabled and out of the tab order, so
            the group's name is what a screen reader announces on reaching it. */}
        {attendanceLocked && <legend className="sr-only">Schedule, locked while attendance is finalized</legend>}
        {/* Side by side only from lg: a date and three time selects need about
            380px, and a tablet's half-width column is under 200. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FormField id="start-datetime" label="Start Date & Time" required error={fieldErrors.start_datetime}>
            {(field) => (
              <DateTimeQuarterHour
                {...field}
                timeLabel="Start time"
                value={formData.start_datetime}
                onChange={(val) => handleStartDateChange(val)}
                className={inputClass}
              />
            )}
          </FormField>
          <FormField id="end-datetime" label="End Date & Time" required error={fieldErrors.end_datetime}>
            {(field) => (
              <DateTimeQuarterHour
                {...field}
                timeLabel="End time"
                value={formData.end_datetime}
                onChange={(val) => update({ end_datetime: val })}
                className={inputClass}
              />
            )}
          </FormField>
        </div>

        {/* Conflict Warning */}
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4" role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-700 dark:text-yellow-400" />
              <div>
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">Schedule Conflict</p>
                <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                  This time overlaps with {conflicts.length === 1 ? 'an event' : 'events'} you have RSVP&apos;d to:
                </p>
                <ul className="mt-2 space-y-1">
                  {conflicts.map((evt) => (
                    <li key={evt.id} className="text-sm text-yellow-700 dark:text-yellow-300">
                      &bull; {evt.title} ({formatForDateTimeInput(evt.start_datetime, tz)} &ndash;{' '}
                      {formatForDateTimeInput(evt.end_datetime, tz)})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Quick Duration */}
        <div>
          <span className={labelClass}>Quick Duration</span>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 4, 8].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setDuration(h)}
                className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary focus:ring-theme-focus-ring touch-target-phone rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
              >
                {h} {h === 1 ? 'hour' : 'hours'}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      {/* Recurrence */}
      {showRecurrence && (
        <>
          <label className="mobile-touch-target flex items-center justify-start space-x-3 pt-2">
            <input
              type="checkbox"
              id="is-recurring"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className={checkboxClass}
            />
            <span className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <Repeat className="h-4 w-4" />
              Make this a recurring event
            </span>
          </label>

          {isRecurring && (
            <div className="space-y-4 border-l-2 border-red-500/30 pl-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="recurrence-pattern" className={labelClass}>
                    Repeats <span className="text-red-700 dark:text-red-500">*</span>
                  </label>
                  <select
                    id="recurrence-pattern"
                    value={recurrencePattern}
                    onChange={(e) => setRecurrencePattern(e.target.value as RecurrencePattern)}
                    className={selectClass}
                  >
                    {RECURRENCE_PATTERNS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>
                    Duration {!isRolling && <span className="text-red-700 dark:text-red-500">*</span>}
                  </label>
                  <div className="space-y-3">
                    <label className="mobile-touch-target flex cursor-pointer items-center justify-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isRolling}
                        onChange={(e) => setIsRolling(e.target.checked)}
                        className={checkboxClass}
                      />
                      <span className="text-theme-text-secondary">Rolling 12-month cycle</span>
                    </label>
                    {isRolling ? (
                      <p className="text-theme-text-muted text-xs">
                        New occurrences are added automatically so the series always runs 12 months ahead.
                      </p>
                    ) : (
                      <>
                        <input
                          type="date"
                          id="recurrence-end-date"
                          aria-label="Series end date"
                          aria-invalid={fieldErrors.recurrence_end_date ? true : undefined}
                          aria-describedby={fieldErrors.recurrence_end_date ? 'recurrence-end-date-error' : undefined}
                          value={recurrenceEndDate}
                          onChange={(e) => handleRecurrenceEndDateChange(e.target.value)}
                          className={inputClass}
                        />
                        {fieldErrors.recurrence_end_date && (
                          <p id="recurrence-end-date-error" className="mt-1 text-sm text-red-700 dark:text-red-400">
                            {fieldErrors.recurrence_end_date}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {recurrencePattern === 'custom' && (
                <div>
                  <label className={labelClass}>Days of the Week</label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day, index) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          setRecurrenceCustomDays((prev) =>
                            prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]
                          );
                        }}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                          recurrenceCustomDays.includes(index)
                            ? 'border-red-700 bg-red-700 text-white'
                            : 'text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(recurrencePattern === 'monthly_weekday' || recurrencePattern === 'annually_weekday') && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="recurrence-ordinal" className={labelClass}>
                      Which Occurrence
                    </label>
                    <select
                      id="recurrence-ordinal"
                      value={recurrenceWeekOrdinal}
                      onChange={(e) => setRecurrenceWeekOrdinal(parseInt(e.target.value))}
                      className={selectClass}
                    >
                      {ORDINALS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="recurrence-weekday" className={labelClass}>
                      Day of Week
                    </label>
                    <select
                      id="recurrence-weekday"
                      value={recurrenceWeekday}
                      onChange={(e) => setRecurrenceWeekday(parseInt(e.target.value))}
                      className={selectClass}
                    >
                      {WEEKDAYS.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {recurrencePattern === 'annually_weekday' && (
                <div className="max-w-xs">
                  <label htmlFor="recurrence-month" className={labelClass}>
                    Month
                  </label>
                  <select
                    id="recurrence-month"
                    value={recurrenceMonth}
                    onChange={(e) => setRecurrenceMonth(parseInt(e.target.value))}
                    className={selectClass}
                  >
                    {MONTHS.map((m, index) => (
                      <option key={m} value={index + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Exception Dates */}
              <div>
                <label className={labelClass}>Exception Dates (dates to skip)</label>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="date"
                    aria-label="Date to skip"
                    value={newExceptionDate}
                    onChange={(e) => setNewExceptionDate(e.target.value)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newExceptionDate && !recurrenceExceptions.includes(newExceptionDate)) {
                        setRecurrenceExceptions((prev) => [...prev, newExceptionDate]);
                        setNewExceptionDate('');
                      }
                    }}
                    disabled={!newExceptionDate}
                    className="touch-target-phone rounded-lg bg-red-700 px-4 py-2 text-sm font-medium whitespace-nowrap text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {recurrenceExceptions.length > 0 && (
                  <ul className="space-y-1">
                    {recurrenceExceptions.map((date) => (
                      <li
                        key={date}
                        className="bg-theme-surface-secondary flex items-center justify-between rounded px-3 py-1.5 text-sm"
                      >
                        <span className="text-theme-text-primary">{date}</span>
                        <button
                          type="button"
                          onClick={() => setRecurrenceExceptions((prev) => prev.filter((d) => d !== date))}
                          aria-label={`Remove ${date}`}
                          className="text-xs font-medium text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Each occurrence is created as its own event, which you can edit or cancel on its own.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
