/**
 * Member badge codes (/member-badges).
 *
 * A badge carries a random code the server issues; nothing in the directory
 * reveals it. Scanners send what they read to `resolve` and never match a
 * badge against a roster themselves — the server decides who a badge names,
 * and only within the caller's department.
 */

import api from './apiClient';
import { toAppError } from '../utils/errorHandling';

export interface MemberBadge {
  user_id: string;
  badge_code: string;
}

export interface ResolvedMember {
  user_id: string;
  name: string;
  membership_number: string | null;
  is_active: boolean;
  /** `legacy` when an old-style badge (membership number, short id) was scanned. */
  matched: 'badge_code' | 'legacy';
}

export interface MemberBadgeSettings {
  accept_legacy: boolean;
}

export const memberBadgeService = {
  async getBadge(userId: string): Promise<MemberBadge> {
    const res = await api.get<MemberBadge>(`/member-badges/${encodeURIComponent(userId)}`);
    return res.data;
  },

  async reissue(userId: string): Promise<MemberBadge> {
    const res = await api.post<MemberBadge>(`/member-badges/${encodeURIComponent(userId)}/reissue`);
    return res.data;
  },

  /** The member a scanned value names, or `null` when it names nobody. */
  async resolve(code: string): Promise<ResolvedMember | null> {
    try {
      const res = await api.post<ResolvedMember>('/member-badges/resolve', { code });
      return res.data;
    } catch (err: unknown) {
      if (toAppError(err).status === 404) return null;
      throw err;
    }
  },

  async getSettings(): Promise<MemberBadgeSettings> {
    const res = await api.get<MemberBadgeSettings>('/member-badges/settings');
    return res.data;
  },

  async saveSettings(settings: MemberBadgeSettings): Promise<MemberBadgeSettings> {
    const res = await api.put<MemberBadgeSettings>('/member-badges/settings', settings);
    return res.data;
  },
};
