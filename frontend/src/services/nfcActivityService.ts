/**
 * Where member ID cards were tapped, by room (Card Readers) and by event.
 *
 * Shared axios client, so the auth cookie, CSRF header and refresh behaviour
 * come along (Pitfall #7). `/nfc-activity` is in UNCACHEABLE_PREFIXES: the
 * lists can name who checked in where.
 */

import api from './apiClient';
import type { NfcCardTapList, NfcReaderList } from '../modules/membership/types/idCard';
import type { NfcCheckInStatus, NfcTapSource } from '../constants/enums';

export interface ScopedTapFilters {
  outcome?: NfcCheckInStatus | undefined;
  source?: NfcTapSource | undefined;
  /** UTC ISO instants; `until` is exclusive. */
  since?: string | undefined;
  until?: string | undefined;
}

const params = (filters: ScopedTapFilters, limit: number, offset: number) => ({
  outcome: filters.outcome || undefined,
  source: filters.source || undefined,
  since: filters.since || undefined,
  until: filters.until || undefined,
  limit,
  offset,
});

export const nfcActivityService = {
  async listReaders(): Promise<NfcReaderList> {
    const response = await api.get<NfcReaderList>('/nfc-activity/readers');
    return response.data;
  },

  async listRoomTaps(
    locationId: string,
    filters: ScopedTapFilters,
    limit: number,
    offset: number
  ): Promise<NfcCardTapList> {
    const response = await api.get<NfcCardTapList>(`/nfc-activity/readers/${locationId}/taps`, {
      params: params(filters, limit, offset),
    });
    return response.data;
  },

  /** Card taps against events; pass an event id for one event's taps. */
  async listEventTaps(
    eventId: string | undefined,
    filters: ScopedTapFilters,
    limit: number,
    offset: number
  ): Promise<NfcCardTapList> {
    const response = await api.get<NfcCardTapList>('/nfc-activity/event-taps', {
      params: { ...params(filters, limit, offset), event_id: eventId || undefined },
    });
    return response.data;
  },
};
