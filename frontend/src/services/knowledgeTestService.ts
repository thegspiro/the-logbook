/**
 * Online knowledge tests — `/training/knowledge-tests`.
 *
 * Its own module rather than another entry in the `services/api` barrel, which
 * nearly every screen imports; only the knowledge-test screens use it.
 */

import api from './apiClient';
import { asArray } from '../utils/asArray';
import type {
  KnowledgeAttempt,
  KnowledgeAttemptSummary,
  KnowledgeQuestionWrite,
  KnowledgeTest,
  KnowledgeTestCreate,
  KnowledgeTestDetail,
  KnowledgeTestStatus,
  KnowledgeTestUpdate,
} from '../types/knowledgeTest';

export const knowledgeTestService = {
  async list(status?: KnowledgeTestStatus): Promise<KnowledgeTest[]> {
    const response = await api.get<KnowledgeTest[]>('/training/knowledge-tests', {
      params: status ? { status } : undefined,
    });
    return asArray(response.data);
  },

  /** Officers receive the question bank (`KnowledgeTestDetail`); members do not. */
  async get(testId: string): Promise<KnowledgeTest | KnowledgeTestDetail> {
    const response = await api.get<KnowledgeTest | KnowledgeTestDetail>(`/training/knowledge-tests/${testId}`);
    return response.data;
  },

  async create(data: KnowledgeTestCreate): Promise<KnowledgeTestDetail> {
    const response = await api.post<KnowledgeTestDetail>('/training/knowledge-tests', data);
    return response.data;
  },

  async update(testId: string, data: KnowledgeTestUpdate): Promise<KnowledgeTestDetail> {
    const response = await api.patch<KnowledgeTestDetail>(`/training/knowledge-tests/${testId}`, data);
    return response.data;
  },

  async remove(testId: string): Promise<void> {
    await api.delete(`/training/knowledge-tests/${testId}`);
  },

  async addQuestion(testId: string, data: KnowledgeQuestionWrite): Promise<KnowledgeTestDetail> {
    const response = await api.post<KnowledgeTestDetail>(`/training/knowledge-tests/${testId}/questions`, data);
    return response.data;
  },

  async replaceQuestion(
    testId: string,
    questionId: string,
    data: KnowledgeQuestionWrite
  ): Promise<KnowledgeTestDetail> {
    const response = await api.put<KnowledgeTestDetail>(
      `/training/knowledge-tests/${testId}/questions/${questionId}`,
      data
    );
    return response.data;
  },

  async deleteQuestion(testId: string, questionId: string): Promise<KnowledgeTestDetail> {
    const response = await api.delete<KnowledgeTestDetail>(
      `/training/knowledge-tests/${testId}/questions/${questionId}`
    );
    return response.data;
  },

  async listAttempts(testId: string): Promise<KnowledgeAttemptSummary[]> {
    const response = await api.get<KnowledgeAttemptSummary[]>(`/training/knowledge-tests/${testId}/attempts`);
    return asArray(response.data);
  },

  /** Start, or resume the open one. */
  async startAttempt(testId: string): Promise<KnowledgeAttempt> {
    const response = await api.post<KnowledgeAttempt>(`/training/knowledge-tests/${testId}/attempts`);
    return response.data;
  },

  async getAttempt(attemptId: string): Promise<KnowledgeAttempt> {
    const response = await api.get<KnowledgeAttempt>(`/training/knowledge-tests/attempts/${attemptId}`);
    return response.data;
  },

  async saveAnswers(attemptId: string, answers: Record<string, string[]>): Promise<KnowledgeAttempt> {
    const response = await api.put<KnowledgeAttempt>(`/training/knowledge-tests/attempts/${attemptId}/answers`, {
      answers,
    });
    return response.data;
  },

  async submitAttempt(attemptId: string): Promise<KnowledgeAttempt> {
    const response = await api.post<KnowledgeAttempt>(`/training/knowledge-tests/attempts/${attemptId}/submit`);
    return response.data;
  },
};
