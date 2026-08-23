/**
 * Administration-page frame API.
 *
 * One endpoint family serves every admin page: the metrics row and attention
 * queue for a module, plus the settings screen that chooses which three
 * metrics fill the open slots.
 */

import api from './apiClient';
import type { AdminHubSummary, AdminMetricSettings, AdminMetricSettingsUpdate } from '../types/adminHub';

export const adminHubService = {
  async getSummary(moduleKey: string): Promise<AdminHubSummary> {
    const response = await api.get<AdminHubSummary>(`/admin-hub/${moduleKey}/summary`);
    return response.data;
  },

  async getMetricSettings(moduleKey: string): Promise<AdminMetricSettings> {
    const response = await api.get<AdminMetricSettings>(`/admin-hub/${moduleKey}/metrics`);
    return response.data;
  },

  async updateMetricSettings(moduleKey: string, payload: AdminMetricSettingsUpdate): Promise<AdminMetricSettings> {
    // Both fields go on every save. The screen owns them together, and an
    // omitted key on an update path is how a cleared value quietly survives
    // (CLAUDE.md Pitfall #1).
    const response = await api.put<AdminMetricSettings>(`/admin-hub/${moduleKey}/metrics`, payload);
    return response.data;
  },
};

export default adminHubService;
