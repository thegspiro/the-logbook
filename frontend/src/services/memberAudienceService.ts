/**
 * What the "email the members" picker offers, and how many members a choice
 * reaches. Neither response names a member, so nothing here needs to be kept
 * out of the API cache — but the count must be fresh, so it is a POST.
 */

import api from './apiClient';
import type { MemberAudienceChoice, MemberAudienceOptions, MemberAudiencePreview } from '../types/memberAudience';

export const memberAudienceService = {
  async getOptions(): Promise<MemberAudienceOptions> {
    const response = await api.get<MemberAudienceOptions>('/member-audience/options');
    return response.data;
  },

  async preview(choice: MemberAudienceChoice, signal?: AbortSignal): Promise<MemberAudiencePreview> {
    const response = await api.post<MemberAudiencePreview>(
      '/member-audience/preview',
      choice,
      signal ? { signal } : {}
    );
    return response.data;
  },
};
