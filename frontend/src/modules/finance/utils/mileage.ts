/**
 * A mileage line's trip log, as the expense forms enter it (owner decision
 * 2026-11-01: record trips in the form instead of uploading a log).
 *
 * The server prices a logged line -- miles at the department's rate, to the
 * cent, half up -- and dates it by its first trip (`app/services/
 * expense_mileage.py`); what it returns is the line's amount. `priceTrips`
 * only previews that figure while the member types, in whole tenths of a mile
 * and thousandths of a dollar so no float rounds it differently from the
 * server.
 */

import { z } from 'zod';
import type { MileageTrip } from '../types';

/** A trip as the form holds it: every field a string, as the inputs give them. */
export interface TripEntry {
  tripDate: string;
  fromLocation: string;
  toLocation: string;
  purpose: string;
  miles: string;
}

export const MAX_TRIPS_PER_LINE = 100;
export const MAX_TRIP_MILES = 1000;

export const emptyTrip = (): TripEntry => ({
  tripDate: '',
  fromLocation: '',
  toLocation: '',
  purpose: '',
  miles: '',
});

const MILES_PATTERN = /^\d{1,4}(\.\d)?$/;

export const tripSchema = z.object({
  tripDate: z.string().min(1, 'Each trip needs a date'),
  fromLocation: z.string().trim().min(1, 'Each trip needs where it started').max(200),
  toLocation: z.string().trim().min(1, 'Each trip needs where it ended').max(200),
  purpose: z.string().trim().min(1, 'Each trip needs its purpose').max(500),
  miles: z
    .string()
    .trim()
    .regex(MILES_PATTERN, 'Miles are entered to a tenth of a mile, e.g. 12.5')
    .refine((value) => Number(value) > 0, 'Miles must be more than zero')
    .refine((value) => Number(value) <= MAX_TRIP_MILES, `A trip is at most ${MAX_TRIP_MILES} miles`),
});

/** The first problem with a log, or null when every trip is complete. */
export function tripLogError(trips: TripEntry[]): string | null {
  if (trips.length > MAX_TRIPS_PER_LINE) return `A line can log at most ${MAX_TRIPS_PER_LINE} trips`;
  for (const trip of trips) {
    const parsed = tripSchema.safeParse(trip);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Check the trips';
  }
  return null;
}

/** Tenths of a mile in a typed value, or null when it is not one. */
function tenths(miles: string): number | null {
  const value = miles.trim();
  if (!MILES_PATTERN.test(value)) return null;
  const [whole = '0', fraction = '0'] = value.split('.');
  return Number(whole) * 10 + Number(fraction);
}

/** Thousandths of a dollar in a rate such as `"0.700"`, or null. */
function thousandths(rate: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(rate.trim());
  if (!match) return null;
  return Number(match[1] ?? '0') * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}

/** The log's total miles, as a string to a tenth; trips with no valid miles count as none. */
export function totalMiles(trips: TripEntry[]): string {
  const sum = trips.reduce((acc, trip) => acc + (tenths(trip.miles) ?? 0), 0);
  return `${Math.floor(sum / 10)}.${sum % 10}`;
}

/** The amount the server will price the log at, as a decimal string, or null without a rate. */
export function priceTrips(trips: TripEntry[], rate: string | null | undefined): string | null {
  if (!rate) return null;
  const perMile = thousandths(rate);
  if (perMile === null) return null;
  const miles = trips.reduce((acc, trip) => acc + (tenths(trip.miles) ?? 0), 0);
  // tenths x thousandths = ten-thousandths of a dollar; round half up to cents.
  const cents = Math.floor((miles * perMile + 50) / 100);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** The log as the API takes it, trimmed. */
export function toTripPayload(trips: TripEntry[]): MileageTrip[] {
  return trips.map((trip) => ({
    tripDate: trip.tripDate,
    fromLocation: trip.fromLocation.trim(),
    toLocation: trip.toLocation.trim(),
    purpose: trip.purpose.trim(),
    miles: trip.miles.trim(),
  }));
}

/** A stored log back into form entries. */
export function fromStoredTrips(trips: MileageTrip[] | null | undefined): TripEntry[] {
  return (trips ?? []).map((trip) => ({
    tripDate: trip.tripDate,
    fromLocation: trip.fromLocation,
    toLocation: trip.toLocation,
    purpose: trip.purpose,
    miles: String(trip.miles),
  }));
}
