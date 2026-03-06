/**
 * Role and Permission type definitions
 */

import type { NotificationPreferences } from './user';
import type { UserStatus } from '../constants/enums';

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

export interface UserWithRoles {
  id: string;
  organization_id: string;
  username: string;
  email?: string | undefined;
  first_name?: string | undefined;
  middle_name?: string | undefined;
  last_name?: string | undefined;
  full_name?: string | undefined;
  membership_number?: string | undefined;
  phone?: string | undefined;
  mobile?: string | undefined;
  personal_email?: string | undefined;
  photo_url?: string | undefined;
  status: UserStatus;
  membership_type?: string | undefined;
  hire_date?: string | undefined;
  date_of_birth?: string | undefined;
  rank?: string | undefined;
  station?: string | undefined;
  address_street?: string | undefined;
  address_city?: string | undefined;
  address_state?: string | undefined;
  address_zip?: string | undefined;
  address_country?: string | undefined;
  emergency_contacts?: Array<{
    name: string;
    relationship: string;
    phone: string;
    email?: string | undefined;
    is_primary: boolean;
  }> | undefined;
  notification_preferences?: NotificationPreferences | undefined;
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
  full_name?: string;
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
