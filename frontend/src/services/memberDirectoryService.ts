/**
 * The member directory (USR-8).
 *
 * `GET /users/directory` is the roster a member without `members.manage` is
 * served: only what the Members page's directory view shows. Usernames, hire
 * dates, stations and platoons are not in the response, so what that view
 * hides does not reach the browser either. `userService.getUsers()` remains the
 * full roster record for coordinators and for every other screen that reads it.
 */

import api from './apiClient';
import { asArray } from '../utils/asArray';
import type { UserStatus } from '../constants/enums';

export interface MemberDirectoryEntry {
  id: string;
  first_name?: string | undefined;
  middle_name?: string | undefined;
  last_name?: string | undefined;
  preferred_name?: string | null | undefined;
  full_name?: string | undefined;
  display_name?: string | undefined;
  membership_number?: string | undefined;
  photo_url?: string | undefined;
  status: UserStatus;
  rank?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  mobile?: string | undefined;
}

export const memberDirectoryService = {
  async getDirectory(): Promise<MemberDirectoryEntry[]> {
    const response = await api.get<MemberDirectoryEntry[]>('/users/directory');
    return asArray(response.data);
  },
};
