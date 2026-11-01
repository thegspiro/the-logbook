/**
 * Member Evaluations API Service — templates and review periods.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { asArray } from '../../../utils/asArray';
import type {
  BuilderOptions,
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
