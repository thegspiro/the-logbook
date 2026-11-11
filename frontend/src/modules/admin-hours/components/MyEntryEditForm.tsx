/**
 * MyEntryEditForm Component
 *
 * Inline editor a member uses to correct one of their own entries. On a
 * rejected entry, saving resubmits it to the approvers — that is how an officer
 * sends hours back for correction.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { adminHoursEntryService } from '../services/api';
import type { AdminHoursCategory, AdminHoursEntry, AdminHoursEntryEdit } from '../types';
import { formatDuration } from '../utils/formatDuration';
import { addHoursExact, syncEndToStartExact, resolveEndUtc, type DerivedEndTime } from '../utils/entryTimes';
import QuickDurationButtons from './QuickDurationButtons';

type EntryField = 'category_id' | 'clock_in_at' | 'clock_out_at' | 'description';

/** The fields as a 422 names them; admin-hours request schemas are snake_case and set no max_length. */
const SERVER_FIELDS: Record<EntryField, ServerFieldSpec> = {
  category_id: { label: 'Category' },
  clock_in_at: { label: 'Start Time' },
  clock_out_at: { label: 'End Time' },
  description: { label: 'Description' },
};

interface MyEntryEditFormProps {
  entry: AdminHoursEntry;
  categories: AdminHoursCategory[];
  timezone: string;
  onSaved: () => void;
  onCancel: () => void;
}

const MyEntryEditForm: React.FC<MyEntryEditFormProps> = ({ entry, categories, timezone, onSaved, onCancel }) => {
  const isResubmit = entry.status === 'rejected';
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [clockIn, setClockIn] = useState(formatForDateTimeInput(entry.clockInAt, timezone));
  const [clockOut, setClockOut] = useState(entry.clockOutAt ? formatForDateTimeInput(entry.clockOutAt, timezone) : '');
  const [description, setDescription] = useState(entry.description ?? '');
  // The exact UTC instant behind `clockOut` when a duration preset or a start
  // shift derived it — see the identical field in AdminHoursPage.tsx and
  // `resolveEndUtc`.
  const [endPin, setEndPin] = useState<DerivedEndTime | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<EntryField, string>>>({});
  const clearError = (field: EntryField) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  // The page lists active categories only. An entry filed under one that has
  // since been retired must still show where it sits, or the select would
  // silently read as the first option.
  const categoryListed = categories.some((cat) => cat.id === entry.categoryId);

  const durationMinutes = (() => {
    if (!clockIn || !clockOut) return null;
    const start = new Date(localToUTC(clockIn, timezone)).getTime();
    const end = new Date(resolveEndUtc(clockOut, endPin, timezone)).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    return Math.floor((end - start) / 60000);
  })();
  const endBeforeStart = Boolean(clockIn && clockOut) && durationMinutes === null;

  const handleStartChange = (value: string) => {
    const { local, pin } = syncEndToStartExact(clockIn, value, clockOut, endPin, timezone);
    setClockIn(value);
    setClockOut(local);
    setEndPin(pin);
  };

  const handleDuration = (hours: number) => {
    const derived = addHoursExact(clockIn, hours, timezone);
    setClockOut(derived?.local ?? '');
    setEndPin(derived);
  };

  const idPrefix = `edit-${entry.id}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || durationMinutes === null) return;
    setIsSaving(true);
    // The category is sent only when it changed: re-sending an unchanged one
    // the department has since retired would be refused as inactive, which
    // would make a retired-category entry impossible to correct at all.
    const payload: AdminHoursEntryEdit = {
      clock_in_at: localToUTC(clockIn, timezone),
      clock_out_at: resolveEndUtc(clockOut, endPin, timezone),
      // A blank string clears the description; the backend reads an omitted
      // key as "leave it alone".
      description: description.trim(),
      ...(categoryId !== entry.categoryId ? { category_id: categoryId } : {}),
    };
    try {
      await adminHoursEntryService.editMine(entry.id, payload);
      toast.success(isResubmit ? 'Entry resubmitted for review' : 'Entry updated');
      onSaved();
    } catch (err) {
      // The times are checked together and saving a correction resubmits it,
      // so nothing is written until every refusal, shown on its field, is
      // fixed (forms review F-2).
      const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as EntryField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        const suffix = {
          category_id: 'category',
          clock_in_at: 'start',
          clock_out_at: 'end',
          description: 'description',
        };
        document.getElementById(`${idPrefix}-${suffix[keys[0]]}`)?.focus();
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Failed to update entry'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="bg-theme-surface-secondary mt-3 space-y-3 rounded-lg p-3"
      aria-label="Edit entry"
    >
      {isResubmit && entry.rejectionReason && (
        <p className="text-sm text-red-700 dark:text-red-400">
          Returned with: <span className="font-medium">{entry.rejectionReason}</span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField
          className="md:col-span-2"
          id={`${idPrefix}-category`}
          label="Category"
          required
          error={errors.category_id}
        >
          {(field) => (
            <select
              {...field}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                clearError('category_id');
              }}
              className="form-input md:max-w-sm"
            >
              {!categoryListed && <option value={entry.categoryId}>{entry.categoryName ?? 'Current category'}</option>}
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id={`${idPrefix}-start`} label="Start Time" required error={errors.clock_in_at}>
          {(field) => (
            <DateTimeQuarterHour
              {...field}
              timeLabel="Start time"
              value={clockIn}
              onChange={(value) => {
                handleStartChange(value);
                clearError('clock_in_at');
              }}
              required
              className="form-input"
              timezone={timezone}
            />
          )}
        </FormField>
        <FormField id={`${idPrefix}-end`} label="End Time" required error={errors.clock_out_at}>
          {(field) => (
            <DateTimeQuarterHour
              {...field}
              timeLabel="End time"
              value={clockOut}
              onChange={(val) => {
                setClockOut(val);
                setEndPin(null);
                clearError('clock_out_at');
              }}
              required
              className="form-input"
              timezone={timezone}
            />
          )}
        </FormField>
      </div>

      <QuickDurationButtons onSelect={handleDuration} disabled={!clockIn} />

      {durationMinutes !== null && (
        <div className="text-theme-text-secondary text-sm">
          Duration: <span className="text-theme-text-primary font-medium">{formatDuration(durationMinutes)}</span>
        </div>
      )}
      {endBeforeStart && (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          End time must be after start time
        </p>
      )}

      <FormField id={`${idPrefix}-description`} label="Description" error={errors.description}>
        {(field) => (
          <input
            {...field}
            type="text"
            autoComplete="off"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearError('description');
            }}
            className="form-input"
            placeholder="What did you work on?"
          />
        )}
      </FormField>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={durationMinutes === null || isSaving}
          className="btn-info transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : isResubmit ? 'Resubmit' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg px-4 py-2 transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default MyEntryEditForm;
