/**
 * Member Evaluations API Service — templates, review periods and evaluations.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { asArray } from '../../../utils/asArray';
import type {
  AttentionCounts,
  BuilderOptions,
  BulkDraftItem,
  BulkDraftPreview,
  BulkDraftResponse,
  DraftOptions,
  EvaluationCreate,
  EvaluationDeletionRecord,
  EvaluationDetail,
  EvaluationPartKind,
  EvaluationSummary,
  EvaluationTemplateKind,
  Grades,
  LiveData,
  PartContent,
  PersonRef,
  SignatureWrite,
  SignResult,
  SubmitResult,
  EvaluationDataSource,
  EvaluationPeriod,
  EvaluationPeriodCreate,
  EvaluationPeriodUpdate,
  EvaluationStarter,
  EvaluationTemplateCreate,
  EvaluationTemplateDetail,
  EvaluationTemplateSummary,
  EvaluationTemplateUpdate,
  PreviewOptions,
  PublishResult,
  PreviewPart,
  TemplateDefinition,
  TemplatePreview,
  TemplateWorkflow,
  ReassignmentHolder,
  ReassignmentPlan,
  ReviewHistoryEntry,
  GradeSpread,
} from '../types/evaluations';

const api = createApiClient();

export const evaluationTemplatesService = {
  async list(): Promise<EvaluationTemplateSummary[]> {
    const response = await api.get<EvaluationTemplateSummary[]>('/evaluations/templates');
    return asArray(response.data);
  },

  async get(id: string): Promise<EvaluationTemplateDetail> {
    const response = await api.get<EvaluationTemplateDetail>(`/evaluations/templates/${id}`);
    return response.data;
  },

  async create(data: EvaluationTemplateCreate): Promise<EvaluationTemplateDetail> {
    const response = await api.post<EvaluationTemplateDetail>('/evaluations/templates', data);
    return response.data;
  },

  async update(id: string, data: EvaluationTemplateUpdate): Promise<EvaluationTemplateDetail> {
    const response = await api.patch<EvaluationTemplateDetail>(`/evaluations/templates/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/evaluations/templates/${id}`);
  },

  async saveDraft(
    id: string,
    definition: TemplateDefinition,
    workflow: TemplateWorkflow
  ): Promise<EvaluationTemplateDetail> {
    const response = await api.put<EvaluationTemplateDetail>(`/evaluations/templates/${id}/draft`, {
      definition,
      workflow,
    });
    return response.data;
  },

  async discardDraft(id: string): Promise<EvaluationTemplateDetail> {
    const response = await api.delete<EvaluationTemplateDetail>(`/evaluations/templates/${id}/draft`);
    return response.data;
  },

  async publish(id: string): Promise<PublishResult> {
    const response = await api.post<PublishResult>(`/evaluations/templates/${id}/publish`);
    return response.data;
  },

  async dataSources(): Promise<EvaluationDataSource[]> {
    const response = await api.get<EvaluationDataSource[]>('/evaluations/data-sources');
    return asArray(response.data);
  },

  async builderOptions(): Promise<BuilderOptions> {
    const response = await api.get<BuilderOptions>('/evaluations/builder-options');
    return response.data;
  },

  async starters(): Promise<EvaluationStarter[]> {
    const response = await api.get<EvaluationStarter[]>('/evaluations/templates/starters');
    return asArray(response.data);
  },

  async previewOptions(): Promise<PreviewOptions> {
    const response = await api.get<PreviewOptions>('/evaluations/templates/preview-options');
    return response.data;
  },

  /** The form as it stands in the builder, unsaved edits included. No member previews with sample figures. */
  async preview(definition: TemplateDefinition, memberId?: string, periodId?: string): Promise<TemplatePreview> {
    const response = await api.post<TemplatePreview>('/evaluations/templates/preview', {
      definition,
      member_id: memberId || undefined,
      period_id: periodId || undefined,
    });
    return response.data;
  },

  /**
   * The same form as a PDF laid out like a finalized evaluation, every answer
   * blank and every page marked a preview. Nothing is stored.
   */
  async previewPdf(request: {
    definition: TemplateDefinition;
    workflow: TemplateWorkflow;
    name: string;
    part: PreviewPart;
    memberId?: string;
    periodId?: string;
  }): Promise<Blob> {
    const response = await api.post<Blob>(
      '/evaluations/templates/preview-pdf',
      {
        definition: request.definition,
        workflow: request.workflow,
        name: request.name,
        part: request.part,
        member_id: request.memberId || undefined,
        period_id: request.periodId || undefined,
      },
      { responseType: 'blob' }
    );
    return response.data;
  },
};

export const evaluationPeriodsService = {
  async list(): Promise<EvaluationPeriod[]> {
    const response = await api.get<EvaluationPeriod[]>('/evaluations/periods');
    return asArray(response.data);
  },

  async create(data: EvaluationPeriodCreate): Promise<EvaluationPeriod> {
    const response = await api.post<EvaluationPeriod>('/evaluations/periods', data);
    return response.data;
  },

  async update(id: string, data: EvaluationPeriodUpdate): Promise<EvaluationPeriod> {
    const response = await api.patch<EvaluationPeriod>(`/evaluations/periods/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/evaluations/periods/${id}`);
  },
};

