import api from './apiClient';
import type { SystemNotice } from '../types/systemNotices';

export const systemNoticesService = {
  async list(): Promise<SystemNotice[]> {
    const response = await api.get<unknown>('/system-notices');
    // The banner maps over this; anything but a list (a proxy's error page, a
    // stub answering {}) means there is nothing to show, not a render crash.
    return Array.isArray(response.data) ? (response.data as SystemNotice[]) : [];
  },
};
