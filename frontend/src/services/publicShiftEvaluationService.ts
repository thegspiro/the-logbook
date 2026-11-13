/**
 * The preceptor's side of a preceptor link: the evaluation an outside
 * agency's preceptor opens from a QR code or email, with no sign-in.
 * Unauthenticated: the token is the credential, so these use bare axios
 * rather than the signed-in client, as the applicant follow-up form does.
 */
import axios from 'axios';

import type { PublicShiftEvaluationView, ShiftEvaluationSaveBody } from '../types/training';

const path = (token: string) => `/api/public/v1/shift-evaluations/${encodeURIComponent(token)}`;

export const publicShiftEvaluationService = {
  async get(token: string): Promise<PublicShiftEvaluationView> {
    const response = await axios.get<PublicShiftEvaluationView>(path(token));
    return response.data;
  },

  async submit(token: string, body: ShiftEvaluationSaveBody): Promise<{ submitted_at: string }> {
    const response = await axios.post<{ submitted_at: string }>(`${path(token)}/submit`, body);
    return response.data;
  },
};
