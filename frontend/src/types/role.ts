/**
 * Role and Permission type definitions
 */

import type { NotificationPreferences, ProfileVisibility } from './user';
import type { PositionKind, UserStatus } from '../constants/enums';

export interface Role {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  is_system: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
  /** How many members hold the position; sent by `GET /roles` (`include_user_count`, default on). */
  user_count?: number | undefined;
  /**
   * True for the seeded position that duplicates an operational rank (Chief,
   * Captain, Firefighter, ...). The server sends it on every role response;
   * it is optional here only so a fixture built by hand stays valid. Member
   * pickers and roster chips leave these out — see `utils/positions.ts`.
   */
  mirrors_rank?: boolean | undefined;
  /**
   * office | committee | system. An office is a permission-bearing job; a
   * committee is a group a member serves on, shown apart from the offices;
   * system is the platform's own (member, the owner, the rank mirrors).
   * Optional only so a fixture built by hand stays valid; the server always
   * sends it.
   */
  kind?: PositionKind | undefined;
}

export interface Permission {
  name: string;
  description: string;
  category: string;
}

export interface PermissionCategory {
  category: string;
  permissions: Permission[];
}

/** One closed term in a position, from `member_position_terms`. */
export interface PastPosition {
  /** Null once the position itself has been deleted; `name` is then the name it had. */
  position_id: string | null;
  name: string;
  kind: string | null;
  started_at: string;
  ended_at: string;
}

export interface UserWithRoles {
  id: string;
  organization_id: string;
  username: string;
  email?: string | undefined;
  first_name?: string | undefined;
  middle_name?: string | undefined;
  last_name?: string | undefined;
  preferred_name?: string | null | undefined;
  full_name?: string | undefined;
  display_name?: string | undefined;
  membership_number?: string | undefined;
  phone?: string | undefined;
  mobile?: string | undefined;
  personal_email?: string | undefined;
  photo_url?: string | undefined;
  status: UserStatus;
  mfa_enabled?: boolean | undefined;
  /** Has a registered passkey; sent to members.manage holders only. */
  has_passkey?: boolean | undefined;
  /** Set while a sign-in lockout is in force; sent to members.manage holders only. */
  locked_until?: string | null | undefined;
  membership_type?: string | undefined;
  /** The pair `membership_type` fuses: operational/administrative/social, and the ladder standing. */
  member_class?: string | null | undefined;
  member_status?: string | null | undefined;
  hire_date?: string | undefined;
  /**
   * "Member since": the date credited service runs from — the hire date for a
   * member who never left, later for one who came back after a break. Sent by
   * GET /users/{id}/with-roles only; the profile's write endpoints omit it, so
   * a page replacing its record with their response keeps the value it had.
   */
  service_since?: string | null | undefined;
  /**
   * Offices and committee seats held earlier, newest first. Sent by
   * GET /users/{id}/with-roles only, like `service_since`, and to everyone who
   * sees the current positions; the baseline Member position and the rank
   * mirrors are already left out by the server.
   */
  past_positions?: PastPosition[] | undefined;
  date_of_birth?: string | undefined;
  rank?: string | undefined;
  station?: string | undefined;
  platoon?: string | undefined;
  address_street?: string | undefined;
  address_city?: string | undefined;
  address_state?: string | undefined;
  address_zip?: string | undefined;
  address_country?: string | undefined;
  emergency_contacts?:
    | Array<{
        name: string;
        relationship: string;
        phone: string;
        email?: string | undefined;
        is_primary: boolean;
      }>
    | undefined;
  notification_preferences?: NotificationPreferences | undefined;
  /**
   * The member's own visibility choice, defaults applied. Present for the
   * member themselves and for members-managers; `null` for anyone else — what
   * a colleague chose to hide is itself private.
   */
  profile_visibility?: ProfileVisibility | null | undefined;
  roles: Role[];
}

export interface RoleWithUserCount extends Role {
  user_count: number;
}

export interface RoleUserItem {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  preferred_name?: string | null;
  /** Legal name (first + last). */
  full_name?: string;
  /** Preferred (else first) + last name. */
  display_name?: string;
  is_active: boolean;
}

export interface RoleUsersResponse {
  role_id: string;
  role_name: string;
  users: RoleUserItem[];
  total_count: number;
}

export interface RoleAssignment {
  role_ids: string[];
}

export interface UserRoleResponse {
  user_id: string;
  username: string;
  full_name?: string;
  roles: Role[];
}
