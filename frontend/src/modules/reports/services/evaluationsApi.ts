/**
 * Member Evaluations API Service — templates, review periods and evaluations.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { asArray } from '../../../utils/asArray';
import type {
  BuilderOptions,
  DraftOptions,
  EvaluationCreate,
  EvaluationDetail,
  EvaluationPartKind,
  EvaluationSummary,
  LiveData,
  PartContent,
  SubmitResult,
  EvaluationDataSource,
  EvaluationPeriod,
  EvaluationPeriodCreate,
  EvaluationPeriodUpdate,
  EvaluationTemplateCreate,
  EvaluationTemplateDetail,
  EvaluationTemplateSummary,
  EvaluationTemplateUpdate,
  PublishResult,
  TemplateDefinition,
  TemplateWorkflow,
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

  async draftOptions(): Promise<DraftOptions> {
    const response = await api.get<DraftOptions>('/evaluations/draft-options');
    return response.data;
  },

  async create(data: EvaluationCreate): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>('/evaluations', data);
    return response.data;
  },

  async mine(): Promise<EvaluationSummary[]> {
    const response = await api.get<EvaluationSummary[]>('/evaluations/mine');
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

  async completeCalibration(id: string): Promise<EvaluationDetail> {
    const response = await api.post<EvaluationDetail>(`/evaluations/${id}/calibration/complete`);
    return response.data;
  },
};
