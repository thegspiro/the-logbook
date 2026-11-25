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
  AlbumEntryRef,
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
  DocumentFullView,
  DocumentList,
  DocumentQuery,
  DocumentSummary,
  DocumentUpdate,
  DocumentUploadFields,
  DocumentView,
  HistoryDocumentType,
  ApparatusCreate,
  ApparatusFullView,
  ApparatusList,
  ApparatusQuery,
  ApparatusUpdate,
  ApparatusView,
  ClearanceRecordType,
  EventCreate,
  EventFullView,
  EventList,
  EventQuery,
  EventSummary,
  EventUpdate,
  EventView,
  FleetOption,
  HistoryListEntry,
  TimelineDecade,
  TimelineEntry,
  TimelineKind,
  ArticleCreate,
  ArticleExportFormat,
  ArticleFullView,
  ArticleList,
  ArticleQuery,
  ArticleSummary,
  ArticleUpdate,
  ArticleView,
  HistoryPublicSettings,
  HistoryPublicSettingsUpdate,
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
    changes: {
      name?: string | undefined;
      is_retired?: boolean | undefined;
      show_on_timeline?: boolean | undefined;
    }
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

  // --- Public website ---

  async getPublicSettings(): Promise<HistoryPublicSettings> {
    const { data } = await api.get<HistoryPublicSettings>(`${BASE}/public-settings`);
    return { ...data, widget_websites: asArray(data.widget_websites) };
  },

  async updatePublicSettings(values: HistoryPublicSettingsUpdate): Promise<HistoryPublicSettings> {
    const { data } = await api.put<HistoryPublicSettings>(`${BASE}/public-settings`, values);
    return { ...data, widget_websites: asArray(data.widget_websites) };
  },

  /** A new widget link. Its secret is returned this once. */
  async makeWidgetLink(): Promise<string> {
    const { data } = await api.post<{ token: string }>(`${BASE}/public-settings/widget-link`);
    return data.token;
  },

  async removeWidgetLink(): Promise<void> {
    await api.delete(`${BASE}/public-settings/widget-link`);
  },

  async replaceClearanceSteps(steps: { name: string; position_id: string }[]): Promise<ClearanceStep[]> {
    const { data } = await api.put<ClearanceStep[]>(`${BASE}/clearance/steps`, { steps });
    return asArray(data);
  },

  async submitForClearance(
    recordId: string,
    purpose: ClearancePurpose,
    recordType: ClearanceRecordType = 'member'
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
    const links = { apparatus: asArray(data.apparatus), events: asArray(data.events) };
    // Narrowed first: a spread of the union would lose which view it is.
    if (data.view === 'full') return { ...data, ...links, tags: asArray(data.tags) };
    return { ...data, ...links, tags: asArray(data.tags) };
  },

  async replaceApparatus(id: string, apparatusIds: string[]): Promise<MediaFullView> {
    const { data } = await api.put<MediaFullView>(`${BASE}/media/${id}/apparatus`, {
      apparatus_ids: apparatusIds,
    });
    return data;
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
    return normalizeAlbum(data);
  },

  async createAlbum(payload: {
    name: string;
    description?: string | undefined;
    level?: AlbumLevel | undefined;
  }): Promise<AlbumDetail> {
    const { data } = await api.post<AlbumDetail>(`${BASE}/albums`, payload);
    return normalizeAlbum(data);
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
    return normalizeAlbum(data);
  },

  async setAlbumItems(id: string, mediaIds: string[]): Promise<AlbumDetail> {
    const { data } = await api.put<AlbumDetail>(`${BASE}/albums/${id}/items`, { media_ids: mediaIds });
    return normalizeAlbum(data);
  },

  /** Photos and documents together, in order: replaces the whole album. */
  async setAlbumEntries(id: string, entries: AlbumEntryRef[]): Promise<AlbumDetail> {
    const { data } = await api.put<AlbumDetail>(`${BASE}/albums/${id}/items`, { entries });
    return normalizeAlbum(data);
  },

  async deleteAlbum(id: string): Promise<void> {
    await api.delete(`${BASE}/albums/${id}`);
  },
};

