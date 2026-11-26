/** The periods the roster's Time in seat filter offers, and their dates. */

export const SeatPeriod = {
  THIS_YEAR: 'this_year',
  LAST_YEAR: 'last_year',
  ALL_TIME: 'all_time',
} as const;
export type SeatPeriod = (typeof SeatPeriod)[keyof typeof SeatPeriod];

export const SEAT_PERIOD_LABELS: Record<SeatPeriod, string> = {
  this_year: 'This year',
  last_year: 'Last year',
  all_time: 'All time',
};

/** The dates a period covers, in the department's year; open for all time. */
export const seatPeriodDates = (period: SeatPeriod, thisYear: number): { start_date?: string; end_date?: string } => {
  if (period === SeatPeriod.ALL_TIME) return {};
  const year = period === SeatPeriod.THIS_YEAR ? thisYear : thisYear - 1;
  return { start_date: `${year}-01-01`, end_date: `${year}-12-31` };
};
