/**
 * userServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { Permission, PermissionCategory, Role, UserRoleResponse, UserWithRoles } from '../types/role';
import type { AuthSettings, ContactInfoSettings, ContactInfoUpdate, EmailServiceSettings, FileStorageSettings, User, UserProfileUpdate } from '../types/user';

export const userService = {
  /**
   * Get all users/members in the organization
   */
  async getUsers(): Promise<User[]> {
    const response = await api.get<User[]>('/users');
    return response.data;
  },

  /**
   * Check if contact information is enabled
   */
  async checkContactInfoEnabled(): Promise<ContactInfoSettings> {
    const response = await api.get<ContactInfoSettings>('/users/contact-info-enabled');
    return response.data;
  },

  /**
   * Get all users with their assigned roles
   */
  async getUsersWithRoles(): Promise<UserWithRoles[]> {
    const response = await api.get<UserWithRoles[]>('/users/with-roles');
    return response.data;
  },

  /**
   * Get a specific user with their assigned roles
   */
  async getUserWithRoles(userId: string): Promise<UserWithRoles> {
    const response = await api.get<UserWithRoles>(`/users/${userId}/with-roles`);
    return response.data;
  },

  /**
   * Get roles for a specific user
   */
  async getUserRoles(userId: string): Promise<UserRoleResponse> {
    const response = await api.get<UserRoleResponse>(`/users/${userId}/roles`);
    return response.data;
  },

  /**
   * Assign roles to a user (replaces existing roles)
   */
  async assignUserRoles(userId: string, roleIds: string[]): Promise<UserRoleResponse> {
    const response = await api.put<UserRoleResponse>(`/users/${userId}/roles`, {
      role_ids: roleIds,
    });
    return response.data;
  },

  /**
   * Add a single role to a user
   */
  async addRoleToUser(userId: string, roleId: string): Promise<UserRoleResponse> {
    const response = await api.post<UserRoleResponse>(`/users/${userId}/roles/${roleId}`);
    return response.data;
  },

  /**
   * Remove a role from a user
   */
  async removeRoleFromUser(userId: string, roleId: string): Promise<UserRoleResponse> {
    const response = await api.delete<UserRoleResponse>(`/users/${userId}/roles/${roleId}`);
    return response.data;
  },

  /**
   * Update user contact information and notification preferences
   */
  async updateContactInfo(userId: string, contactInfo: ContactInfoUpdate): Promise<UserWithRoles> {
    const response = await api.patch<UserWithRoles>(`/users/${userId}/contact-info`, contactInfo);
    return response.data;
  },

  /**
   * Update user profile (name, address, emergency contacts, etc.)
   */
  async updateUserProfile(userId: string, profileData: UserProfileUpdate): Promise<UserWithRoles> {
    const response = await api.patch<UserWithRoles>(`/users/${userId}/profile`, profileData);
    return response.data;
  },

  /**
   * Delete (soft-delete) a member
   */
  async deleteUser(userId: string): Promise<void> {
    await api.delete(`/users/${userId}`);
  },

  /**
   * Create a new member (admin/secretary only)
   */
  async createMember(memberData: {
    username: string;
    email: string;
    first_name: string;
    middle_name?: string | undefined;
    last_name: string;
    membership_number?: string | undefined;
    phone?: string | undefined;
    mobile?: string | undefined;
    date_of_birth?: string | undefined;
    hire_date?: string | undefined;
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
    password?: string | undefined;
    role_ids?: string[] | undefined;
    send_welcome_email?: boolean | undefined;
  }): Promise<UserWithRoles> {
    const response = await api.post<UserWithRoles>('/users', memberData);
    return response.data;
  },

  /**
   * Reset a user's password (admin only)
   */
  async adminResetPassword(userId: string, newPassword: string, forceChange: boolean = true): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/users/${userId}/reset-password`, {
      new_password: newPassword,
      force_change: forceChange,
    });
    return response.data;
  },

  /**
   * Get notification preferences for the current user
   */
  async getNotificationPreferences(userId: string): Promise<import('../types/user').NotificationPreferences> {
    const response = await api.get<{ notification_preferences: import('../types/user').NotificationPreferences }>(`/users/${userId}/with-roles`);
    return response.data.notification_preferences || {
      email: true,
      sms: false,
      push: false,
      email_notifications: true,
      event_reminders: true,
      training_reminders: true,
      announcement_notifications: true,
    };
  },

  /**
   * Update notification preferences for a user
   */
  async updateNotificationPreferences(userId: string, preferences: Partial<import('../types/user').NotificationPreferences>): Promise<void> {
    await api.patch(`/users/${userId}/contact-info`, {
      notification_preferences: preferences,
    });
  },

  /**
   * Get deletion impact assessment for a member
   */
  async getDeletionImpact(userId: string): Promise<import('../types/user').DeletionImpact> {
    const response = await api.get<import('../types/user').DeletionImpact>(`/users/${userId}/deletion-impact`);
    return response.data;
  },

  /**
   * Delete a user (soft or hard delete)
   */
  async deleteUserWithMode(userId: string, hard: boolean = false): Promise<void> {
    await api.delete(`/users/${userId}`, { params: { hard } });
  },

  /**
   * Upload a profile photo for a member
   */
  async uploadPhoto(userId: string, file: File): Promise<{ message: string; photo_url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<{ message: string; photo_url: string }>(`/users/${userId}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Remove a member's profile photo
   */
  async deletePhoto(userId: string): Promise<void> {
    await api.delete(`/users/${userId}/photo`);
  },

  /**
   * Change a member's membership type
   */
  async changeMembershipType(userId: string, membershipType: string, reason?: string): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/users/${userId}/membership-type`, {
      membership_type: membershipType,
      reason,
    });
    return response.data;
  },

  /**
   * Get audit history for a member
   */
  async getMemberAuditHistory(userId: string, page: number = 1, eventType?: string): Promise<import('../types/user').MemberAuditLogEntry[]> {
    const response = await api.get<import('../types/user').MemberAuditLogEntry[]>(`/users/${userId}/audit-history`, {
      params: { page, page_size: 50, event_type: eventType ?? undefined },
    });
    return response.data;
  },
};

export interface ModuleSettingsData {
  training: boolean;
  inventory: boolean;
  scheduling: boolean;
  apparatus: boolean;
  communications: boolean;
  elections: boolean;
  minutes: boolean;
  reports: boolean;
  notifications: boolean;
  mobile: boolean;
  forms: boolean;
  integrations: boolean;
  facilities: boolean;
  incidents: boolean;
  hr_payroll: boolean;
  grants: boolean;
  prospective_members: boolean;
  public_info: boolean;
}

export interface OrganizationProfile {
  name: string;
  timezone: string;
  phone: string;
  email: string;
  website: string;
  county: string;
  founded_year: number | null;
  logo: string | null;
  mailing_address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  physical_address_same: boolean;
  physical_address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
}

export interface EnabledModulesResponse {
  enabled_modules: string[];
  module_settings: ModuleSettingsData;
}

export const organizationService = {
  /**
   * Get organization settings
   */
  async getSettings(): Promise<{
    contact_info_visibility: ContactInfoSettings;
    email_service?: EmailServiceSettings;
    file_storage?: FileStorageSettings;
    auth?: AuthSettings;
    membership_id?: import('../types/user').MembershipIdSettings;
  }> {
    const response = await api.get<{
      contact_info_visibility: ContactInfoSettings;
      email_service?: EmailServiceSettings;
      file_storage?: FileStorageSettings;
      auth?: AuthSettings;
      membership_id?: import('../types/user').MembershipIdSettings;
    }>('/organization/settings');
    return response.data;
  },

  /**
   * Update contact information settings (secretary only)
   */
  async updateContactInfoSettings(settings: ContactInfoSettings): Promise<ContactInfoSettings> {
    const response = await api.patch<ContactInfoSettings>('/organization/settings/contact-info', settings);
    return response.data;
  },

  /**
   * Update email service settings
   */
  async updateEmailSettings(settings: EmailServiceSettings): Promise<EmailServiceSettings> {
    const response = await api.patch<EmailServiceSettings>('/organization/settings/email', settings);
    return response.data;
  },

  /**
   * Update file storage settings
   */
  async updateFileStorageSettings(settings: FileStorageSettings): Promise<FileStorageSettings> {
    const response = await api.patch<FileStorageSettings>('/organization/settings/file-storage', settings);
    return response.data;
  },

  /**
   * Update authentication settings
   */
  async updateAuthSettings(settings: AuthSettings): Promise<AuthSettings> {
    const response = await api.patch<AuthSettings>('/organization/settings/auth', settings);
    return response.data;
  },

  /**
   * Update membership ID settings
   */
  async updateMembershipIdSettings(settings: import('../types/user').MembershipIdSettings): Promise<import('../types/user').MembershipIdSettings> {
    const response = await api.patch<import('../types/user').MembershipIdSettings>('/organization/settings/membership-id', settings);
    return response.data;
  },

  /**
   * Get enabled modules for the organization
   */
  async getEnabledModules(): Promise<EnabledModulesResponse> {
    const response = await api.get<EnabledModulesResponse>('/organization/modules');
    return response.data;
  },

  /**
   * Update module settings (enable/disable modules)
   */
  async updateModuleSettings(updates: Partial<ModuleSettingsData>): Promise<EnabledModulesResponse> {
    const response = await api.patch<EnabledModulesResponse>('/organization/modules', updates);
    return response.data;
  },

  /**
   * Check if a specific module is enabled
   */
  async isModuleEnabled(moduleId: string): Promise<boolean> {
    const response = await this.getEnabledModules();
    return response.enabled_modules.includes(moduleId);
  },

  async previewNextMembershipId(): Promise<{ enabled: boolean; next_id?: string }> {
    const response = await api.get<{ enabled: boolean; next_id?: string }>('/organization/settings/membership-id/preview');
    return response.data;
  },

  async getSetupChecklist(): Promise<SetupChecklistResponse> {
    const response = await api.get<SetupChecklistResponse>('/organization/setup-checklist');
    return response.data;
  },

  async updateSettings(updates: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>('/organization/settings', updates);
    return response.data;
  },

  async getAddress(): Promise<{ address: string; city: string; state: string; zip: string }> {
    const response = await api.get<{ address: string; city: string; state: string; zip: string }>('/organization/address');
    return response.data;
  },

  async getProfile(): Promise<OrganizationProfile> {
    const response = await api.get<OrganizationProfile>('/organization/profile');
    return response.data;
  },

  async updateProfile(updates: Partial<OrganizationProfile>): Promise<OrganizationProfile> {
    const response = await api.patch<OrganizationProfile>('/organization/profile', updates);
    return response.data;
  },
};

export interface SetupChecklistItem {
  key: string;
  title: string;
  description: string;
  path: string;
  category: string;
  is_complete: boolean;
  count: number;
  required: boolean;
}

export interface SetupChecklistResponse {
  items: SetupChecklistItem[];
  completed_count: number;
  total_count: number;
  enabled_modules: string[];
}

export const roleService = {
  /**
   * Get all available permissions
   */
  async getPermissions(): Promise<Permission[]> {
    const response = await api.get<Permission[]>('/roles/permissions');
    return response.data;
  },

  /**
   * Get permissions grouped by category
   */
  async getPermissionsByCategory(): Promise<PermissionCategory[]> {
    const response = await api.get<PermissionCategory[]>('/roles/permissions/by-category');
    return response.data;
  },

  /**
   * Get all roles
   */
  async getRoles(): Promise<Role[]> {
    const response = await api.get<Role[]>('/roles');
    return response.data;
  },

  /**
   * Get a specific role by ID
   */
  async getRole(roleId: string): Promise<Role> {
    const response = await api.get<Role>(`/roles/${roleId}`);
    return response.data;
  },

  /**
   * Create a new custom role
   */
  async createRole(roleData: {
    name: string;
    slug: string;
    description?: string;
    permissions: string[];
    priority?: number;
  }): Promise<Role> {
    const response = await api.post<Role>('/roles', roleData);
    return response.data;
  },

  /**
   * Update a role
   */
  async updateRole(
    roleId: string,
    updates: {
      name?: string | undefined;
      description?: string | undefined;
      permissions?: string[];
      priority?: number | undefined;
    }
  ): Promise<Role> {
    const response = await api.patch<Role>(`/roles/${roleId}`, updates);
    return response.data;
  },

  /**
   * Delete a custom role
   */
  async deleteRole(roleId: string): Promise<void> {
    await api.delete(`/roles/${roleId}`);
  },

  /**
   * Clone an existing role
   */
  async cloneRole(roleId: string): Promise<Role> {
    const response = await api.post<Role>(`/roles/${roleId}/clone`);
    return response.data;
  },

  async getUserPermissions(userId: string): Promise<{ user_id: string; permissions: string[]; roles: string[] }> {
    const response = await api.get<{ user_id: string; permissions: string[]; roles: string[] }>(`/users/${userId}/permissions`);
    return response.data;
  },

  async getMyRoles(): Promise<Role[]> {
    const response = await api.get<Role[]>('/roles/my/roles');
    return response.data;
  },

  async getMyPermissions(): Promise<{ user_id: string; permissions: string[]; roles: string[] }> {
    const response = await api.get<{ user_id: string; permissions: string[]; roles: string[] }>('/roles/my/permissions');
    return response.data;
  },

  async checkAdminAccess(): Promise<{ has_access: boolean; admin_roles: string[]; user_roles: string[]; admin_permissions: string[] }> {
    const response = await api.get<{ has_access: boolean; admin_roles: string[]; user_roles: string[]; admin_permissions: string[] }>('/roles/admin-access/check');
    return response.data;
  },
};
