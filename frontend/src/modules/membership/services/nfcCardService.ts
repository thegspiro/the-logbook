/**
 * Member ID card (NFC) credentials and the check-in station.
 *
 * Every route here is staff-only — issuing, revoking and reading cards. There
 * is deliberately no self-service call, because there is no self-service
 * endpoint: a member cannot register, relabel or revoke a card, not even
 * their own.
 *
 * Uses the shared axios client rather than a module-local instance, so the
 * auth cookie, CSRF header and 401 refresh behaviour come along without a
 * second copy to keep in step (see Pitfall #7).
 */

import api from '../../../services/apiClient';
import type {
  NfcCard,
  NfcCardCreatePayload,
  NfcCardListResponse,
  NfcCardUpdatePayload,
  NfcStationCheckInPayload,
  NfcStationCheckInResult,
} from '../types/idCard';
import type { NfcCardStatus } from '../../../constants/enums';

export const nfcCardService = {
  /** Cards issued across the organization, optionally narrowed to one member. */
  async list(params?: { userId?: string; status?: NfcCardStatus }): Promise<NfcCardListResponse> {
    const response = await api.get<NfcCardListResponse>('/nfc-tags', {
      params: {
        user_id: params?.userId || undefined,
        status: params?.status || undefined,
      },
    });
    return response.data;
  },

  async register(payload: NfcCardCreatePayload): Promise<NfcCard> {
    const response = await api.post<NfcCard>('/nfc-tags', payload);
    return response.data;
  },

  async update(cardId: string, payload: NfcCardUpdatePayload): Promise<NfcCard> {
    const response = await api.patch<NfcCard>(`/nfc-tags/${cardId}`, payload);
    return response.data;
  },

  async remove(cardId: string): Promise<void> {
    await api.delete(`/nfc-tags/${cardId}`);
  },

  /**
   * Record a tap at a station.
   *
   * Resolves for every outcome the station has to draw, including an
   * unregistered card — read `result.status`, not the absence of a throw.
   */
  async stationCheckIn(payload: NfcStationCheckInPayload): Promise<NfcStationCheckInResult> {
    const response = await api.post<NfcStationCheckInResult>('/nfc-tags/check-in', payload);
    return response.data;
  },
};
