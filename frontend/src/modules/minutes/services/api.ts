/**
 * Minutes Module — API Service
 *
 * Module-local axios instance with auth interceptors (CSRF, cookie auth,
 * 401 auto-refresh) per CLAUDE.md module conventions.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  AgendaSyncPreview,
  MeetingMinutes,
  Motion,
  MotionCreate,
  MotionUpdate,
  ActionItem,
  ActionItemAssignee,
  ActionItemCreate,
  MinutesStats,
  MinutesReminderSettings,
  MinutesSignature,
  SignatureStatus,
  MinutesSearchResult,
  MinutesListItem,
  AttendanceSuggestions,
  AttachmentCategory,
  ImportableElection,
  MinutesAttachment,
  MinutesElectionResult,
  MinutesRevision,
  MinutesVerification,
  MyActionItem,
  OpenActionItem,
  AdoptionDetails,
  ClosedSession,
  ClosedSessionInput,
  MinutesSuggestion,
  MinutesTemplate,
  TemplateCreate,
  TemplateListItem,
  TemplateUpdate,
} from '../types/minutes';
import { asArray } from '../../../utils/asArray';

const api = createApiClient();

export const minutesService = {
  // ── Minutes CRUD ──

  /**
   * Every set of minutes the caller may see, all pages. A member sees only
   * approved, non-executive minutes; the server decides that, not this call.
   */
  async listAllMinutes(): Promise<MinutesListItem[]> {
    const PAGE = 100;
    const all: MinutesListItem[] = [];
    for (let skip = 0; ; skip += PAGE) {
      const response = await api.get<MinutesListItem[]>('/minutes-records', { params: { skip, limit: PAGE } });
      const page = asArray(response.data);
      all.push(...page);
      if (page.length < PAGE) return all;
    }
  },

  async getMinutes(minutesId: string): Promise<MeetingMinutes> {
    const response = await api.get<MeetingMinutes>(`/minutes-records/${minutesId}`);
    return response.data;
  },

  async updateMinutes(minutesId: string, data: Record<string, unknown>): Promise<MeetingMinutes> {
    const response = await api.put<MeetingMinutes>(`/minutes-records/${minutesId}`, data);
    return response.data;
  },

  async deleteMinutes(minutesId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}`);
  },

  // ── Approval Workflow ──

  async submitForApproval(minutesId: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/submit`);
    return response.data;
  },

  /** Adopt circulated minutes ("approve" on the wire), recording how the body adopted them. */
  async approve(minutesId: string, adoption?: AdoptionDetails): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/approve`, adoption ?? null);
    return response.data;
  },

  /** Take circulated minutes back to draft so suggestions can be worked in. */
  async recall(minutesId: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/recall`);
    return response.data;
  },

  async reject(minutesId: string, reason: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/reject`, { reason });
    return response.data;
  },

  /** Return approved minutes to draft so a correction can be made (MM-17). */
  async reopen(minutesId: string, reason: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/reopen`, { reason });
    return response.data;
  },

  // ── Publishing ──

  async publishMinutes(minutesId: string): Promise<void> {
    await api.post(`/minutes-records/${minutesId}/publish`);
  },

  // ── Motions ──

  async addMotion(minutesId: string, data: MotionCreate): Promise<Motion> {
    const response = await api.post<Motion>(`/minutes-records/${minutesId}/motions`, data);
    return response.data;
  },

  async updateMotion(minutesId: string, motionId: string, data: MotionUpdate): Promise<Motion> {
    const response = await api.put<Motion>(`/minutes-records/${minutesId}/motions/${motionId}`, data);
    return response.data;
  },

  async deleteMotion(minutesId: string, motionId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/motions/${motionId}`);
  },

  // ── Action Items ──

  /** Every active member, for the assignee picker (minutes.manage). */
  async getActionItemAssignees(): Promise<ActionItemAssignee[]> {
    const response = await api.get<ActionItemAssignee[]>('/minutes-records/action-item-assignees');
    return asArray(response.data);
  },

  async addActionItem(minutesId: string, data: ActionItemCreate): Promise<ActionItem> {
    const response = await api.post<ActionItem>(`/minutes-records/${minutesId}/action-items`, data);
    return response.data;
  },

  async updateActionItem(minutesId: string, itemId: string, data: Record<string, unknown>): Promise<ActionItem> {
    const response = await api.put<ActionItem>(`/minutes-records/${minutesId}/action-items/${itemId}`, data);
    return response.data;
  },

  async deleteActionItem(minutesId: string, itemId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/action-items/${itemId}`);
  },

  // ── Cross-module Bridge ──

  async createFromMeeting(meetingId: string, templateId?: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(
      `/minutes-records/from-meeting/${meetingId}`,
      null,
      templateId ? { params: { template_id: templateId } } : {}
    );
    return response.data;
  },

  // ── Signatures ──

  async getSignatureStatus(minutesId: string): Promise<SignatureStatus> {
    const response = await api.get<SignatureStatus>(`/minutes-records/${minutesId}/signatures`);
    return response.data;
  },

  /** Sign a slot: the name as typed and the signer's password, which is checked and never kept. */
  async sign(minutesId: string, slotKey: string, signedName: string, password: string): Promise<MinutesSignature> {
    const response = await api.post<MinutesSignature>(`/minutes-records/${minutesId}/signatures`, {
      slot_key: slotKey,
      signed_name: signedName,
      password,
    });
    return response.data;
  },

  // ── Reminder settings ──

  /** What the daily reminder task will do for this department. Written through the organization settings. */
  async getReminderSettings(): Promise<MinutesReminderSettings> {
    const response = await api.get<MinutesReminderSettings>('/minutes-records/settings');
    return response.data;
  },

  // ── Stats & Search ──

  async getStats(): Promise<MinutesStats> {
    const response = await api.get<MinutesStats>('/minutes-records/stats');
    return response.data;
  },

  async search(query: string, limit = 20): Promise<MinutesSearchResult[]> {
    const response = await api.get<MinutesSearchResult[]>('/minutes-records/search', { params: { q: query, limit } });
    return asArray(response.data);
  },

  // ── Roll call ──

  /** A starting roll from event check-ins, else the roster. Nothing is saved. */
  async getAttendanceSuggestions(minutesId: string): Promise<AttendanceSuggestions> {
    const response = await api.get<AttendanceSuggestions>(`/minutes-records/${minutesId}/attendance-suggestions`);
    return response.data;
  },

  /** Recompute quorum from the saved roll call. */
  async recalculateQuorum(minutesId: string): Promise<void> {
    await api.get(`/minutes-records/${minutesId}/quorum`);
  },

  // ── Election results ──

  async getImportableElections(minutesId: string): Promise<ImportableElection[]> {
    const response = await api.get<ImportableElection[]>(`/minutes-records/${minutesId}/importable-elections`);
    return asArray(response.data);
  },

  async getElectionResults(minutesId: string): Promise<MinutesElectionResult[]> {
    const response = await api.get<MinutesElectionResult[]>(`/minutes-records/${minutesId}/election-results`);
    return asArray(response.data);
  },

  async fileElectionResult(minutesId: string, electionId: string): Promise<MinutesElectionResult> {
    const response = await api.post<MinutesElectionResult>(`/minutes-records/${minutesId}/election-results`, {
      election_id: electionId,
    });
    return response.data;
  },

  async removeElectionResult(minutesId: string, resultId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/election-results/${resultId}`);
  },

  // ── Attachments ──

  async getAttachments(minutesId: string): Promise<MinutesAttachment[]> {
    const response = await api.get<MinutesAttachment[]>(`/minutes-records/${minutesId}/attachments`);
    return asArray(response.data);
  },

  async uploadAttachment(
    minutesId: string,
    file: File,
    details: { title: string; category: AttachmentCategory; description?: string | undefined }
  ): Promise<MinutesAttachment> {
    const form = new FormData();
    form.append('file', file);
    form.append('title', details.title);
    form.append('category', details.category);
    if (details.description) form.append('description', details.description);
    const response = await api.post<MinutesAttachment>(`/minutes-records/${minutesId}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async downloadAttachment(minutesId: string, attachmentId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/minutes-records/${minutesId}/attachments/${attachmentId}/file`, {
      responseType: 'blob',
    });
    return response.data;
  },

  async deleteAttachment(minutesId: string, attachmentId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/attachments/${attachmentId}`);
  },

  // ── Approved versions ──

  async getRevisions(minutesId: string): Promise<MinutesRevision[]> {
    const response = await api.get<MinutesRevision[]>(`/minutes-records/${minutesId}/revisions`);
    return asArray(response.data);
  },

  async verify(minutesId: string): Promise<MinutesVerification> {
    const response = await api.get<MinutesVerification>(`/minutes-records/${minutesId}/verify`);
    return response.data;
  },

  // ── Printable copy ──

  async downloadPdf(minutesId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/minutes-records/${minutesId}/pdf`, { responseType: 'blob' });
    return response.data;
  },

  // ── Carrying action items between meetings ──

  async getOpenActionItems(minutesId: string, includeOtherTypes = false): Promise<OpenActionItem[]> {
    const response = await api.get<OpenActionItem[]>(`/minutes-records/${minutesId}/open-action-items`, {
      params: { include_other_types: includeOtherTypes },
    });
    return asArray(response.data);
  },

  async carryForward(minutesId: string, itemIds: string[], includeOtherTypes = false): Promise<ActionItem[]> {
    const response = await api.post<ActionItem[]>(
      `/minutes-records/${minutesId}/carry-forward`,
      { item_ids: itemIds },
      { params: { include_other_types: includeOtherTypes } }
    );
    return asArray(response.data);
  },

  /** Items assigned to the caller in approved minutes, across all meetings. */
  async getMyActionItems(includeClosed = false): Promise<MyActionItem[]> {
    const response = await api.get<MyActionItem[]>('/minutes-records/action-items/mine', {
      params: { include_closed: includeClosed },
    });
    return asArray(response.data);
  },

  // ── Outlines (the "templates" of the API) ──

  async getOutlines(meetingType?: string): Promise<TemplateListItem[]> {
    const response = await api.get<TemplateListItem[]>('/minutes-records/templates', {
      params: meetingType ? { meeting_type: meetingType } : {},
    });
    return asArray(response.data);
  },

  async getOutline(outlineId: string): Promise<MinutesTemplate> {
    const response = await api.get<MinutesTemplate>(`/minutes-records/templates/${outlineId}`);
    return response.data;
  },

  async createOutline(data: TemplateCreate): Promise<MinutesTemplate> {
    const response = await api.post<MinutesTemplate>('/minutes-records/templates', data);
    return response.data;
  },

  async updateOutline(outlineId: string, data: TemplateUpdate): Promise<MinutesTemplate> {
    const response = await api.put<MinutesTemplate>(`/minutes-records/templates/${outlineId}`, data);
    return response.data;
  },

  async deleteOutline(outlineId: string): Promise<void> {
    await api.delete(`/minutes-records/templates/${outlineId}`);
  },

  /** Lay an outline over draft minutes, keeping everything already written. */
  async applyOutline(minutesId: string, outlineId: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/apply-outline`, {
      template_id: outlineId,
    });
    return response.data;
  },

  /** What the meeting's agenda now asks of these minutes' sections. */
  async getAgendaSync(minutesId: string): Promise<AgendaSyncPreview> {
    const response = await api.get<AgendaSyncPreview>(`/minutes-records/${minutesId}/agenda-sync`);
    return response.data;
  },

  /** Apply the chosen agenda changes (by the ids the preview gave) to draft minutes. */
  async applyAgendaSync(minutesId: string, accept: string[]): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/agenda-sync`, { accept });
    return response.data;
  },

  // ── Closed sessions ──

  async getClosedSessions(minutesId: string): Promise<ClosedSession[]> {
    const response = await api.get<ClosedSession[]>(`/minutes-records/${minutesId}/closed-sessions`);
    return asArray(response.data);
  },

  async addClosedSession(minutesId: string, data: ClosedSessionInput): Promise<ClosedSession> {
    const response = await api.post<ClosedSession>(`/minutes-records/${minutesId}/closed-sessions`, data);
    return response.data;
  },

  async updateClosedSession(minutesId: string, sessionId: string, data: ClosedSessionInput): Promise<ClosedSession> {
    const response = await api.put<ClosedSession>(`/minutes-records/${minutesId}/closed-sessions/${sessionId}`, data);
    return response.data;
  },

  async deleteClosedSession(minutesId: string, sessionId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/closed-sessions/${sessionId}`);
  },

  // ── Member suggestions during review ──

  async getSuggestions(minutesId: string): Promise<MinutesSuggestion[]> {
    const response = await api.get<MinutesSuggestion[]>(`/minutes-records/${minutesId}/suggestions`);
    return asArray(response.data);
  },

  async addSuggestion(
    minutesId: string,
    data: {
      section_key?: string | undefined;
      comment?: string | undefined;
      proposed_text?: string | undefined;
      /** The reviewer's edited copy of the section; the server derives the tracked changes. */
      proposed_html?: string | undefined;
    }
  ): Promise<MinutesSuggestion> {
    const response = await api.post<MinutesSuggestion>(`/minutes-records/${minutesId}/suggestions`, data);
    return response.data;
  },

  /** Write the accepted tracked changes into the section; the rest are rejected. Draft minutes only. */
  async applySuggestion(
    minutesId: string,
    suggestionId: string,
    accepted: string[],
    note?: string
  ): Promise<MinutesSuggestion> {
    const response = await api.post<MinutesSuggestion>(
      `/minutes-records/${minutesId}/suggestions/${suggestionId}/apply`,
      { accepted, note: note || null }
    );
    return response.data;
  },

  async resolveSuggestion(
    minutesId: string,
    suggestionId: string,
    status: 'accepted' | 'declined',
    note?: string
  ): Promise<MinutesSuggestion> {
    const response = await api.put<MinutesSuggestion>(`/minutes-records/${minutesId}/suggestions/${suggestionId}`, {
      status,
      note: note || null,
    });
    return response.data;
  },
};