export const evaluationsService = {
  async list(
    params: { period_id?: string | undefined; status?: string | undefined } = {}
  ): Promise<EvaluationSummary[]> {
    const response = await api.get<EvaluationSummary[]>('/evaluations', { params });
    return asArray(response.data);
  },

  /** Each evaluator's finalized reviews in a period, counted by grade (evaluations.view_all). */
  async gradeSpread(periodId: string): Promise<GradeSpread> {
    const response = await api.get<GradeSpread>('/evaluations/grade-spread', { params: { period_id: periodId } });
    return { ...response.data, evaluators: asArray(response.data.evaluators) };
  },

  /** A zip of the signed PDF of every finalized evaluation in a period (evaluations.view_all, step-up). */
  async exportPeriodPdfs(periodId: string): Promise<Blob> {
    const response = await api.get<Blob>('/evaluations/export-pdfs', {
      responseType: 'blob',
      params: { period_id: periodId },
    });
    return response.data;
  },

  /** A review period's evaluations as CSV, with each finalized one's grade. */
  async exportPeriod(periodId: string): Promise<Blob> {
    const response = await api.get<Blob>('/evaluations/export', {
      responseType: 'blob',
      params: { period_id: periodId },
    });
    return response.data;
  },

  async draftOptions(): Promise<DraftOptions> {
    const response = await api.get<Partial<DraftOptions>>('/evaluations/draft-options');
    const body = response.data;
    return {
      members: asArray(body.members ?? []),
      evaluators: asArray(body.evaluators ?? []),
      periods: asArray(body.periods ?? []),
      templates: asArray(body.templates ?? []),
    };
  },

  async create(data: EvaluationCreate): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>('/evaluations', data);
    return response.data;
  },

  async attention(): Promise<AttentionCounts> {
    const response = await api.get<AttentionCounts>('/evaluations/attention');
    return response.data;
  },

  async mine(): Promise<EvaluationSummary[]> {
    const response = await api.get<EvaluationSummary[]>('/evaluations/mine');
    return asArray(response.data);
  },

  /**
   * Section and overall grades for a form and a set of ratings, from the
   * server's calculation, so a screen never works grades out for itself.
   * Null for a form that is not graded by section.
   */
  async grades(definition: TemplateDefinition, content: PartContent): Promise<Grades | null> {
    const response = await api.post<Grades | null>('/evaluations/grades', { definition, content });
    return response.data ?? null;
  },

  /** Evaluations of the members the caller supervises today; empty for anyone with no crew. */
  async crew(): Promise<EvaluationSummary[]> {
    const response = await api.get<EvaluationSummary[]>('/evaluations/crew');
    return asArray(response.data);
  },

  async liveData(): Promise<LiveData> {
    const response = await api.get<Partial<LiveData>>('/evaluations/mine/live-data');
    const body = response.data;
    return {
      period_id: body.period_id ?? null,
      period_name: body.period_name ?? null,
      coverage_start: body.coverage_start ?? null,
      coverage_end: body.coverage_end ?? null,
      excluded_ranges: asArray(body.excluded_ranges ?? []),
      sources: asArray(body.sources ?? []),
      data: body.data ?? {},
      note: body.note ?? null,
    };
  },

  async get(id: string): Promise<EvaluationDetail> {
    const response = await api.get<EvaluationDetail>(`/evaluations/${id}`);
    return response.data;
  },

  /** The member's other finalized reviews, newest first (evaluations.view_all). */
  async history(id: string): Promise<ReviewHistoryEntry[]> {
    const response = await api.get<ReviewHistoryEntry[]>(`/evaluations/${id}/history`);
    return asArray(response.data);
  },

  async savePart(id: string, kind: EvaluationPartKind, content: PartContent): Promise<EvaluationDetail> {
    const response = await api.put<EvaluationDetail>(`/evaluations/${id}/parts/${kind}`, { content });
    return response.data;
  },

  async submitPart(id: string, kind: EvaluationPartKind): Promise<SubmitResult> {
    const response = await api.post<SubmitResult>(`/evaluations/${id}/parts/${kind}/submit`);
    return response.data;
  },

  async refreshData(id: string): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>(`/evaluations/${id}/refresh-data`);
    return response.data;
  },

  /** Sign the step open to the caller. The server asks for step-up
   * re-verification first; the shared client shows that prompt and retries. */
  async sign(id: string, signature: SignatureWrite): Promise<SignResult> {
    const response = await api.post<SignResult>(`/evaluations/${id}/sign`, signature);
    return response.data;
  },

  /** The frozen PDF: `latest` carries the member's response once submitted;
   * `signed` is always the PDF as it was signed. */
  async document(id: string, version: 'latest' | 'signed' = 'latest'): Promise<Blob> {
    const response = await api.get<Blob>(`/evaluations/${id}/document`, {
      responseType: 'blob',
      params: { version },
    });
    return response.data;
  },

  async saveResponse(id: string, text: string): Promise<EvaluationDetail> {
    const response = await api.put<EvaluationDetail>(`/evaluations/${id}/response`, { text });
    return response.data;
  },

  async submitResponse(id: string): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>(`/evaluations/${id}/response/submit`);
    return response.data;
  },

  /** Complete calibration, flagging the evaluator's items to revisit (ticks
   * only, never a note). */
  async completeCalibration(id: string, flaggedItems: string[] = []): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>(`/evaluations/${id}/calibration/complete`, {
      flagged_items: flaggedItems,
    });
    return response.data;
  },

  /** The current members who may be named on an approval or calibration step. */
  async listStepAssigneeCandidates(id: string, stepKey: string): Promise<PersonRef[]> {
    const response = await api.get<{ candidates?: PersonRef[] }>(
      `/evaluations/${id}/steps/${encodeURIComponent(stepKey)}/assignee-candidates`
    );
    return asArray(response.data.candidates ?? []);
  },

  /** Name who acts on an approval or calibration step, or pass null to hand it
   * back to the workflow's actor. */
  async assignStep(id: string, stepKey: string, assigneeId: string | null): Promise<EvaluationDetail> {
    const response = await api.put<EvaluationDetail>(
      `/evaluations/${id}/steps/${encodeURIComponent(stepKey)}/assignee`,
      { assignee_id: assigneeId }
    );
    return response.data;
  },

  /** Who holds open work in a review period that a reassignment moves. */
  async reassignmentHolders(periodId: string): Promise<ReassignmentHolder[]> {
    const response = await api.get<ReassignmentHolder[]>(
      `/evaluations/periods/${encodeURIComponent(periodId)}/reassign-options`
    );
    return asArray(response.data);
  },

  /** What handing one person's open work to another would move and skip. Changes nothing. */
  async reassignmentPreview(periodId: string, fromUserId: string, toUserId: string): Promise<ReassignmentPlan> {
    const response = await api.get<ReassignmentPlan>(
      `/evaluations/periods/${encodeURIComponent(periodId)}/reassign-preview`,
      { params: { from_user_id: fromUserId, to_user_id: toUserId } }
    );
    return { ...response.data, rows: asArray(response.data.rows) };
  },

  /** Hand one person's open work in a review period to another. */
  async reassign(periodId: string, fromUserId: string, toUserId: string): Promise<ReassignmentPlan> {
    const response = await api.post<ReassignmentPlan>(`/evaluations/periods/${encodeURIComponent(periodId)}/reassign`, {
      from_user_id: fromUserId,
      to_user_id: toUserId,
    });
    return { ...response.data, rows: asArray(response.data.rows) };
  },

  async bulkPreview(periodId: string, kind: EvaluationTemplateKind): Promise<BulkDraftPreview> {
    const response = await api.get<Partial<BulkDraftPreview>>('/evaluations/bulk-preview', {
      params: { period_id: periodId, kind },
    });
    const body = response.data;
    // A missing list would read as "nobody to draft", which is a claim about
    // the department; refuse it rather than show it.
    if (!body.period || !Array.isArray(body.rows)) {
      throw new Error('The drafting preview came back incomplete. Try again.');
    }
    return {
      period: body.period,
      kind: body.kind ?? kind,
      rows: body.rows,
      evaluators: asArray(body.evaluators ?? []),
    };
  },

  async bulkDraft(periodId: string, kind: EvaluationTemplateKind, items: BulkDraftItem[]): Promise<BulkDraftResponse> {
    const response = await api.post<Partial<BulkDraftResponse>>('/evaluations/bulk', {
      period_id: periodId,
      kind,
      items,
    });
    return { drafted: response.data.drafted ?? 0, results: asArray(response.data.results ?? []) };
  },

  /** Reopen a finalized evaluation as a new revision, with the reason. */
  async amend(id: string, reason: string): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>(`/evaluations/${id}/amend`, { reason });
    return response.data;
  },

  /** Delete an evaluation with a reason. The server asks for step-up
   * re-verification first; the shared client shows that prompt and retries. */
  async remove(id: string, reason: string): Promise<EvaluationDeletionRecord> {
    const response = await api.post<EvaluationDeletionRecord>(`/evaluations/${id}/delete`, { reason });
    return response.data;
  },

  async removed(memberId?: string): Promise<EvaluationDeletionRecord[]> {
    const response = await api.get<EvaluationDeletionRecord[]>('/evaluations/removed', {
      params: memberId ? { member_id: memberId } : {},
    });
    return asArray(response.data);
  },

  async myRemoved(): Promise<EvaluationDeletionRecord[]> {
    const response = await api.get<EvaluationDeletionRecord[]>('/evaluations/mine/removed');
    return asArray(response.data);
  },
};