function normalizeAlbum(data: AlbumDetail): AlbumDetail {
  return { ...data, items: asArray(data.items), entries: asArray(data.entries) };
}

/** Where a document's preview and readable copy are read from: plain URLs, so
 * an <img> loads the preview and a link opens the PDF in the browser's own
 * viewer, in its own tab. The original is not here: it is downloaded through
 * the authenticated client by history.manage alone. */
const DOCUMENT_FILE_BASE = `/api/v1${BASE}/documents`;

export const documentFileUrl = (id: string, which: 'thumbnail' | 'view'): string =>
  `${DOCUMENT_FILE_BASE}/${encodeURIComponent(id)}/${which}`;

export const historyDocumentService = {
  async listDocuments(query: DocumentQuery = {}): Promise<DocumentList> {
    const { data } = await api.get<DocumentList>(`${BASE}/documents`, { params: query });
    return { items: asArray(data.items), total: data.total };
  },

  async getDocument(id: string): Promise<DocumentView> {
    const { data } = await api.get<DocumentView>(`${BASE}/documents/${id}`);
    const links = { apparatus: asArray(data.apparatus), events: asArray(data.events) };
    if (data.view === 'full') return { ...data, ...links, tags: asArray(data.tags) };
    return { ...data, ...links, tags: asArray(data.tags) };
  },

  async replaceApparatus(id: string, apparatusIds: string[]): Promise<DocumentFullView> {
    const { data } = await api.put<DocumentFullView>(`${BASE}/documents/${id}/apparatus`, {
      apparatus_ids: apparatusIds,
    });
    return data;
  },

  async uploadDocument(
    file: File,
    catalogue: DocumentUploadFields,
    batchId: string,
    onProgress?: (fraction: number) => void
  ): Promise<DocumentFullView> {
    const form = new FormData();
    form.append('file', file);
    form.append('catalogue', JSON.stringify(catalogue));
    form.append('batch_id', batchId);
    const { data } = await api.post<DocumentFullView>(`${BASE}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // A 50 MB scan over a slow connection outlasts the default timeout.
      timeout: 0,
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(event.loaded / event.total);
      },
    });
    return data;
  },

  async updateDocument(id: string, payload: DocumentUpdate): Promise<DocumentFullView> {
    const { data } = await api.patch<DocumentFullView>(`${BASE}/documents/${id}`, payload);
    return data;
  },

  async replaceTags(id: string, memberIds: string[]): Promise<DocumentFullView> {
    const { data } = await api.put<DocumentFullView>(`${BASE}/documents/${id}/tags`, { member_ids: memberIds });
    return data;
  },

  async deleteDocument(id: string): Promise<void> {
    await api.delete(`${BASE}/documents/${id}`);
  },

  async publish(id: string, level: 'members' | 'public'): Promise<DocumentFullView> {
    const { data } = await api.post<DocumentFullView>(`${BASE}/documents/${id}/publish`, { level });
    return data;
  },

  async unpublish(id: string, level: 'draft' | 'members'): Promise<DocumentFullView> {
    const { data } = await api.post<DocumentFullView>(`${BASE}/documents/${id}/unpublish`, { level });
    return data;
  },

  async listRevisions(id: string): Promise<Revision[]> {
    const { data } = await api.get<Revision[]>(`${BASE}/documents/${id}/revisions`);
    return asArray(data);
  },

  async personDocuments(personId: string): Promise<DocumentSummary[]> {
    const { data } = await api.get<DocumentSummary[]>(`${BASE}/people/${personId}/documents`);
    return asArray(data);
  },

  async downloadOriginal(id: string): Promise<Blob> {
    const { data } = await api.get<Blob>(`${BASE}/documents/${id}/original`, { responseType: 'blob' });
    return data;
  },

  // --- Document types ---

  async listTypes(includeRetired = false): Promise<HistoryDocumentType[]> {
    const { data } = await api.get<HistoryDocumentType[]>(`${BASE}/document-types`, {
      params: { include_retired: includeRetired },
    });
    return asArray(data);
  },

  async createType(name: string): Promise<HistoryDocumentType> {
    const { data } = await api.post<HistoryDocumentType>(`${BASE}/document-types`, { name });
    return data;
  },

  async updateType(
    id: string,
    changes: { name?: string | undefined; is_retired?: boolean | undefined }
  ): Promise<HistoryDocumentType> {
    const { data } = await api.patch<HistoryDocumentType>(`${BASE}/document-types/${id}`, changes);
    return data;
  },

  async mergeType(id: string, intoTypeId: string): Promise<HistoryDocumentType> {
    const { data } = await api.post<HistoryDocumentType>(`${BASE}/document-types/${id}/merge`, {
      into_type_id: intoTypeId,
    });
    return data;
  },
};

// --- Phase 5: managed lists ---

/** The three phase 5 managed lists, by their path under /history. */
export type ManagedListPath = 'stations' | 'apparatus-types' | 'event-types';

export const historyListService = {
  async list(path: ManagedListPath, includeRetired = false): Promise<HistoryListEntry[]> {
    const { data } = await api.get<HistoryListEntry[]>(`${BASE}/${path}`, {
      params: { include_retired: includeRetired },
    });
    return asArray(data);
  },

  async create(path: ManagedListPath, name: string): Promise<HistoryListEntry> {
    const { data } = await api.post<HistoryListEntry>(`${BASE}/${path}`, { name });
    return data;
  },

  async update(
    path: ManagedListPath,
    id: string,
    changes: { name?: string | undefined; is_retired?: boolean | undefined }
  ): Promise<HistoryListEntry> {
    const { data } = await api.patch<HistoryListEntry>(`${BASE}/${path}/${id}`, changes);
    return data;
  },

  async merge(path: ManagedListPath, id: string, intoId: string): Promise<HistoryListEntry> {
    const { data } = await api.post<HistoryListEntry>(`${BASE}/${path}/${id}/merge`, { into_id: intoId });
    return data;
  },
};

// --- Phase 5: historical apparatus ---

function normalizeApparatus<T extends ApparatusView>(data: T): T {
  return { ...data, designations: asArray(data.designations) };
}

export const historyApparatusService = {
  async listApparatus(query: ApparatusQuery = {}): Promise<ApparatusList> {
    const { data } = await api.get<ApparatusList>(`${BASE}/apparatus`, { params: query });
    return {
      items: asArray(data.items).map((item) => ({ ...item, designations: asArray(item.designations) })),
      total: data.total,
    };
  },

  async getApparatus(id: string): Promise<ApparatusView> {
    const { data } = await api.get<ApparatusView>(`${BASE}/apparatus/${id}`);
    return normalizeApparatus(data);
  },

  async createApparatus(payload: ApparatusCreate): Promise<ApparatusFullView> {
    const { data } = await api.post<ApparatusFullView>(`${BASE}/apparatus`, payload);
    return normalizeApparatus(data);
  },

  async updateApparatus(id: string, payload: ApparatusUpdate): Promise<ApparatusFullView> {
    const { data } = await api.patch<ApparatusFullView>(`${BASE}/apparatus/${id}`, payload);
    return normalizeApparatus(data);
  },

  async deleteApparatus(id: string): Promise<void> {
    await api.delete(`${BASE}/apparatus/${id}`);
  },

  async publish(id: string, level: 'members' | 'public'): Promise<ApparatusFullView> {
    const { data } = await api.post<ApparatusFullView>(`${BASE}/apparatus/${id}/publish`, { level });
    return normalizeApparatus(data);
  },

  async unpublish(id: string, level: 'draft' | 'members'): Promise<ApparatusFullView> {
    const { data } = await api.post<ApparatusFullView>(`${BASE}/apparatus/${id}/unpublish`, { level });
    return normalizeApparatus(data);
  },

  async listRevisions(id: string): Promise<Revision[]> {
    const { data } = await api.get<Revision[]>(`${BASE}/apparatus/${id}/revisions`);
    return asArray(data);
  },

  async timeline(id: string): Promise<TimelineEntry[]> {
    const { data } = await api.get<TimelineEntry[]>(`${BASE}/apparatus/${id}/timeline`);
    return asArray(data);
  },

  async fleetOptions(): Promise<FleetOption[]> {
    const { data } = await api.get<FleetOption[]>(`${BASE}/apparatus/fleet-options`);
    return asArray(data);
  },

  async createFromFleet(fleetApparatusId: string): Promise<ApparatusFullView> {
    const { data } = await api.post<ApparatusFullView>(`${BASE}/apparatus/from-fleet`, {
      fleet_apparatus_id: fleetApparatusId,
    });
    return normalizeApparatus(data);
  },
};

// --- Phase 5: events ---

function normalizeEvent<T extends EventView>(data: T): T {
  return {
    ...data,
    members: asArray(data.members),
    apparatus: asArray(data.apparatus),
    media: asArray(data.media),
    documents: asArray(data.documents),
  };
}

export const historyEventService = {
  async listEvents(query: EventQuery = {}): Promise<EventList> {
    const { data } = await api.get<EventList>(`${BASE}/events`, { params: query });
    return { items: asArray(data.items), total: data.total };
  },

  async getEvent(id: string): Promise<EventView> {
    const { data } = await api.get<EventView>(`${BASE}/events/${id}`);
    return normalizeEvent(data);
  },

  async createEvent(payload: EventCreate): Promise<EventFullView> {
    const { data } = await api.post<EventFullView>(`${BASE}/events`, payload);
    return normalizeEvent(data);
  },

  async updateEvent(id: string, payload: EventUpdate): Promise<EventFullView> {
    const { data } = await api.patch<EventFullView>(`${BASE}/events/${id}`, payload);
    return normalizeEvent(data);
  },

  async deleteEvent(id: string): Promise<void> {
    await api.delete(`${BASE}/events/${id}`);
  },

  async publish(id: string, level: 'members' | 'public'): Promise<EventFullView> {
    const { data } = await api.post<EventFullView>(`${BASE}/events/${id}/publish`, { level });
    return normalizeEvent(data);
  },

  async unpublish(id: string, level: 'draft' | 'members'): Promise<EventFullView> {
    const { data } = await api.post<EventFullView>(`${BASE}/events/${id}/unpublish`, { level });
    return normalizeEvent(data);
  },

  async listRevisions(id: string): Promise<Revision[]> {
    const { data } = await api.get<Revision[]>(`${BASE}/events/${id}/revisions`);
    return asArray(data);
  },

  async relatedTo(query: { member_id?: string; apparatus_id?: string }): Promise<EventSummary[]> {
    const { data } = await api.get<EventList>(`${BASE}/events`, { params: { ...query, limit: 200 } });
    return asArray(data.items);
  },
};

// --- Phase 6: articles ---

function normalizeArticle<T extends ArticleView>(data: T): T {
  return {
    ...data,
    blocks: asArray(data.blocks),
    citations: asArray(data.citations),
    members: asArray(data.members),
    events: asArray(data.events),
    apparatus: asArray(data.apparatus),
    documents: asArray(data.documents),
    sources: asArray(data.sources),
  };
}

export const historyArticleService = {
  async listArticles(query: ArticleQuery = {}): Promise<ArticleList> {
    const { data } = await api.get<ArticleList>(`${BASE}/articles`, { params: query });
    return { items: asArray(data.items), total: data.total };
  },

  async getArticle(id: string): Promise<ArticleView> {
    const { data } = await api.get<ArticleView>(`${BASE}/articles/${id}`);
    return normalizeArticle(data);
  },

  async createArticle(payload: ArticleCreate): Promise<ArticleFullView> {
    const { data } = await api.post<ArticleFullView>(`${BASE}/articles`, payload);
    return normalizeArticle(data);
  },

  async updateArticle(id: string, payload: ArticleUpdate): Promise<ArticleFullView> {
    const { data } = await api.patch<ArticleFullView>(`${BASE}/articles/${id}`, payload);
    return normalizeArticle(data);
  },

  async deleteArticle(id: string): Promise<void> {
    await api.delete(`${BASE}/articles/${id}`);
  },

  async publish(id: string, level: 'members' | 'public'): Promise<ArticleFullView> {
    const { data } = await api.post<ArticleFullView>(`${BASE}/articles/${id}/publish`, { level });
    return normalizeArticle(data);
  },

  async unpublish(id: string, level: 'draft' | 'members'): Promise<ArticleFullView> {
    const { data } = await api.post<ArticleFullView>(`${BASE}/articles/${id}/unpublish`, { level });
    return normalizeArticle(data);
  },

  async listRevisions(id: string): Promise<Revision[]> {
    const { data } = await api.get<Revision[]>(`${BASE}/articles/${id}/revisions`);
    return asArray(data);
  },

  /** The articles a person, event, apparatus, document or photo is in. */
  async relatedTo(
    query: Pick<ArticleQuery, 'member_id' | 'event_id' | 'apparatus_id' | 'document_id' | 'media_id'>
  ): Promise<ArticleSummary[]> {
    const { data } = await api.get<ArticleList>(`${BASE}/articles`, { params: { ...query, limit: 200 } });
    return asArray(data.items);
  },

  async exportArticle(id: string, format: ArticleExportFormat): Promise<Blob> {
    const { data } = await api.get<Blob>(`${BASE}/articles/${id}/export`, {
      params: { format },
      responseType: 'blob',
    });
    return data;
  },
};

// --- Phase 5: timelines and "Today in history" ---

export interface TimelineFilters {
  kinds?: TimelineKind[] | undefined;
  event_type_id?: string | undefined;
}

/** Repeated keys (`kinds=event&kinds=title`), the shape FastAPI reads a list
 * query parameter in; axios would otherwise send `kinds[]=`. */
const timelineParams = (filters: TimelineFilters, extra: Record<string, string | number> = {}) => {
  const params = new URLSearchParams();
  Object.entries(extra).forEach(([key, value]) => params.append(key, String(value)));
  (filters.kinds ?? []).forEach((kind) => params.append('kinds', kind));
  if (filters.event_type_id) params.append('event_type_id', filters.event_type_id);
  return params;
};

export const historyTimelineService = {
  async decades(filters: TimelineFilters = {}): Promise<TimelineDecade[]> {
    const { data } = await api.get<TimelineDecade[]>(`${BASE}/timeline/decades`, {
      params: timelineParams(filters),
    });
    return asArray(data);
  },

  async decade(decade: number, filters: TimelineFilters = {}): Promise<TimelineEntry[]> {
    const { data } = await api.get<TimelineEntry[]>(`${BASE}/timeline`, {
      params: timelineParams(filters, { decade }),
    });
    return asArray(data);
  },

  async today(): Promise<TimelineEntry[]> {
    const { data } = await api.get<TimelineEntry[]>(`${BASE}/today`);
    return asArray(data);
  },

  async personTimeline(personId: string): Promise<TimelineEntry[]> {
    const { data } = await api.get<TimelineEntry[]>(`${BASE}/people/${personId}/timeline`);
    return asArray(data);
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
