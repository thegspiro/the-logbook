/**
 * Google Workspace account status and retry for one member.
 *
 * Staff-only (members.manage). Uses the shared axios client so the auth
 * cookie, CSRF header and 401 refresh come along (see Pitfall #7).
 */

import api from '../../../services/apiClient';
import type { GoogleAccountEnvelope } from '../types/googleAccount';

export const googleAccountService = {
  async get(userId: string): Promise<GoogleAccountEnvelope> {
    const response = await api.get<GoogleAccountEnvelope>(
      `/integrations/google-workspace/members/${encodeURIComponent(userId)}`
    );
    return response.data;
  },

  async retry(userId: string): Promise<GoogleAccountEnvelope> {
    const response = await api.post<GoogleAccountEnvelope>(
      `/integrations/google-workspace/members/${encodeURIComponent(userId)}/retry`
    );
    return response.data;
  },
};
