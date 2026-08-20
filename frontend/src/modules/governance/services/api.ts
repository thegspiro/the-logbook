/**
 * Governance Module — API Service
 *
 * Module-local axios instance with the shared auth interceptors (CSRF, cookie
 * auth, 401 refresh) per CLAUDE.md module conventions.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  LegalDocumentType,
  LegalDocumentsOverview,
  LegalRevision,
  LegalRevisionCreate,
  LegalRevisionUpdate,
} from '../types/legal';

const api = createApiClient();

export const legalDocumentsService = {
  async getOverview(): Promise<LegalDocumentsOverview> {
    const response = await api.get<LegalDocumentsOverview>('/legal-documents');
    return response.data;
  },

  async createRevision(payload: LegalRevisionCreate): Promise<LegalRevision> {
    const response = await api.post<LegalRevision>('/legal-documents/revisions', payload);
    return response.data;
  },

  async updateRevision(revisionId: string, payload: LegalRevisionUpdate): Promise<LegalRevision> {
    const response = await api.put<LegalRevision>(`/legal-documents/revisions/${revisionId}`, payload);
    return response.data;
  },

  async deleteRevision(revisionId: string): Promise<void> {
    await api.delete(`/legal-documents/revisions/${revisionId}`);
  },

  async publishRevision(revisionId: string): Promise<LegalRevision> {
    const response = await api.post<LegalRevision>(`/legal-documents/revisions/${revisionId}/publish`);
    return response.data;
  },

  async revertToDefault(documentType: LegalDocumentType): Promise<void> {
    await api.post(`/legal-documents/${documentType}/revert-to-default`);
  },
};
