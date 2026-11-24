/**
 * Community risk reduction (CRR): the catalogue of activity types, their
 * counts and tags, the activities recorded against it, and the ZIP lookup.
 *
 * Imported directly rather than through the `services/api` barrel: only the
 * lazily loaded CRR screens use it, and the barrel is part of every page's
 * first load (scripts/check-initial-bundle.mjs).
 */

import api from './apiClient';
import type {
  CrrActivity,
  CrrActivityCreate,
  CrrActivityList,
  CrrActivityType,
  CrrActivityTypeUpdate,
  CrrCatalogue,
  CrrFormOptions,
  CrrTag,
  CrrTagKind,
  CrrZipPlace,
} from '../types/crr';

export const crrService = {
  async getCatalogue(): Promise<CrrCatalogue> {
    const response = await api.get<CrrCatalogue>('/crr/catalogue');
    return response.data;
  },
  async createType(body: {
    name: string;
    description?: string | undefined;
    measures?: string[] | undefined;
  }): Promise<CrrActivityType> {
    const response = await api.post<CrrActivityType>('/crr/activity-types', body);
    return response.data;
  },
  async updateType(typeId: string, body: CrrActivityTypeUpdate): Promise<CrrActivityType> {
    const response = await api.patch<CrrActivityType>(`/crr/activity-types/${typeId}`, body);
    return response.data;
  },
  async deleteType(typeId: string): Promise<void> {
    await api.delete(`/crr/activity-types/${typeId}`);
  },
  async setTypeTags(typeId: string, tagIds: string[]): Promise<CrrActivityType> {
    const response = await api.put<CrrActivityType>(`/crr/activity-types/${typeId}/tags`, {
      tag_ids: tagIds,
    });
    return response.data;
  },
  async addMeasure(typeId: string, label: string): Promise<CrrActivityType> {
    const response = await api.post<CrrActivityType>(`/crr/activity-types/${typeId}/measures`, {
      label,
    });
    return response.data;
  },
  async updateMeasure(
    measureId: string,
    body: { label?: string | undefined; is_active?: boolean | undefined }
  ): Promise<CrrActivityType> {
    const response = await api.patch<CrrActivityType>(`/crr/measures/${measureId}`, body);
    return response.data;
  },
  async createTag(kind: CrrTagKind, label: string): Promise<CrrTag> {
    const response = await api.post<CrrTag>('/crr/tags', { kind, label });
    return response.data;
  },
  async updateTag(
    tagId: string,
    body: { label?: string | undefined; is_active?: boolean | undefined }
  ): Promise<CrrTag> {
    const response = await api.patch<CrrTag>(`/crr/tags/${tagId}`, body);
    return response.data;
  },
  async updateSettings(residentDetailsRetentionMonths: number): Promise<number> {
    const response = await api.put<{ resident_details_retention_months: number }>('/crr/settings', {
      resident_details_retention_months: residentDetailsRetentionMonths,
    });
    return response.data.resident_details_retention_months;
  },
  /** What the activity form offers (crr.record or events.manage). */
  async getFormOptions(): Promise<CrrFormOptions> {
    const response = await api.get<CrrFormOptions>('/crr/form-options');
    return response.data;
  },
  async listActivities(params: {
    start?: string | undefined;
    end?: string | undefined;
    activity_type_id?: string | undefined;
    event_id?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<CrrActivityList> {
    const response = await api.get<CrrActivityList>('/crr/activities', { params });
    return response.data;
  },
  async createActivity(body: CrrActivityCreate): Promise<CrrActivity> {
    const response = await api.post<CrrActivity>('/crr/activities', body);
    return response.data;
  },
  async deleteActivity(activityId: string): Promise<void> {
    await api.delete(`/crr/activities/${activityId}`);
  },
  /** City, state and county for a US ZIP; rejects with 404 when it is not in the data. */
  async lookupZip(zipCode: string): Promise<CrrZipPlace> {
    const response = await api.get<CrrZipPlace>(`/crr/zip-lookup/${encodeURIComponent(zipCode)}`);
    return response.data;
  },
};
