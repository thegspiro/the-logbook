import api from './apiClient';
import type { KeyCustodyStatus, SystemNotice } from '../types/systemNotices';

export const systemNoticesService = {
  async list(): Promise<SystemNotice[]> {
    const response = await api.get<unknown>('/system-notices');
    // The banner maps over this; anything but a list (a proxy's error page, a
    // stub answering {}) means there is nothing to show, not a render crash.
    return Array.isArray(response.data) ? (response.data as SystemNotice[]) : [];
  },

  async getKeyCustody(): Promise<KeyCustodyStatus> {
    const response = await api.get<KeyCustodyStatus>('/system-notices/encryption-key-custody');
    return response.data;
  },

  /**
   * Sends back the fingerprint the administrator was shown, so a key replaced
   * in the meantime is refused (409) rather than confirmed unseen.
   */
  async confirmKeyCustody(keyFingerprint: string): Promise<KeyCustodyStatus> {
    const response = await api.post<KeyCustodyStatus>('/system-notices/encryption-key-custody', {
      key_fingerprint: keyFingerprint,
    });
    return response.data;
  },
};
