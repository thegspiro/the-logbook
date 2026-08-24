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
import type { OrgChart, OrgChartNodeCreate, OrgChartNodeMove, OrgChartNodeUpdate } from '../types/orgChart';

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

/**
 * Organizational Chart.
 *
 * Every mutation returns the whole chart rather than the one seat it touched:
 * a move renumbers its siblings, and a delete promotes the children of the
 * removed seat, so the server's answer is the only trustworthy view of what
 * the tree now looks like.
 */
export const orgChartService = {
  async getChart(): Promise<OrgChart> {
    const response = await api.get<OrgChart>('/org-chart');
    return response.data;
  },

  async createNode(payload: OrgChartNodeCreate): Promise<OrgChart> {
    const response = await api.post<OrgChart>('/org-chart/nodes', payload);
    return response.data;
  },

  async updateNode(nodeId: string, payload: OrgChartNodeUpdate): Promise<OrgChart> {
    const response = await api.put<OrgChart>(`/org-chart/nodes/${nodeId}`, payload);
    return response.data;
  },

  async moveNode(nodeId: string, payload: OrgChartNodeMove): Promise<OrgChart> {
    const response = await api.post<OrgChart>(`/org-chart/nodes/${nodeId}/move`, payload);
    return response.data;
  },

  async deleteNode(nodeId: string): Promise<OrgChart> {
    const response = await api.delete<OrgChart>(`/org-chart/nodes/${nodeId}`);
    return response.data;
  },
};
