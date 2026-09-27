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
import { formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { adminHoursEntryService } from '../services/api';
import type { AdminHoursCategory, AdminHoursEntry, AdminHoursEntryEdit } from '../types';
import { formatDuration } from '../utils/formatDuration';
import { addHoursExact, syncEndToStartExact, resolveEndUtc, type DerivedEndTime } from '../utils/entryTimes';
import QuickDurationButtons from './QuickDurationButtons';

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
      toast.error(getErrorMessage(err, 'Failed to update entry'));
    } finally {
      setIsSaving(false);
    }
  };

  const idPrefix = `edit-${entry.id}`;

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
        <div className="md:col-span-2">
          <label htmlFor={`${idPrefix}-category`} className="form-label">
            Category
          </label>
          <select
            id={`${idPrefix}-category`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="form-input md:max-w-sm"
          >
            {!categoryListed && <option value={entry.categoryId}>{entry.categoryName ?? 'Current category'}</option>}
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-start`} className="form-label">
            Start Time
          </label>
          <DateTimeQuarterHour
            id={`${idPrefix}-start`}
            value={clockIn}
            onChange={handleStartChange}
            required
            className="form-input"
            timezone={timezone}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-end`} className="form-label">
            End Time
          </label>
          <DateTimeQuarterHour
            id={`${idPrefix}-end`}
            value={clockOut}
            onChange={(val) => {
              setClockOut(val);
              setEndPin(null);
            }}
            required
            className="form-input"
            timezone={timezone}
          />
        </div>
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

      <div>
        <label htmlFor={`${idPrefix}-description`} className="form-label">
          Description
        </label>
        <input
          id={`${idPrefix}-description`}
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="form-input"
          placeholder="What did you work on?"
        />
      </div>

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
