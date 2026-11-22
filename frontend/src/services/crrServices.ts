/**
 * Community risk reduction (CRR): the catalogue of activity types, their
 * counts and tags.
 *
 * Imported directly rather than through the `services/api` barrel: only the
 * lazily loaded CRR screens use it, and the barrel is part of every page's
 * first load (scripts/check-initial-bundle.mjs).
 */

import api from './apiClient';
import type { CrrActivityType, CrrActivityTypeUpdate, CrrCatalogue, CrrTag, CrrTagKind } from '../types/crr';

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
};
