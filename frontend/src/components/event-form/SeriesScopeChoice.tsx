/**
 * "This event only / This and all future events", for an edit of one event in
 * a recurring series. The single-page form shows it above the form, as it
 * always has; the training-event form shows it on Review, where the save is,
 * and says that it covers the training details too.
 */

import React from 'react';
import { Info, Repeat } from 'lucide-react';
import { formatDateCustom } from '../../utils/dateFormatting';

export type SeriesScope = 'single' | 'future';

export interface SeriesScopeChoiceProps {
  value: SeriesScope;
  onChange: (scope: SeriesScope) => void;
  /** The occurrence being edited, as an ISO instant. */
  occurrenceStart?: string | undefined;
  /** The series' last date, as an ISO instant; absent on a rolling series. */
  seriesEnd?: string | undefined;
  rolling?: boolean | undefined;
  /** The series' first event, as an ISO instant, when the occurrence is a later one. */
  seriesStart?: string | undefined;
  tz?: string | undefined;
}

const DATE_ONLY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };

/** An instant as the department's calendar date, "Thu, Nov 12, 2026". */
const seriesDate = (iso: string, tz?: string) => formatDateCustom(iso, DATE_ONLY, tz);

/** The banner the single-page edit form has always drawn above itself. */
export const SeriesScopeBanner: React.FC<SeriesScopeChoiceProps> = ({ value, onChange }) => (
  <div className="mb-6 flex items-start gap-3 rounded-lg border border-indigo-300 bg-indigo-50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
    <Info className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
    <div className="text-sm text-indigo-700 dark:text-indigo-300">
      <p className="font-medium">This event is part of a recurring series.</p>
      <fieldset className="mt-3">
        <legend className="sr-only">Update scope</legend>
        <div className="flex flex-col gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="updateScope"
              value="single"
              checked={value === 'single'}
              onChange={() => onChange('single')}
              className="form-checkbox"
            />
            <span>This event only</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="updateScope"
              value="future"
              checked={value === 'future'}
              onChange={() => onChange('future')}
              className="form-checkbox"
            />
            <span>This and all future events</span>
          </label>
        </div>
      </fieldset>
    </div>
  </div>
);

/** The same choice on the training-event form's Review step. */
export const SeriesScopeReview: React.FC<SeriesScopeChoiceProps> = ({
  value,
  onChange,
  occurrenceStart,
  seriesEnd,
  rolling,
  tz,
}) => {
  const day = occurrenceStart ? seriesDate(occurrenceStart, tz) : undefined;
  const through = !rolling && seriesEnd ? ` (through ${seriesDate(seriesEnd, tz)})` : '';
  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <div className="flex items-start gap-3 text-sm text-indigo-700 dark:text-indigo-300">
        <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
        <fieldset className="min-w-0 space-y-3" aria-describedby="series-scope-note">
          <legend className="font-semibold">This event is part of a recurring series.</legend>
          <p className="font-medium">Apply changes to:</p>
          <div className="flex flex-col gap-2">
            <label className="mobile-touch-target flex cursor-pointer items-start justify-start gap-2">
              <input
                type="radio"
                name="updateScope"
                value="single"
                checked={value === 'single'}
                onChange={() => onChange('single')}
                className="form-checkbox mt-0.5 shrink-0"
              />
              <span>
                <span className="block">This event only</span>
                {day && <span className="block text-xs">{day}</span>}
              </span>
            </label>
            <label className="mobile-touch-target flex cursor-pointer items-start justify-start gap-2">
              <input
                type="radio"
                name="updateScope"
                value="future"
                checked={value === 'future'}
                onChange={() => onChange('future')}
                className="form-checkbox mt-0.5 shrink-0"
              />
              <span>
                <span className="block">This and all future events{through}</span>
                {day && <span className="block text-xs">{day} onward</span>}
              </span>
            </label>
          </div>
          <p id="series-scope-note">
            Either choice covers the event fields <strong>and</strong> the training details, including Counts toward
            attendance. Requirement changes only if you change it: left as it is, each later occurrence keeps its own. A
            session-attendance requirement linked there is kept, and can be removed but not chosen again.
            {rolling && ' With This and all future events, occurrences added later copy these changes too.'}
          </p>
        </fieldset>
      </div>
    </div>
  );
};
