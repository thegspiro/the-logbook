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
  AlbumDetail,
  AlbumLevel,
  AlbumSummary,
  HistorySource,
  MediaFullView,
  MediaList,
  MediaPublishResult,
  MediaQuery,
  MediaSummary,
  MediaUpdate,
  MediaUploadFields,
  MediaView,
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

  async submitForClearance(
    recordId: string,
    purpose: ClearancePurpose,
    recordType: 'member' | 'media' = 'member'
  ): Promise<ClearanceRequest> {
    const { data } = await api.post<ClearanceRequest>(`${BASE}/clearance/requests`, {
      record_type: recordType,
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

/** Where a media item's files are read from. Plain URLs, so an <img>,
 * <audio> or <video> loads them directly: the session cookie goes with a
 * same-origin request, and the server checks the item is readable. */
const MEDIA_FILE_BASE = `/api/v1${BASE}/media`;

export const mediaFileUrl = (id: string, which: 'thumbnail' | 'view' | 'original'): string =>
  `${MEDIA_FILE_BASE}/${encodeURIComponent(id)}/${which}`;

export const historyMediaService = {
  async listMedia(query: MediaQuery = {}): Promise<MediaList> {
    const { data } = await api.get<MediaList>(`${BASE}/media`, { params: query });
    return { items: asArray(data.items), total: data.total };
  },

  async getMedia(id: string): Promise<MediaView> {
    const { data } = await api.get<MediaView>(`${BASE}/media/${id}`);
    return { ...data, tags: asArray(data.tags) } as MediaView;
  },

  /** One file of a batch. Each goes in its own request: the server accepts 60 MB
   * per request, and one refused file must not stop the rest. */
  async uploadMedia(
    file: File,
    catalogue: MediaUploadFields,
    batchId: string,
    onProgress?: (fraction: number) => void
  ): Promise<MediaFullView> {
    const form = new FormData();
    form.append('file', file);
    form.append('catalogue', JSON.stringify(catalogue));
    form.append('batch_id', batchId);
    const { data } = await api.post<MediaFullView>(`${BASE}/media`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // A 55 MB file over a slow connection outlasts the default timeout.
      timeout: 0,
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(event.loaded / event.total);
      },
    });
    return data;
  },

  async updateMedia(id: string, payload: MediaUpdate): Promise<MediaFullView> {
    const { data } = await api.patch<MediaFullView>(`${BASE}/media/${id}`, payload);
    return data;
  },

  async replaceTags(id: string, memberIds: string[]): Promise<MediaFullView> {
    const { data } = await api.put<MediaFullView>(`${BASE}/media/${id}/tags`, { member_ids: memberIds });
    return data;
  },

  async deleteMedia(id: string): Promise<void> {
    await api.delete(`${BASE}/media/${id}`);
  },

  async publish(id: string, level: 'members' | 'public'): Promise<MediaPublishResult> {
    const { data } = await api.post<MediaPublishResult>(`${BASE}/media/${id}/publish`, { level });
    return { ...data, consent_warnings: asArray(data.consent_warnings) };
  },

  async unpublish(id: string, level: 'draft' | 'members'): Promise<MediaFullView> {
    const { data } = await api.post<MediaFullView>(`${BASE}/media/${id}/unpublish`, { level });
    return data;
  },

  async listRevisions(id: string): Promise<Revision[]> {
    const { data } = await api.get<Revision[]>(`${BASE}/media/${id}/revisions`);
    return asArray(data);
  },

  async personMedia(personId: string): Promise<MediaSummary[]> {
    const { data } = await api.get<MediaSummary[]>(`${BASE}/people/${personId}/media`);
    return asArray(data);
  },

  async downloadOriginal(id: string): Promise<Blob> {
    const { data } = await api.get<Blob>(`${BASE}/media/${id}/original`, { responseType: 'blob' });
    return data;
  },

  // --- Sources ---

  async listSources(includeRetired = false): Promise<HistorySource[]> {
    const { data } = await api.get<HistorySource[]>(`${BASE}/sources`, {
      params: { include_retired: includeRetired },
    });
    return asArray(data);
  },

  async createSource(name: string): Promise<HistorySource> {
    const { data } = await api.post<HistorySource>(`${BASE}/sources`, { name });
    return data;
  },

  async updateSource(
    id: string,
    changes: { name?: string | undefined; is_retired?: boolean | undefined }
  ): Promise<HistorySource> {
    const { data } = await api.patch<HistorySource>(`${BASE}/sources/${id}`, changes);
    return data;
  },

  async mergeSource(id: string, intoSourceId: string): Promise<HistorySource> {
    const { data } = await api.post<HistorySource>(`${BASE}/sources/${id}/merge`, { into_source_id: intoSourceId });
    return data;
  },

  // --- Albums ---

  async listAlbums(): Promise<AlbumSummary[]> {
    const { data } = await api.get<AlbumSummary[]>(`${BASE}/albums`);
    return asArray(data);
  },

  async getAlbum(id: string): Promise<AlbumDetail> {
    const { data } = await api.get<AlbumDetail>(`${BASE}/albums/${id}`);
    return { ...data, items: asArray(data.items) };
  },

  async createAlbum(payload: {
    name: string;
    description?: string | undefined;
    level?: AlbumLevel | undefined;
  }): Promise<AlbumDetail> {
    const { data } = await api.post<AlbumDetail>(`${BASE}/albums`, payload);
    return { ...data, items: asArray(data.items) };
  },

  async updateAlbum(
    id: string,
    payload: {
      name?: string | undefined;
      description?: string | null | undefined;
      level?: AlbumLevel | undefined;
      cover_media_id?: string | null | undefined;
    }
  ): Promise<AlbumDetail> {
    const { data } = await api.patch<AlbumDetail>(`${BASE}/albums/${id}`, payload);
    return { ...data, items: asArray(data.items) };
  },

  async setAlbumItems(id: string, mediaIds: string[]): Promise<AlbumDetail> {
    const { data } = await api.put<AlbumDetail>(`${BASE}/albums/${id}/items`, { media_ids: mediaIds });
    return { ...data, items: asArray(data.items) };
  },

  async deleteAlbum(id: string): Promise<void> {
    await api.delete(`${BASE}/albums/${id}`);
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
