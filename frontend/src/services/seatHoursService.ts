/**
 * Every member's credited time in one seat (`GET /scheduling/seat-hours`,
 * `scheduling.report`), for the member roster's Time in seat filter.
 *
 * Its own module rather than a method on the scheduling service: that
 * service is in the first-load bundle, and only the lazily loaded roster
 * needs this. Its own client from the shared factory (cookie credentials,
 * CSRF, refresh), as each module's service has.
 */

import { createApiClient } from '../utils/createApiClient';

const api = createApiClient();

/** One member's credited shifts in the seat asked about. */
export interface SeatHoursMember {
  user_id: string;
  shifts: number;
  hours: number;
  calls: number;
}

/** Every member's time in one seat over a period. */
export interface SeatHours {
  position: string;
  start_date?: string | null;
  end_date?: string | null;
  members: SeatHoursMember[];
}

export const seatHoursService = {
  /** Open dates mean all time. */
  async getSeatHours(params: { position: string; start_date?: string; end_date?: string }): Promise<SeatHours> {
    const response = await api.get<SeatHours>('/scheduling/seat-hours', { params });
    const members = Array.isArray(response.data?.members) ? response.data.members : [];
    return { ...response.data, members };
  },
};
