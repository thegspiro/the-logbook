/**
 * Skill evaluation definitions — `/training/skill-evaluations`.
 *
 * Its own module rather than another entry in the `services/api` barrel: only
 * the Setup tab uses it, and keeping it out of the barrel keeps the barrel's
 * importers (nearly every screen) from depending on it.
 */

import api from './apiClient';
import { asArray } from '../utils/asArray';
import type { SkillEvaluation, SkillEvaluationCreate, SkillEvaluationUpdate } from '../types/skillEvaluation';

export const skillEvaluationService = {
  async list(includeInactive = false): Promise<SkillEvaluation[]> {
    const response = await api.get<SkillEvaluation[]>('/training/skill-evaluations', {
      params: { include_inactive: includeInactive },
    });
    return asArray(response.data);
  },

  async create(data: SkillEvaluationCreate): Promise<SkillEvaluation> {
    const response = await api.post<SkillEvaluation>('/training/skill-evaluations', data);
    return response.data;
  },

  async update(id: string, data: SkillEvaluationUpdate): Promise<SkillEvaluation> {
    const response = await api.patch<SkillEvaluation>(`/training/skill-evaluations/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/training/skill-evaluations/${id}`);
  },
};
