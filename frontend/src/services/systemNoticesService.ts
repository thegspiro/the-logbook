import api from './apiClient';
import type { SystemNotice } from '../types/systemNotices';

export const systemNoticesService = {
  async list(): Promise<SystemNotice[]> {
    const response = await api.get<SystemNotice[]>('/system-notices');
    return response.data;
  },
};
