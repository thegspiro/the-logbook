/**
 * The trip log on a mileage expense line (owner decision 2026-11-01): each
 * trip's date, start, end, purpose and miles, entered in the form instead of
 * an uploaded log. A line with trips is priced by the server at the
 * department's rate and needs no receipt; with none it is an ordinary line,
 * claimed with an amount and a receipt as before.
 *
 * Shared by the report form and the line dialog, so both enter a log the same
 * way. The amount shown is a preview of the server's figure
 * (`utils/mileage.ts`); the saved line carries the server's own.
 */

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/utils/currencyFormatting';
import { MAX_TRIPS_PER_LINE, emptyTrip, priceTrips, totalMiles, type TripEntry } from '../utils/mileage';

interface MileageTripLogProps {
  /** Prefix for the inputs' ids, unique on the page. */
  idPrefix: string;
  trips: TripEntry[];
  onChange: (trips: TripEntry[]) => void;
  /** The department's rate per mile; null when it has set none. */
  rate: string | null;
  /** Today in the department's timezone, the latest date a trip may carry. */
  today: string;
}

export const MileageTripLog: React.FC<MileageTripLogProps> = ({ idPrefix, trips, onChange, rate, today }) => {
  if (!rate) {
    return (
      <p className="alert-info text-sm" role="note">
        Your department has not set a mileage rate, so trips cannot be priced here. Enter the amount, then attach your
        mileage log as this line&apos;s receipt.
      </p>
    );
  }

  const update = (index: number, field: keyof TripEntry, value: string) =>
    onChange(trips.map((trip, i) => (i === index ? { ...trip, [field]: value } : trip)));
  const remove = (index: number) => onChange(trips.filter((_, i) => i !== index));
  const add = () => onChange([...trips, emptyTrip()]);
  const amount = priceTrips(trips, rate);

  return (
    <fieldset className="space-y-3">
      <legend className="form-label">Trips</legend>
      <p className="text-theme-text-secondary text-xs">
        Record each trip instead of uploading a log. The amount is the miles at the department&apos;s rate of{' '}
        {formatCurrency(rate)} a mile, and a line with trips needs no receipt. Leave the list empty to claim with a
        receipt instead.
      </p>
      {trips.map((trip, index) => {
        const id = `${idPrefix}-trip-${String(index)}`;
        return (
          <div
            key={id}
            role="group"
            aria-label={`Trip ${String(index + 1)}`}
            className="border-theme-surface-border rounded-lg border p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-theme-text-secondary text-xs font-medium">Trip {index + 1}</span>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove trip ${String(index + 1)}`}
                className="touch-target-phone text-red-700 hover:text-red-900 dark:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-date`} className="form-label">
                  Date *
                </label>
                <input
                  id={`${id}-date`}
                  type="date"
                  max={today}
                  className="form-input"
                  value={trip.tripDate}
                  onChange={(e) => update(index, 'tripDate', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${id}-miles`} className="form-label">
                  Miles *
                </label>
                <input
                  id={`${id}-miles`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0.1"
                  max="1000"
                  className="form-input"
                  placeholder="0.0"
                  value={trip.miles}
                  onChange={(e) => update(index, 'miles', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${id}-from`} className="form-label">
                  From *
                </label>
                <input
                  id={`${id}-from`}
                  type="text"
                  maxLength={200}
                  className="form-input"
                  placeholder="Station 1"
                  value={trip.fromLocation}
                  onChange={(e) => update(index, 'fromLocation', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${id}-to`} className="form-label">
                  To *
                </label>
                <input
                  id={`${id}-to`}
                  type="text"
                  maxLength={200}
                  className="form-input"
                  placeholder="Training center"
                  value={trip.toLocation}
                  onChange={(e) => update(index, 'toLocation', e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`${id}-purpose`} className="form-label">
                  Purpose *
                </label>
                <input
                  id={`${id}-purpose`}
                  type="text"
                  maxLength={500}
                  className="form-input"
                  placeholder="Why the trip was made"
                  value={trip.purpose}
                  onChange={(e) => update(index, 'purpose', e.target.value)}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={add}
          disabled={trips.length >= MAX_TRIPS_PER_LINE}
          className="btn-secondary inline-flex items-center gap-1"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a trip
        </button>
        {trips.length > 0 && (
          <p className="text-theme-text-primary text-sm" role="status">
            {totalMiles(trips)} miles: {formatCurrency(amount)}
          </p>
        )}
      </div>
    </fieldset>
  );
};
