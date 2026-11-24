/**
 * Yearly outreach goals (events.manage).
 *
 * Imported directly rather than through the `services/api` barrel: only the
 * lazily loaded outreach screens use it, and the barrel is part of every
 * page's first load (scripts/check-initial-bundle.mjs).
 */

import api from './apiClient';

export type OutreachMetric = 'events_held' | 'people_reached' | 'member_hours';

export interface OutreachGoalProgress {
  id: string;
  year: number;
  kind: 'crr_measure' | 'outreach';
  measure_id: string | null;
  outreach_metric: OutreachMetric | null;
  /** "Events held", or "Smoke alarm install · Alarms installed". */
  label: string;
  target: number;
  actual: number;
  /** Where the goal should be by now if the year's work were spread evenly. */
  pace_target: number;
  met: boolean;
  on_pace: boolean;
}

/** A year's goals as Outreach Impact carries them. */
export interface OutreachGoalYear {
  year: number;
  /** How much of the year has gone, 0 to 1. */
  year_fraction: number;
  year_complete: boolean;
  goals: OutreachGoalProgress[];
}

export interface OutreachGoalsResponse extends OutreachGoalYear {
  current_year: number;
  metrics: { value: OutreachMetric; label: string }[];
}

export interface OutreachGoalCreate {
  year: number;
  target: number;
  measure_id?: string | undefined;
  outreach_metric?: OutreachMetric | undefined;
}

export const outreachGoalService = {
  /** A year's goals with their progress; the department's current year when omitted. */
  async list(year?: number): Promise<OutreachGoalsResponse> {
    const response = await api.get<OutreachGoalsResponse>('/outreach-goals', {
      params: year === undefined ? {} : { year },
    });
    return response.data;
  },
  async create(body: OutreachGoalCreate): Promise<OutreachGoalsResponse> {
    const response = await api.post<OutreachGoalsResponse>('/outreach-goals', body);
    return response.data;
  },
  async updateTarget(goalId: string, target: number): Promise<OutreachGoalsResponse> {
    const response = await api.patch<OutreachGoalsResponse>(`/outreach-goals/${goalId}`, { target });
    return response.data;
  },
  async remove(goalId: string): Promise<void> {
    await api.delete(`/outreach-goals/${goalId}`);
  },
};
