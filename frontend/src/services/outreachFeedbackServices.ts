/**
 * Outreach feedback calls: the requester's survey on the status page, the
 * officer's view of an answer, and the Events settings picker.
 *
 * Kept out of eventServices.ts on purpose. That file is re-exported by the
 * services/api barrel, which the entry chunk imports, so anything added there
 * is downloaded on every first visit. Only lazily loaded pages use these, so
 * importing this module directly keeps them in those pages' chunks and inside
 * the first-load budget in scripts/check-initial-bundle.mjs.
 */
import api from './apiClient';
import { asArray } from '../utils/asArray';
import type { EventRequestFeedback, FeedbackFormOption, PublicFeedbackForm } from '../types/event';

export interface StarterFeedbackForm {
  form_id: string;
  form_name: string;
  rating_field_id: string | null;
}

export interface FeedbackSent {
  submitted_at: string;
  message: string;
}

export const outreachFeedbackService = {
  /** The department's feedback form, as the requester behind this status link sees it. */
  async getPublicFeedbackForm(token: string): Promise<PublicFeedbackForm> {
    const response = await api.get<PublicFeedbackForm>(`/event-requests/status/${token}/feedback`);
    return response.data;
  },
  /** Send the requester's answers; one response per request, final once sent. */
  async sendPublicFeedback(token: string, data: Record<string, string>): Promise<FeedbackSent> {
    const response = await api.post<FeedbackSent>(`/event-requests/status/${token}/feedback`, { data });
    return response.data;
  },
  /** The feedback left on one request, or null when none was sent (events.manage). */
  async getRequestFeedback(requestId: string): Promise<EventRequestFeedback | null> {
    const response = await api.get<EventRequestFeedback | null>(`/event-requests/${requestId}/feedback`);
    return response.data;
  },
  /** Published forms that can be the outreach feedback form (events.manage). */
  async getFeedbackFormOptions(): Promise<FeedbackFormOption[]> {
    const response = await api.get<FeedbackFormOption[]>('/events/settings/feedback-forms');
    return asArray(response.data);
  },
  /** Create the starter feedback form and make it the department's; repeats return the same form. */
  async createStarterFeedbackForm(): Promise<StarterFeedbackForm> {
    const response = await api.post<StarterFeedbackForm>('/events/settings/feedback-forms/starter');
    return response.data;
  },
};
