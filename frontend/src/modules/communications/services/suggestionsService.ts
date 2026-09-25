/**
 * suggestionsService — the suggestion boxes behind /suggestions and
 * /communications/suggestion-boxes.
 *
 * Uses the shared client, so auth cookies and the CSRF header come with it.
 * `/suggestions` is in `UNCACHEABLE_PREFIXES`: a complaint must not sit in a
 * browser cache, and a thread read back from one would hide a reply.
 *
 * Follow-up keys are only ever sent in a POST body — never a URL, where they
 * would land in access logs and browser history.
 */

import api from '../../../services/apiClient';
import { asArray } from '../../../utils/asArray';
import type {
  BoardEntry,
  BoardSort,
  DispositionUpdate,
  MySuggestionSummary,
  ReviewerOptions,
  ReviewFilter,
  ReviewSuggestionDetail,
  ReviewSuggestionSummary,
  ReviewSummary,
  SubmissionReceipt,
  SubmitterSuggestionDetail,
  SuggestionBoxAdmin,
  SuggestionBoxPublic,
  SuggestionBoxWrite,
} from '../types/suggestions';

export const suggestionsService = {
  async listBoxes(): Promise<SuggestionBoxPublic[]> {
    const response = await api.get<SuggestionBoxPublic[]>('/suggestions/boxes');
    return asArray(response.data);
  },

  async submit(
    boxId: string,
    data: { title: string; details: string; anonymous: boolean; screenshots: File[] }
  ): Promise<SubmissionReceipt> {
    const form = new FormData();
    form.append('title', data.title);
    form.append('details', data.details);
    form.append('anonymous', data.anonymous ? 'true' : 'false');
    data.screenshots.forEach((file) => form.append('screenshots', file));
    const response = await api.post<SubmissionReceipt>(`/suggestions/boxes/${boxId}/submissions`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // The submitter's own named submissions
  async listMine(): Promise<MySuggestionSummary[]> {
    const response = await api.get<MySuggestionSummary[]>('/suggestions/mine');
    return asArray(response.data);
  },
  async getMine(id: string): Promise<SubmitterSuggestionDetail> {
    const response = await api.get<SubmitterSuggestionDetail>(`/suggestions/mine/${id}`);
    return response.data;
  },
  async replyMine(id: string, body: string): Promise<SubmitterSuggestionDetail> {
    const response = await api.post<SubmitterSuggestionDetail>(`/suggestions/mine/${id}/messages`, { body });
    return response.data;
  },
  async getMineAttachment(id: string, attachmentId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/suggestions/mine/${id}/attachments/${attachmentId}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // Anonymous follow-up by key
  async lookupByKey(key: string): Promise<SubmitterSuggestionDetail> {
    const response = await api.post<SubmitterSuggestionDetail>('/suggestions/follow-up/lookup', { key });
    return response.data;
  },
  async replyByKey(key: string, body: string): Promise<SubmitterSuggestionDetail> {
    const response = await api.post<SubmitterSuggestionDetail>('/suggestions/follow-up/messages', { key, body });
    return response.data;
  },
  async getAttachmentByKey(key: string, attachmentId: string): Promise<Blob> {
    const response = await api.post<Blob>(
      `/suggestions/follow-up/attachments/${attachmentId}`,
      { key },
      { responseType: 'blob' }
    );
    return response.data;
  },

  // Reviewing
  async getReviewSummary(): Promise<ReviewSummary> {
    const response = await api.get<ReviewSummary>('/suggestions/review/summary');
    return response.data;
  },
  async listForReview(params: {
    boxId?: string | undefined;
    disposition?: ReviewFilter | undefined;
    skip?: number;
    limit?: number;
  }): Promise<{ items: ReviewSuggestionSummary[]; total: number }> {
    const response = await api.get<{ items: ReviewSuggestionSummary[]; total: number }>('/suggestions/review', {
      params: {
        box_id: params.boxId || undefined,
        disposition: params.disposition || undefined,
        skip: params.skip,
        limit: params.limit,
      },
    });
    return { items: asArray(response.data.items), total: response.data.total };
  },
  async getForReview(id: string): Promise<ReviewSuggestionDetail> {
    const response = await api.get<ReviewSuggestionDetail>(`/suggestions/review/${id}`);
    return response.data;
  },
  async updateDisposition(id: string, data: DispositionUpdate): Promise<ReviewSuggestionDetail> {
    const response = await api.patch<ReviewSuggestionDetail>(`/suggestions/review/${id}`, data);
    return response.data;
  },
  async replyAsReviewer(id: string, body: string): Promise<ReviewSuggestionDetail> {
    const response = await api.post<ReviewSuggestionDetail>(`/suggestions/review/${id}/messages`, { body });
    return response.data;
  },
  async publish(id: string, data: { title: string; summary: string }): Promise<ReviewSuggestionDetail> {
    const response = await api.post<ReviewSuggestionDetail>(`/suggestions/review/${id}/publish`, data);
    return response.data;
  },
  async unpublish(id: string): Promise<ReviewSuggestionDetail> {
    const response = await api.delete<ReviewSuggestionDetail>(`/suggestions/review/${id}/publish`);
    return response.data;
  },

  // The idea board
  async listBoard(params: {
    boxId?: string;
    disposition?: ReviewFilter;
    sort: BoardSort;
    skip: number;
    limit: number;
  }): Promise<{ items: BoardEntry[]; total: number }> {
    const response = await api.get<{ items: BoardEntry[]; total: number }>('/suggestions/board', {
      params: {
        box_id: params.boxId || undefined,
        disposition: params.disposition || undefined,
        sort: params.sort,
        skip: params.skip,
        limit: params.limit,
      },
    });
    return { items: asArray(response.data.items), total: response.data.total };
  },
  async vote(id: string): Promise<BoardEntry> {
    const response = await api.post<BoardEntry>(`/suggestions/board/${id}/vote`);
    return response.data;
  },
  async withdrawVote(id: string): Promise<BoardEntry> {
    const response = await api.delete<BoardEntry>(`/suggestions/board/${id}/vote`);
    return response.data;
  },

  async getForwardOptions(): Promise<ReviewerOptions> {
    const response = await api.get<ReviewerOptions>('/suggestions/review/forward-options');
    return { positions: asArray(response.data.positions), members: asArray(response.data.members) };
  },
  async forward(id: string, data: { positionIds: string[]; memberIds: string[] }): Promise<ReviewSuggestionDetail> {
    const response = await api.post<ReviewSuggestionDetail>(`/suggestions/review/${id}/forwards`, data);
    return response.data;
  },
  async withdrawForward(id: string, forwardId: string): Promise<ReviewSuggestionDetail> {
    const response = await api.delete<ReviewSuggestionDetail>(`/suggestions/review/${id}/forwards/${forwardId}`);
    return response.data;
  },
  async getReviewAttachment(id: string, attachmentId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/suggestions/review/${id}/attachments/${attachmentId}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // Box administration (suggestions.manage)
  async listAdminBoxes(): Promise<SuggestionBoxAdmin[]> {
    const response = await api.get<SuggestionBoxAdmin[]>('/suggestions/admin/boxes');
    return asArray(response.data);
  },
  async getReviewerOptions(): Promise<ReviewerOptions> {
    const response = await api.get<ReviewerOptions>('/suggestions/admin/reviewer-options');
    return { positions: asArray(response.data.positions), members: asArray(response.data.members) };
  },
  async createBox(data: SuggestionBoxWrite): Promise<SuggestionBoxAdmin> {
    const response = await api.post<SuggestionBoxAdmin>('/suggestions/admin/boxes', data);
    return response.data;
  },
  async updateBox(id: string, data: SuggestionBoxWrite): Promise<SuggestionBoxAdmin> {
    const response = await api.put<SuggestionBoxAdmin>(`/suggestions/admin/boxes/${id}`, data);
    return response.data;
  },
  /** A box holding submissions needs `confirmName` equal to its name. */
  async deleteBox(id: string, confirmName?: string): Promise<void> {
    await api.delete(`/suggestions/admin/boxes/${id}`, {
      params: { confirm_name: confirmName || undefined },
    });
  },
};
