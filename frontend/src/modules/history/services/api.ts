/**
 * History API Service
 *
 * Module client from `createApiClient`: cookies, CSRF header and the shared
 * 401 refresh, and no response cache — these records hold personal details.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { asArray } from '../../../utils/asArray';
import type {
  ClearancePurpose,
  ClearanceRequest,
  ClearanceReview,
  ClearanceStep,
  HistoricalMemberFullView,
  HistoricalMemberList,
  HistoricalMemberView,
  HistoryTitle,
  HonorRollEntry,
  PeopleQuery,
  PersonCreate,
  PersonUpdate,
  PersonWarning,
  RelationType,
  Revision,
  ServicePeriodWrite,
  EditKind,
  ClearanceDecisionKind,
  ImportDetail,
  ImportRowUpdate,
  ImportSummary,
  ImportTitleChoice,
  MergeChoice,
  MergePreview,
  RemoveRecordsResult,
} from '../types';

const api = createApiClient();
const BASE = '/history';

export const historyService = {
  // --- People ---

  async listPeople(query: PeopleQuery = {}): Promise<HistoricalMemberList> {
    const { data } = await api.get<HistoricalMemberList>(`${BASE}/people`, { params: query });
    return { items: asArray(data.items), total: data.total };
  },

  async getPerson(id: string): Promise<HistoricalMemberView> {
    const { data } = await api.get<HistoricalMemberView>(`${BASE}/people/${id}`);
    return data;
  },

  async createPerson(payload: PersonCreate): Promise<HistoricalMemberFullView> {
    const { data } = await api.post<HistoricalMemberFullView>(`${BASE}/people`, payload);
    return data;
  },

  async createFromMember(userId: string): Promise<HistoricalMemberFullView> {
    const { data } = await api.post<HistoricalMemberFullView>(`${BASE}/people/from-member/${userId}`);
    return data;
  },

  async updatePerson(id: string, payload: PersonUpdate): Promise<HistoricalMemberFullView> {
    const { data } = await api.patch<HistoricalMemberFullView>(`${BASE}/people/${id}`, payload);
    return data;
  },

  async replacePeriods(
    id: string,
    periods: ServicePeriodWrite[],
    editKind: EditKind,
    editNote?: string
  ): Promise<HistoricalMemberFullView> {
    const { data } = await api.put<HistoricalMemberFullView>(`${BASE}/people/${id}/periods`, {
      periods,
      edit_kind: editKind,
      edit_note: editNote || undefined,
    });
    return data;
  },

  async deletePerson(id: string): Promise<void> {
    await api.delete(`${BASE}/people/${id}`);
  },

  async checkPerson(params: {
    last_name?: string | undefined;
    first_name?: string | undefined;
    badge_number?: string | undefined;
    exclude_id?: string | undefined;
  }): Promise<PersonWarning[]> {
    const { data } = await api.get<{ warnings: PersonWarning[] }>(`${BASE}/people/check`, { params });
    return asArray(data.warnings);
  },

  async listRevisions(id: string): Promise<Revision[]> {
    const { data } = await api.get<Revision[]>(`${BASE}/people/${id}/revisions`);
    return asArray(data);
  },

  async addRelation(
    id: string,
    relatedMemberId: string,
    relationType: RelationType,
    label?: string
  ): Promise<HistoricalMemberFullView> {
    const { data } = await api.post<HistoricalMemberFullView>(`${BASE}/people/${id}/relations`, {
      related_member_id: relatedMemberId,
      relation_type: relationType,
      label: label || undefined,
    });
    return data;
  },

  async deleteRelation(relationId: string): Promise<void> {
    await api.delete(`${BASE}/relations/${relationId}`);
  },

  async publish(id: string, level: 'members' | 'public'): Promise<HistoricalMemberFullView> {
    const { data } = await api.post<HistoricalMemberFullView>(`${BASE}/people/${id}/publish`, { level });
    return data;
  },

  async unpublish(id: string, level: 'draft' | 'members'): Promise<HistoricalMemberFullView> {
    const { data } = await api.post<HistoricalMemberFullView>(`${BASE}/people/${id}/unpublish`, { level });
    return data;
  },

  async honorRoll(): Promise<HonorRollEntry[]> {
    const { data } = await api.get<HonorRollEntry[]>(`${BASE}/honor-roll`);
    return asArray(data);
  },

  async renderMarkdown(markdown: string): Promise<string> {
    const { data } = await api.post<{ html: string }>(`${BASE}/render-markdown`, { markdown });
    return data.html;
  },

  // --- Titles ---

  async listTitles(includeRetired = false): Promise<HistoryTitle[]> {
    const { data } = await api.get<HistoryTitle[]>(`${BASE}/titles`, {
      params: { include_retired: includeRetired },
    });
    return asArray(data);
  },

  async createTitle(name: string): Promise<HistoryTitle> {
    const { data } = await api.post<HistoryTitle>(`${BASE}/titles`, { name });
    return data;
  },

  async updateTitle(
    id: string,
    changes: { name?: string | undefined; is_retired?: boolean | undefined }
  ): Promise<HistoryTitle> {
    const { data } = await api.patch<HistoryTitle>(`${BASE}/titles/${id}`, changes);
    return data;
  },

  async mergeTitle(id: string, intoTitleId: string): Promise<HistoryTitle> {
    const { data } = await api.post<HistoryTitle>(`${BASE}/titles/${id}/merge`, { into_title_id: intoTitleId });
    return data;
  },

  // --- Clearance ---

  async listClearanceSteps(): Promise<ClearanceStep[]> {
    const { data } = await api.get<ClearanceStep[]>(`${BASE}/clearance/steps`);
    return asArray(data);
  },

  async listClearancePositions(): Promise<{ id: string; name: string }[]> {
    const { data } = await api.get<{ id: string; name: string }[]>(`${BASE}/clearance/positions`);
    return asArray(data);
  },

  async replaceClearanceSteps(steps: { name: string; position_id: string }[]): Promise<ClearanceStep[]> {
    const { data } = await api.put<ClearanceStep[]>(`${BASE}/clearance/steps`, { steps });
    return asArray(data);
  },

  async submitForClearance(recordId: string, purpose: ClearancePurpose): Promise<ClearanceRequest> {
    const { data } = await api.post<ClearanceRequest>(`${BASE}/clearance/requests`, {
      record_type: 'member',
      record_id: recordId,
      purpose,
    });
    return data;
  },

  async getClearanceReview(requestId: string): Promise<ClearanceReview> {
    const { data } = await api.get<ClearanceReview>(`${BASE}/clearance/requests/${requestId}`);
    return data;
  },

  async decideClearance(requestId: string, decision: ClearanceDecisionKind, note?: string): Promise<ClearanceRequest> {
    const { data } = await api.post<ClearanceRequest>(`${BASE}/clearance/requests/${requestId}/decide`, {
      decision,
      note: note || undefined,
    });
    return data;
  },

  async clearanceQueue(): Promise<ClearanceRequest[]> {
    const { data } = await api.get<ClearanceRequest[]>(`${BASE}/clearance/queue`);
    return asArray(data);
  },

  // --- Import ---

  async downloadImportTemplate(): Promise<Blob> {
    const { data } = await api.get<Blob>(`${BASE}/imports/template`, { responseType: 'blob' });
    return data;
  },

  async listImports(): Promise<ImportSummary[]> {
    const { data } = await api.get<ImportSummary[]>(`${BASE}/imports`);
    return asArray(data);
  },

  async uploadImport(file: File): Promise<ImportDetail> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<ImportDetail>(`${BASE}/imports`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return normalizeImport(data);
  },

  async getImport(id: string): Promise<ImportDetail> {
    const { data } = await api.get<ImportDetail>(`${BASE}/imports/${id}`);
    return normalizeImport(data);
  },

  async updateImportRow(id: string, rowId: string, payload: ImportRowUpdate): Promise<ImportDetail> {
    const { data } = await api.patch<ImportDetail>(`${BASE}/imports/${id}/rows/${rowId}`, payload);
    return normalizeImport(data);
  },

  async acceptSuggestions(id: string): Promise<number> {
    const { data } = await api.post<{ decided: number }>(`${BASE}/imports/${id}/accept-suggestions`);
    return data.decided;
  },

  async setImportTitles(id: string, choices: ImportTitleChoice[]): Promise<ImportDetail> {
    const { data } = await api.put<ImportDetail>(`${BASE}/imports/${id}/titles`, { choices });
    return normalizeImport(data);
  },

  async commitImport(id: string): Promise<ImportSummary> {
    const { data } = await api.post<ImportSummary>(`${BASE}/imports/${id}/commit`);
    return data;
  },

  async discardImport(id: string): Promise<void> {
    await api.delete(`${BASE}/imports/${id}`);
  },

  async removeImportRecords(id: string): Promise<RemoveRecordsResult> {
    const { data } = await api.post<RemoveRecordsResult>(`${BASE}/imports/${id}/remove-records`);
    return { removed: data.removed, kept: asArray(data.kept) };
  },

  // --- Merge ---

  async mergePreview(keepId: string, otherId: string): Promise<MergePreview> {
    const { data } = await api.get<MergePreview>(`${BASE}/people/${keepId}/merge-preview`, {
      params: { other_id: otherId },
    });
    return { ...data, fields: asArray(data.fields), warnings: asArray(data.warnings) };
  },

  async mergePerson(
    keepId: string,
    otherId: string,
    choices: Record<string, MergeChoice>
  ): Promise<HistoricalMemberFullView> {
    const { data } = await api.post<HistoricalMemberFullView>(`${BASE}/people/${keepId}/merge`, {
      other_id: otherId,
      choices,
    });
    return data;
  },
};

function normalizeImport(data: ImportDetail): ImportDetail {
  return {
    ...data,
    rows: asArray(data.rows).map((row) => ({
      ...row,
      problems: asArray(row.problems),
      suggestions: asArray(row.suggestions),
      edited_fields: asArray(row.edited_fields),
    })),
    titles: asArray(data.titles),
    blockers: asArray(data.blockers),
  };
}
