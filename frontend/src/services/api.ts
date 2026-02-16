/**
 * API Service
 *
 * Handles all API calls to the backend.
 */

import axios from 'axios';
import type { User, ContactInfoSettings, ContactInfoUpdate } from '../types/user';
import type {
  Role,
  Permission,
  PermissionCategory,
  UserWithRoles,
  UserRoleResponse
} from '../types/role';
import type {
  LoginCredentials,
  RegisterData,
  TokenResponse,
  CurrentUser,
  PasswordChangeData,
  PasswordResetRequest,
  PasswordResetConfirm,
} from '../types/auth';
import type {
  TrainingCourse,
  TrainingCourseCreate,
  TrainingCourseUpdate,
  TrainingRecord,
  TrainingRecordCreate,
  TrainingRecordUpdate,
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  TrainingCategoryCreate,
  TrainingCategoryUpdate,
  UserTrainingStats,
  TrainingReport,
  RequirementProgress,
  // Training Program types
  TrainingRequirementEnhanced,
  TrainingRequirementEnhancedCreate,
  TrainingProgram,
  TrainingProgramCreate,
  ProgramPhase,
  ProgramPhaseCreate,
  ProgramRequirement,
  ProgramRequirementCreate,
  ProgramMilestone,
  ProgramMilestoneCreate,
  ProgramEnrollment,
  ProgramEnrollmentCreate,
  RequirementProgressRecord,
  RequirementProgressUpdate,
  ProgramWithDetails,
  MemberProgramProgress,
  RegistryImportResult,
  BulkEnrollmentRequest,
  BulkEnrollmentResponse,
  // External Training Integration types
  ExternalTrainingProvider,
  ExternalTrainingProviderCreate,
  ExternalTrainingProviderUpdate,
  ExternalCategoryMapping,
  ExternalCategoryMappingUpdate,
  ExternalUserMapping,
  ExternalUserMappingUpdate,
  ExternalTrainingSyncLog,
  ExternalTrainingImport,
  SyncRequest,
  SyncResponse,
  TestConnectionResponse,
  ImportRecordRequest,
  BulkImportRequest,
  BulkImportResponse,
} from '../types/training';
import type {
  Event,
  EventListItem,
  EventCreate,
  EventUpdate,
  EventCancel,
  RSVP,
  RSVPCreate,
  CheckInRequest,
  EventStats,
  CheckInMonitoringStats,
} from '../types/event';

const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Shared refresh promise to prevent concurrent refresh attempts.
// With token rotation (SEC-11), each refresh invalidates the previous
// refresh token.  If multiple 401s fire at the same time and each
// independently tries to refresh, the second attempt looks like a
// replay attack and the backend revokes all sessions.  By sharing a
// single promise, only one refresh request is made and all waiting
// callers receive the same new access token.
let refreshPromise: Promise<string> | null = null;

// Response interceptor to handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't retried yet, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        return Promise.reject(error);
      }

      try {
        // If a refresh is already in flight, wait for it
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_BASE_URL}/auth/refresh`, {
              refresh_token: refreshToken,
            })
            .then((response) => {
              const { access_token, refresh_token: new_refresh_token } = response.data;
              localStorage.setItem('access_token', access_token);
              // SEC-11: Store the rotated refresh token from the server
              if (new_refresh_token) {
                localStorage.setItem('refresh_token', new_refresh_token);
              }
              return access_token;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }

        const newAccessToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed, clear tokens and redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

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
   * Create a new member (admin/secretary only)
   */
  async createMember(memberData: {
    username: string;
    email: string;
    first_name: string;
    middle_name?: string;
    last_name: string;
    badge_number?: string;
    phone?: string;
    mobile?: string;
    date_of_birth?: string;
    hire_date?: string;
    rank?: string;
    station?: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    address_country?: string;
    emergency_contacts?: Array<{
      name: string;
      relationship: string;
      phone: string;
      email?: string;
      is_primary: boolean;
    }>;
    role_ids?: string[];
    send_welcome_email?: boolean;
  }): Promise<UserWithRoles> {
    const response = await api.post<UserWithRoles>('/users', memberData);
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
};

export interface EnabledModulesResponse {
  enabled_modules: string[];
}

export const organizationService = {
  /**
   * Get organization settings
   */
  async getSettings(): Promise<{ contact_info_visibility: ContactInfoSettings }> {
    const response = await api.get('/organization/settings');
    return response.data;
  },

  /**
   * Update contact information settings (secretary only)
   */
  async updateContactInfoSettings(settings: ContactInfoSettings): Promise<ContactInfoSettings> {
    const response = await api.patch('/organization/settings/contact-info', settings);
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
   * Check if a specific module is enabled
   */
  async isModuleEnabled(moduleId: string): Promise<boolean> {
    const response = await this.getEnabledModules();
    return response.enabled_modules.includes(moduleId);
  },
};

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
      name?: string;
      description?: string;
      permissions?: string[];
      priority?: number;
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
};

export const authService = {
  /**
   * Login user
   */
  async login(credentials: LoginCredentials): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/login', credentials);
    return response.data;
  },

  /**
   * Register new user
   */
  async register(data: RegisterData): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/register', data);
    return response.data;
  },

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<CurrentUser> {
    const response = await api.get<CurrentUser>('/auth/me');
    return response.data;
  },

  /**
   * Change password
   */
  async changePassword(data: PasswordChangeData): Promise<void> {
    await api.post('/auth/change-password', data);
  },

  /**
   * Request password reset (sends email with reset link)
   */
  async requestPasswordReset(data: PasswordResetRequest): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/forgot-password', data);
    return response.data;
  },

  /**
   * Confirm password reset with token
   */
  async confirmPasswordReset(data: PasswordResetConfirm): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/reset-password', data);
    return response.data;
  },

  /**
   * Validate password reset token
   */
  async validateResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    const response = await api.post<{ valid: boolean; email?: string }>('/auth/validate-reset-token', { token });
    return response.data;
  },

  /**
   * Check if authenticated
   */
  async checkAuth(): Promise<boolean> {
    try {
      await api.get('/auth/check');
      return true;
    } catch (error) {
      return false;
    }
  },
};

export const trainingService = {
  /**
   * Get all training courses
   */
  async getCourses(activeOnly: boolean = true): Promise<TrainingCourse[]> {
    const response = await api.get<TrainingCourse[]>('/training/courses', {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  /**
   * Get a specific course
   */
  async getCourse(courseId: string): Promise<TrainingCourse> {
    const response = await api.get<TrainingCourse>(`/training/courses/${courseId}`);
    return response.data;
  },

  /**
   * Create a new course
   */
  async createCourse(course: TrainingCourseCreate): Promise<TrainingCourse> {
    const response = await api.post<TrainingCourse>('/training/courses', course);
    return response.data;
  },

  /**
   * Update a course
   */
  async updateCourse(courseId: string, updates: TrainingCourseUpdate): Promise<TrainingCourse> {
    const response = await api.patch<TrainingCourse>(`/training/courses/${courseId}`, updates);
    return response.data;
  },

  /**
   * Get training records
   */
  async getRecords(params?: {
    user_id?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<TrainingRecord[]> {
    const response = await api.get<TrainingRecord[]>('/training/records', { params });
    return response.data;
  },

  /**
   * Create a training record
   */
  async createRecord(record: TrainingRecordCreate): Promise<TrainingRecord> {
    const response = await api.post<TrainingRecord>('/training/records', record);
    return response.data;
  },

  /**
   * Update a training record
   */
  async updateRecord(recordId: string, updates: TrainingRecordUpdate): Promise<TrainingRecord> {
    const response = await api.patch<TrainingRecord>(`/training/records/${recordId}`, updates);
    return response.data;
  },

  /**
   * Get training requirements
   */
  async getRequirements(params?: {
    year?: number;
    active_only?: boolean;
  }): Promise<TrainingRequirement[]> {
    const response = await api.get<TrainingRequirement[]>('/training/requirements', { params });
    return response.data;
  },

  /**
   * Create a training requirement
   */
  async createRequirement(requirement: TrainingRequirementCreate): Promise<TrainingRequirement> {
    const response = await api.post<TrainingRequirement>('/training/requirements', requirement);
    return response.data;
  },

  /**
   * Update a training requirement
   */
  async updateRequirement(
    requirementId: string,
    updates: TrainingRequirementUpdate
  ): Promise<TrainingRequirement> {
    const response = await api.patch<TrainingRequirement>(
      `/training/requirements/${requirementId}`,
      updates
    );
    return response.data;
  },

  /**
   * Delete a training requirement (soft delete)
   */
  async deleteRequirement(requirementId: string): Promise<void> {
    await api.delete(`/training/requirements/${requirementId}`);
  },

  // ==================== Training Categories ====================

  /**
   * Get all training categories
   */
  async getCategories(activeOnly: boolean = true): Promise<TrainingCategory[]> {
    const response = await api.get<TrainingCategory[]>('/training/categories', {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  /**
   * Get a specific category
   */
  async getCategory(categoryId: string): Promise<TrainingCategory> {
    const response = await api.get<TrainingCategory>(`/training/categories/${categoryId}`);
    return response.data;
  },

  /**
   * Create a new training category
   */
  async createCategory(category: TrainingCategoryCreate): Promise<TrainingCategory> {
    const response = await api.post<TrainingCategory>('/training/categories', category);
    return response.data;
  },

  /**
   * Update a training category
   */
  async updateCategory(
    categoryId: string,
    updates: TrainingCategoryUpdate
  ): Promise<TrainingCategory> {
    const response = await api.patch<TrainingCategory>(
      `/training/categories/${categoryId}`,
      updates
    );
    return response.data;
  },

  /**
   * Delete a training category (soft delete)
   */
  async deleteCategory(categoryId: string): Promise<void> {
    await api.delete(`/training/categories/${categoryId}`);
  },

  /**
   * Get training statistics for a user
   */
  async getUserStats(userId: string): Promise<UserTrainingStats> {
    const response = await api.get<UserTrainingStats>(`/training/stats/user/${userId}`);
    return response.data;
  },

  /**
   * Generate a training report
   */
  async generateReport(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<TrainingReport> {
    const response = await api.get<TrainingReport>(`/training/reports/user/${userId}`, {
      params: { start_date: startDate, end_date: endDate },
    });
    return response.data;
  },

  /**
   * Get requirement progress for a user
   */
  async getRequirementProgress(
    userId: string,
    year?: number
  ): Promise<RequirementProgress[]> {
    const response = await api.get<RequirementProgress[]>(
      `/training/requirements/progress/${userId}`,
      { params: { year } }
    );
    return response.data;
  },

  /**
   * Get expiring certifications
   */
  async getExpiringCertifications(daysAhead: number = 90): Promise<TrainingRecord[]> {
    const response = await api.get<TrainingRecord[]>('/training/certifications/expiring', {
      params: { days_ahead: daysAhead },
    });
    return response.data;
  },
};

// ==================== External Training Integration Service ====================

export const externalTrainingService = {
  // ==================== Providers ====================

  /**
   * Get all external training providers
   */
  async getProviders(activeOnly: boolean = true): Promise<ExternalTrainingProvider[]> {
    const response = await api.get<ExternalTrainingProvider[]>('/training/external/providers', {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  /**
   * Get a specific provider
   */
  async getProvider(providerId: string): Promise<ExternalTrainingProvider> {
    const response = await api.get<ExternalTrainingProvider>(`/training/external/providers/${providerId}`);
    return response.data;
  },

  /**
   * Create a new external training provider
   */
  async createProvider(provider: ExternalTrainingProviderCreate): Promise<ExternalTrainingProvider> {
    const response = await api.post<ExternalTrainingProvider>('/training/external/providers', provider);
    return response.data;
  },

  /**
   * Update an external training provider
   */
  async updateProvider(
    providerId: string,
    updates: ExternalTrainingProviderUpdate
  ): Promise<ExternalTrainingProvider> {
    const response = await api.patch<ExternalTrainingProvider>(
      `/training/external/providers/${providerId}`,
      updates
    );
    return response.data;
  },

  /**
   * Delete an external training provider (soft delete)
   */
  async deleteProvider(providerId: string): Promise<void> {
    await api.delete(`/training/external/providers/${providerId}`);
  },

  /**
   * Test provider connection
   */
  async testConnection(providerId: string): Promise<TestConnectionResponse> {
    const response = await api.post<TestConnectionResponse>(
      `/training/external/providers/${providerId}/test`
    );
    return response.data;
  },

  // ==================== Sync Operations ====================

  /**
   * Trigger a sync operation
   */
  async triggerSync(providerId: string, request: SyncRequest): Promise<SyncResponse> {
    const response = await api.post<SyncResponse>(
      `/training/external/providers/${providerId}/sync`,
      request
    );
    return response.data;
  },

  /**
   * Get sync logs for a provider
   */
  async getSyncLogs(providerId: string, limit: number = 20): Promise<ExternalTrainingSyncLog[]> {
    const response = await api.get<ExternalTrainingSyncLog[]>(
      `/training/external/providers/${providerId}/sync-logs`,
      { params: { limit } }
    );
    return response.data;
  },

  // ==================== Category Mappings ====================

  /**
   * Get category mappings for a provider
   */
  async getCategoryMappings(
    providerId: string,
    unmappedOnly: boolean = false
  ): Promise<ExternalCategoryMapping[]> {
    const response = await api.get<ExternalCategoryMapping[]>(
      `/training/external/providers/${providerId}/category-mappings`,
      { params: { unmapped_only: unmappedOnly } }
    );
    return response.data;
  },

  /**
   * Update a category mapping
   */
  async updateCategoryMapping(
    providerId: string,
    mappingId: string,
    updates: ExternalCategoryMappingUpdate
  ): Promise<ExternalCategoryMapping> {
    const response = await api.patch<ExternalCategoryMapping>(
      `/training/external/providers/${providerId}/category-mappings/${mappingId}`,
      updates
    );
    return response.data;
  },

  // ==================== User Mappings ====================

  /**
   * Get user mappings for a provider
   */
  async getUserMappings(
    providerId: string,
    unmappedOnly: boolean = false
  ): Promise<ExternalUserMapping[]> {
    const response = await api.get<ExternalUserMapping[]>(
      `/training/external/providers/${providerId}/user-mappings`,
      { params: { unmapped_only: unmappedOnly } }
    );
    return response.data;
  },

  /**
   * Update a user mapping
   */
  async updateUserMapping(
    providerId: string,
    mappingId: string,
    updates: ExternalUserMappingUpdate
  ): Promise<ExternalUserMapping> {
    const response = await api.patch<ExternalUserMapping>(
      `/training/external/providers/${providerId}/user-mappings/${mappingId}`,
      updates
    );
    return response.data;
  },

  // ==================== Imported Records ====================

  /**
   * Get imported records for a provider
   */
  async getImportedRecords(
    providerId: string,
    params?: {
      status?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<ExternalTrainingImport[]> {
    const response = await api.get<ExternalTrainingImport[]>(
      `/training/external/providers/${providerId}/imports`,
      { params }
    );
    return response.data;
  },

  /**
   * Import a single record
   */
  async importRecord(
    providerId: string,
    importId: string,
    request: ImportRecordRequest
  ): Promise<ExternalTrainingImport> {
    const response = await api.post<ExternalTrainingImport>(
      `/training/external/providers/${providerId}/imports/${importId}/import`,
      request
    );
    return response.data;
  },

  /**
   * Bulk import records
   */
  async bulkImport(providerId: string, request: BulkImportRequest): Promise<BulkImportResponse> {
    const response = await api.post<BulkImportResponse>(
      `/training/external/providers/${providerId}/imports/bulk`,
      request
    );
    return response.data;
  },
};

export const trainingProgramService = {
  // ==================== Training Requirements ====================

  /**
   * Get enhanced training requirements with filters
   */
  async getRequirementsEnhanced(params?: {
    source?: string;
    registry_name?: string;
    requirement_type?: string;
    position?: string;
  }): Promise<TrainingRequirementEnhanced[]> {
    const response = await api.get<TrainingRequirementEnhanced[]>('/training/programs/requirements', { params });
    return response.data;
  },

  /**
   * Get a specific enhanced requirement
   */
  async getRequirementEnhanced(requirementId: string): Promise<TrainingRequirementEnhanced> {
    const response = await api.get<TrainingRequirementEnhanced>(`/training/programs/requirements/${requirementId}`);
    return response.data;
  },

  /**
   * Create an enhanced training requirement
   */
  async createRequirementEnhanced(requirement: TrainingRequirementEnhancedCreate): Promise<TrainingRequirementEnhanced> {
    const response = await api.post<TrainingRequirementEnhanced>('/training/programs/requirements', requirement);
    return response.data;
  },

  /**
   * Update an enhanced training requirement
   */
  async updateRequirementEnhanced(requirementId: string, updates: Partial<TrainingRequirementEnhancedCreate>): Promise<TrainingRequirementEnhanced> {
    const response = await api.patch<TrainingRequirementEnhanced>(`/training/programs/requirements/${requirementId}`, updates);
    return response.data;
  },

  // ==================== Training Programs ====================

  /**
   * Get all training programs
   */
  async getPrograms(params?: {
    target_position?: string;
    is_template?: boolean;
  }): Promise<TrainingProgram[]> {
    const response = await api.get<TrainingProgram[]>('/training/programs/programs', { params });
    return response.data;
  },

  /**
   * Get a program with full details
   */
  async getProgram(programId: string): Promise<ProgramWithDetails> {
    const response = await api.get<ProgramWithDetails>(`/training/programs/programs/${programId}`);
    return response.data;
  },

  /**
   * Create a new training program
   */
  async createProgram(program: TrainingProgramCreate): Promise<TrainingProgram> {
    const response = await api.post<TrainingProgram>('/training/programs/programs', program);
    return response.data;
  },

  // ==================== Program Phases ====================

  /**
   * Get phases for a program
   */
  async getProgramPhases(programId: string): Promise<ProgramPhase[]> {
    const response = await api.get<ProgramPhase[]>(`/training/programs/programs/${programId}/phases`);
    return response.data;
  },

  /**
   * Create a program phase
   */
  async createProgramPhase(programId: string, phase: ProgramPhaseCreate): Promise<ProgramPhase> {
    const response = await api.post<ProgramPhase>(`/training/programs/programs/${programId}/phases`, phase);
    return response.data;
  },

  // ==================== Program Requirements ====================

  /**
   * Get requirements for a program
   */
  async getProgramRequirements(programId: string, phaseId?: string): Promise<ProgramRequirement[]> {
    const response = await api.get<ProgramRequirement[]>(`/training/programs/programs/${programId}/requirements`, {
      params: { phase_id: phaseId },
    });
    return response.data;
  },

  /**
   * Add a requirement to a program
   */
  async addProgramRequirement(programId: string, requirement: ProgramRequirementCreate): Promise<ProgramRequirement> {
    const response = await api.post<ProgramRequirement>(`/training/programs/programs/${programId}/requirements`, requirement);
    return response.data;
  },

  // ==================== Program Milestones ====================

  /**
   * Create a program milestone
   */
  async createMilestone(programId: string, milestone: ProgramMilestoneCreate): Promise<ProgramMilestone> {
    const response = await api.post<ProgramMilestone>(`/training/programs/programs/${programId}/milestones`, milestone);
    return response.data;
  },

  // ==================== Program Enrollments ====================

  /**
   * Enroll a member in a program
   */
  async enrollMember(enrollment: ProgramEnrollmentCreate): Promise<ProgramEnrollment> {
    const response = await api.post<ProgramEnrollment>('/training/programs/enrollments', enrollment);
    return response.data;
  },

  /**
   * Get current user's enrollments
   */
  async getMyEnrollments(status?: string): Promise<ProgramEnrollment[]> {
    const response = await api.get<ProgramEnrollment[]>('/training/programs/enrollments/me', {
      params: { status },
    });
    return response.data;
  },

  /**
   * Get enrollments for a specific user
   */
  async getUserEnrollments(userId: string, status?: string): Promise<ProgramEnrollment[]> {
    const response = await api.get<ProgramEnrollment[]>(`/training/programs/enrollments/user/${userId}`, {
      params: { status },
    });
    return response.data;
  },

  /**
   * Get detailed enrollment progress
   */
  async getEnrollmentProgress(enrollmentId: string): Promise<MemberProgramProgress> {
    const response = await api.get<MemberProgramProgress>(`/training/programs/enrollments/${enrollmentId}`);
    return response.data;
  },

  // ==================== Progress Tracking ====================

  /**
   * Update requirement progress
   */
  async updateProgress(progressId: string, updates: RequirementProgressUpdate): Promise<RequirementProgressRecord> {
    const response = await api.patch<RequirementProgressRecord>(`/training/programs/progress/${progressId}`, updates);
    return response.data;
  },

  // ==================== Program Duplication ====================

  /**
   * Duplicate a program with all phases, requirements, and milestones
   */
  async duplicateProgram(programId: string, newName: string, incrementVersion: boolean = true): Promise<TrainingProgram> {
    const response = await api.post<TrainingProgram>(`/training/programs/programs/${programId}/duplicate`, null, {
      params: { new_name: newName, increment_version: incrementVersion },
    });
    return response.data;
  },

  // ==================== Bulk Enrollment ====================

  /**
   * Enroll multiple members in a program
   */
  async bulkEnrollMembers(programId: string, request: BulkEnrollmentRequest): Promise<BulkEnrollmentResponse> {
    const response = await api.post<BulkEnrollmentResponse>(`/training/programs/programs/${programId}/bulk-enroll`, request);
    return response.data;
  },

  // ==================== Registry Import ====================

  /**
   * Import requirements from a registry
   */
  async importRegistry(registryName: string, skipExisting: boolean = true): Promise<RegistryImportResult> {
    const response = await api.post<RegistryImportResult>(`/training/programs/requirements/import/${registryName}`, null, {
      params: { skip_existing: skipExisting },
    });
    return response.data;
  },
};

export const electionService = {
  /**
   * Get all elections
   */
  async getElections(statusFilter?: string): Promise<import('../types/election').ElectionListItem[]> {
    const response = await api.get<import('../types/election').ElectionListItem[]>('/elections', {
      params: { status_filter: statusFilter },
    });
    return response.data;
  },

  /**
   * Get a specific election
   */
  async getElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.get<import('../types/election').Election>(`/elections/${electionId}`);
    return response.data;
  },

  /**
   * Create a new election
   */
  async createElection(electionData: import('../types/election').ElectionCreate): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>('/elections', electionData);
    return response.data;
  },

  /**
   * Update an election
   */
  async updateElection(electionId: string, electionData: import('../types/election').ElectionUpdate): Promise<import('../types/election').Election> {
    const response = await api.patch<import('../types/election').Election>(`/elections/${electionId}`, electionData);
    return response.data;
  },

  /**
   * Delete an election (reason required for non-draft elections)
   */
  async deleteElection(electionId: string, reason?: string): Promise<import('../types/election').ElectionDeleteResponse> {
    const response = await api.delete<import('../types/election').ElectionDeleteResponse>(`/elections/${electionId}`, {
      data: reason ? { reason } : undefined,
    });
    return response.data;
  },

  /**
   * Open an election for voting
   */
  async openElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>(`/elections/${electionId}/open`);
    return response.data;
  },

  /**
   * Close an election
   */
  async closeElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>(`/elections/${electionId}/close`);
    return response.data;
  },

  /**
   * Rollback an election to previous status
   */
  async rollbackElection(electionId: string, reason: string): Promise<{ success: boolean; election: import('../types/election').Election; message: string; notifications_sent: number }> {
    const response = await api.post(`/elections/${electionId}/rollback`, { reason });
    return response.data;
  },

  /**
   * Get candidates for an election
   */
  async getCandidates(electionId: string): Promise<import('../types/election').Candidate[]> {
    const response = await api.get<import('../types/election').Candidate[]>(`/elections/${electionId}/candidates`);
    return response.data;
  },

  /**
   * Add a candidate to an election
   */
  async createCandidate(electionId: string, candidateData: import('../types/election').CandidateCreate): Promise<import('../types/election').Candidate> {
    const response = await api.post<import('../types/election').Candidate>(`/elections/${electionId}/candidates`, candidateData);
    return response.data;
  },

  /**
   * Update a candidate
   */
  async updateCandidate(electionId: string, candidateId: string, candidateData: import('../types/election').CandidateUpdate): Promise<import('../types/election').Candidate> {
    const response = await api.patch<import('../types/election').Candidate>(`/elections/${electionId}/candidates/${candidateId}`, candidateData);
    return response.data;
  },

  /**
   * Delete a candidate
   */
  async deleteCandidate(electionId: string, candidateId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/candidates/${candidateId}`);
  },

  /**
   * Check voter eligibility
   */
  async checkEligibility(electionId: string): Promise<import('../types/election').VoterEligibility> {
    const response = await api.get<import('../types/election').VoterEligibility>(`/elections/${electionId}/eligibility`);
    return response.data;
  },

  /**
   * Cast a vote
   */
  async castVote(electionId: string, voteData: import('../types/election').VoteCreate): Promise<import('../types/election').Vote> {
    const response = await api.post<import('../types/election').Vote>(`/elections/${electionId}/vote`, voteData);
    return response.data;
  },

  /**
   * Get election results
   */
  async getResults(electionId: string): Promise<import('../types/election').ElectionResults> {
    const response = await api.get<import('../types/election').ElectionResults>(`/elections/${electionId}/results`);
    return response.data;
  },

  /**
   * Get election statistics
   */
  async getStats(electionId: string): Promise<import('../types/election').ElectionStats> {
    const response = await api.get<import('../types/election').ElectionStats>(`/elections/${electionId}/stats`);
    return response.data;
  },

  /**
   * Send ballot notification emails
   */
  async sendBallotEmail(electionId: string, emailData: import('../types/election').EmailBallot): Promise<import('../types/election').EmailBallotResponse> {
    const response = await api.post<import('../types/election').EmailBallotResponse>(`/elections/${electionId}/send-ballot`, emailData);
    return response.data;
  },

  /**
   * Cast votes in bulk
   */
  async bulkCastVotes(electionId: string, votes: import('../types/election').VoteCreate[]): Promise<{ success: boolean; votes_cast: number }> {
    const response = await api.post<{ success: boolean; votes_cast: number }>(`/elections/${electionId}/vote/bulk`, { votes });
    return response.data;
  },

  /**
   * Get ballot templates
   */
  async getBallotTemplates(): Promise<import('../types/election').BallotTemplate[]> {
    const response = await api.get<{ templates: import('../types/election').BallotTemplate[] }>('/elections/templates/ballot-items');
    return response.data.templates;
  },

  /**
   * Get attendees for an election meeting
   */
  async getAttendees(electionId: string): Promise<{ attendees: import('../types/election').Attendee[] }> {
    const response = await api.get<{ attendees: import('../types/election').Attendee[] }>(`/elections/${electionId}/attendees`);
    return response.data;
  },

  /**
   * Check in an attendee at an election meeting
   */
  async checkInAttendee(electionId: string, userId: string): Promise<import('../types/election').AttendeeCheckInResponse> {
    const response = await api.post<import('../types/election').AttendeeCheckInResponse>(`/elections/${electionId}/attendees`, { user_id: userId });
    return response.data;
  },

  /**
   * Remove an attendee from an election meeting
   */
  async removeAttendee(electionId: string, userId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/attendees/${userId}`);
  },

  /**
   * Get ballot by voting token (public/anonymous access)
   */
  async getBallotByToken(token: string): Promise<import('../types/election').Election> {
    const response = await api.get<import('../types/election').Election>('/elections/ballot', { params: { token } });
    return response.data;
  },

  /**
   * Get candidates for a ballot by voting token
   */
  async getBallotCandidates(token: string): Promise<import('../types/election').Candidate[]> {
    const response = await api.get<import('../types/election').Candidate[]>(`/elections/ballot/${token}/candidates`);
    return response.data;
  },

  /**
   * Submit a ballot using a voting token
   */
  async submitBallot(token: string, votes: import('../types/election').BallotItemVote[]): Promise<import('../types/election').BallotSubmissionResponse> {
    const response = await api.post<import('../types/election').BallotSubmissionResponse>('/elections/ballot/vote/bulk', { votes }, { params: { token } });
    return response.data;
  },

  /**
   * Verify vote integrity for an election
   */
  async verifyIntegrity(electionId: string): Promise<import('../types/election').VoteIntegrityResult> {
    const response = await api.get<import('../types/election').VoteIntegrityResult>(`/elections/${electionId}/integrity`);
    return response.data;
  },

  /**
   * Get forensics report for an election
   */
  async getForensics(electionId: string): Promise<import('../types/election').ForensicsReport> {
    const response = await api.get<import('../types/election').ForensicsReport>(`/elections/${electionId}/forensics`);
    return response.data;
  },

  /**
   * Soft-delete (void) a vote
   */
  async softDeleteVote(electionId: string, voteId: string, reason: string): Promise<void> {
    await api.delete(`/elections/${electionId}/votes/${voteId}`, { params: { reason } });
  },
};

export const eventService = {
  /**
   * Get all events with optional filtering
   */
  async getEvents(params?: {
    event_type?: string;
    start_after?: string;
    start_before?: string;
    include_cancelled?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<EventListItem[]> {
    const response = await api.get<EventListItem[]>('/events', { params });
    return response.data;
  },

  /**
   * Create a new event
   */
  async createEvent(eventData: EventCreate): Promise<Event> {
    const response = await api.post<Event>('/events', eventData);
    return response.data;
  },

  /**
   * Get a specific event
   */
  async getEvent(eventId: string): Promise<Event> {
    const response = await api.get<Event>(`/events/${eventId}`);
    return response.data;
  },

  /**
   * Update an event
   */
  async updateEvent(eventId: string, eventData: EventUpdate): Promise<Event> {
    const response = await api.patch<Event>(`/events/${eventId}`, eventData);
    return response.data;
  },

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<void> {
    await api.delete(`/events/${eventId}`);
  },

  /**
   * Duplicate an event (copies all settings, no RSVPs)
   */
  async duplicateEvent(eventId: string): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/duplicate`);
    return response.data;
  },

  /**
   * Cancel an event
   */
  async cancelEvent(eventId: string, cancelData: EventCancel): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/cancel`, cancelData);
    return response.data;
  },

  /**
   * Create or update an RSVP
   */
  async createOrUpdateRSVP(eventId: string, rsvpData: RSVPCreate): Promise<RSVP> {
    const response = await api.post<RSVP>(`/events/${eventId}/rsvp`, rsvpData);
    return response.data;
  },

  /**
   * Get all RSVPs for an event
   */
  async getEventRSVPs(eventId: string, status_filter?: string): Promise<RSVP[]> {
    const params = status_filter ? { status_filter } : undefined;
    const response = await api.get<RSVP[]>(`/events/${eventId}/rsvps`, { params });
    return response.data;
  },

  /**
   * Check in an attendee
   */
  async checkInAttendee(eventId: string, checkInData: CheckInRequest): Promise<RSVP> {
    const response = await api.post<RSVP>(`/events/${eventId}/check-in`, checkInData);
    return response.data;
  },

  /**
   * Get event statistics
   */
  async getEventStats(eventId: string): Promise<EventStats> {
    const response = await api.get<EventStats>(`/events/${eventId}/stats`);
    return response.data;
  },

  /**
   * Get eligible members for check-in
   */
  async getEligibleMembers(eventId: string): Promise<Array<{ id: string; first_name: string; last_name: string; email: string }>> {
    const response = await api.get<Array<{ id: string; first_name: string; last_name: string; email: string }>>(`/events/${eventId}/eligible-members`);
    return response.data;
  },

  /**
   * Record actual start and end times for an event
   */
  async recordActualTimes(eventId: string, times: import('../types/event').RecordActualTimes): Promise<import('../types/event').Event> {
    const response = await api.post<import('../types/event').Event>(`/events/${eventId}/record-times`, times);
    return response.data;
  },

  /**
   * Get QR code check-in data for an event
   */
  async getQRCheckInData(eventId: string): Promise<import('../types/event').QRCheckInData> {
    const response = await api.get<import('../types/event').QRCheckInData>(`/events/${eventId}/qr-check-in-data`);
    return response.data;
  },

  /**
   * Check in to or out of an event (self-check-in/out via QR code)
   */
  async selfCheckIn(eventId: string, isCheckout: boolean = false): Promise<import('../types/event').RSVP> {
    const response = await api.post<import('../types/event').RSVP>(
      `/events/${eventId}/self-check-in`,
      { is_checkout: isCheckout }
    );
    return response.data;
  },

  /**
   * Get real-time check-in monitoring statistics
   */
  async getCheckInMonitoring(eventId: string): Promise<CheckInMonitoringStats> {
    const response = await api.get(`/events/${eventId}/check-in-monitoring`);
    return response.data;
  },

  /**
   * Add an attendee to an event (manager action)
   */
  async addAttendee(eventId: string, data: import('../types/event').ManagerAddAttendee): Promise<import('../types/event').RSVP> {
    const response = await api.post<import('../types/event').RSVP>(`/events/${eventId}/add-attendee`, data);
    return response.data;
  },

  /**
   * Override attendance details for an RSVP (manager action)
   */
  async overrideAttendance(eventId: string, userId: string, data: import('../types/event').RSVPOverride): Promise<import('../types/event').RSVP> {
    const response = await api.patch<import('../types/event').RSVP>(`/events/${eventId}/rsvps/${userId}/override`, data);
    return response.data;
  },

  // Event Templates
  async getTemplates(includeInactive?: boolean): Promise<import('../types/event').EventTemplate[]> {
    const params = includeInactive ? { include_inactive: true } : undefined;
    const response = await api.get<import('../types/event').EventTemplate[]>('/events/templates', { params });
    return response.data;
  },

  async createTemplate(data: import('../types/event').EventTemplateCreate): Promise<import('../types/event').EventTemplate> {
    const response = await api.post<import('../types/event').EventTemplate>('/events/templates', data);
    return response.data;
  },

  async getTemplate(templateId: string): Promise<import('../types/event').EventTemplate> {
    const response = await api.get<import('../types/event').EventTemplate>(`/events/templates/${templateId}`);
    return response.data;
  },

  async updateTemplate(templateId: string, data: Partial<import('../types/event').EventTemplateCreate>): Promise<import('../types/event').EventTemplate> {
    const response = await api.patch<import('../types/event').EventTemplate>(`/events/templates/${templateId}`, data);
    return response.data;
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`/events/templates/${templateId}`);
  },

  // Recurring Events
  async createRecurringEvent(data: import('../types/event').RecurringEventCreate): Promise<import('../types/event').Event[]> {
    const response = await api.post<import('../types/event').Event[]>('/events/recurring', data);
    return response.data;
  },
};

export interface UserInventoryItem {
  assignment_id: string;
  item_id: string;
  item_name: string;
  serial_number?: string;
  asset_tag?: string;
  condition: string;
  assigned_date: string;
}

export interface UserCheckoutItem {
  checkout_id: string;
  item_id: string;
  item_name: string;
  checked_out_at: string;
  expected_return_at?: string;
  is_overdue: boolean;
}

export interface UserInventoryResponse {
  permanent_assignments: UserInventoryItem[];
  active_checkouts: UserCheckoutItem[];
}

export interface InventoryCategory {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  item_type: string;
  parent_category_id?: string;
  requires_assignment: boolean;
  requires_serial_number: boolean;
  requires_maintenance: boolean;
  low_stock_threshold?: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  organization_id: string;
  category_id?: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model_number?: string;
  serial_number?: string;
  asset_tag?: string;
  barcode?: string;
  purchase_date?: string;
  purchase_price?: number;
  vendor?: string;
  warranty_expiration?: string;
  storage_location?: string;
  station?: string;
  condition: string;
  status: string;
  status_notes?: string;
  quantity: number;
  unit_of_measure?: string;
  last_inspection_date?: string;
  next_inspection_due?: string;
  inspection_interval_days?: number;
  assigned_to_user_id?: string;
  assigned_date?: string;
  notes?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemCreate {
  category_id?: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model_number?: string;
  serial_number?: string;
  asset_tag?: string;
  purchase_date?: string;
  purchase_price?: number;
  vendor?: string;
  storage_location?: string;
  station?: string;
  condition?: string;
  status?: string;
  quantity?: number;
  unit_of_measure?: string;
  inspection_interval_days?: number;
  notes?: string;
}

export interface InventoryItemsListResponse {
  items: InventoryItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface InventorySummary {
  total_items: number;
  items_by_status: Record<string, number>;
  items_by_condition: Record<string, number>;
  total_value: number;
  active_checkouts: number;
  overdue_checkouts: number;
  maintenance_due_count: number;
}

export interface InventoryCategoryCreate {
  name: string;
  description?: string;
  item_type: string;
  requires_assignment?: boolean;
  requires_serial_number?: boolean;
  requires_maintenance?: boolean;
  low_stock_threshold?: number;
}

export const inventoryService = {
  async getUserInventory(userId: string): Promise<UserInventoryResponse> {
    const response = await api.get<UserInventoryResponse>(`/inventory/users/${userId}/inventory`);
    return response.data;
  },

  async getSummary(): Promise<InventorySummary> {
    const response = await api.get<InventorySummary>('/inventory/summary');
    return response.data;
  },

  async getCategories(itemType?: string, activeOnly: boolean = true): Promise<InventoryCategory[]> {
    const response = await api.get<InventoryCategory[]>('/inventory/categories', {
      params: { item_type: itemType, active_only: activeOnly },
    });
    return response.data;
  },

  async createCategory(data: InventoryCategoryCreate): Promise<InventoryCategory> {
    const response = await api.post<InventoryCategory>('/inventory/categories', data);
    return response.data;
  },

  async getItems(params?: {
    category_id?: string;
    status?: string;
    search?: string;
    active_only?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<InventoryItemsListResponse> {
    const response = await api.get<InventoryItemsListResponse>('/inventory/items', { params });
    return response.data;
  },

  async getItem(itemId: string): Promise<InventoryItem> {
    const response = await api.get<InventoryItem>(`/inventory/items/${itemId}`);
    return response.data;
  },

  async createItem(data: InventoryItemCreate): Promise<InventoryItem> {
    const response = await api.post<InventoryItem>('/inventory/items', data);
    return response.data;
  },

  async updateItem(itemId: string, data: Partial<InventoryItemCreate>): Promise<InventoryItem> {
    const response = await api.patch<InventoryItem>(`/inventory/items/${itemId}`, data);
    return response.data;
  },

  async retireItem(itemId: string, notes?: string): Promise<void> {
    await api.post(`/inventory/items/${itemId}/retire`, { notes });
  },

  async assignItem(itemId: string, userId: string, options?: { assignment_type?: string; assignment_reason?: string }): Promise<{ id: string; item_id: string; user_id: string; is_active: boolean }> {
    const response = await api.post(`/inventory/items/${itemId}/assign`, {
      item_id: itemId,
      user_id: userId,
      assignment_type: options?.assignment_type ?? 'permanent',
      assignment_reason: options?.assignment_reason,
    });
    return response.data;
  },

  async unassignItem(itemId: string, options?: { return_condition?: string; return_notes?: string }): Promise<{ message: string }> {
    const response = await api.post(`/inventory/items/${itemId}/unassign`, {
      return_condition: options?.return_condition,
      return_notes: options?.return_notes,
    });
    return response.data;
  },

  async checkoutItem(data: { item_id: string; user_id: string; expected_return_at?: string; checkout_reason?: string }): Promise<{ id: string }> {
    const response = await api.post<{ id: string }>('/inventory/checkout', data);
    return response.data;
  },

  async checkInItem(checkoutId: string, returnCondition: string, damageNotes?: string): Promise<void> {
    await api.post(`/inventory/checkout/${checkoutId}/checkin`, { return_condition: returnCondition, damage_notes: damageNotes });
  },

  async getActiveCheckouts(): Promise<{ checkouts: UserCheckoutItem[]; total: number }> {
    const response = await api.get<{ checkouts: UserCheckoutItem[]; total: number }>('/inventory/checkout/active');
    return response.data;
  },

  async getOverdueCheckouts(): Promise<{ checkouts: UserCheckoutItem[]; total: number }> {
    const response = await api.get<{ checkouts: UserCheckoutItem[]; total: number }>('/inventory/checkout/overdue');
    return response.data;
  },

  async getLowStockItems(): Promise<InventoryItem[]> {
    const response = await api.get<InventoryItem[]>('/inventory/low-stock');
    return response.data;
  },
};

// ============================================
// Forms Types & Service
// ============================================

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  form_id: string;
  label: string;
  field_type: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  required: boolean;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string;
  options?: FormFieldOption[];
  sort_order: number;
  width: string;
  created_at: string;
  updated_at: string;
}

export interface FormFieldCreate {
  label: string;
  field_type: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  required?: boolean;
  min_length?: number;
  max_length?: number;
  options?: FormFieldOption[];
  sort_order?: number;
  width?: string;
}

export interface FormIntegration {
  id: string;
  form_id: string;
  organization_id: string;
  target_module: string;
  integration_type: string;
  field_mappings: Record<string, string>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormIntegrationCreate {
  target_module: string;
  integration_type: string;
  field_mappings: Record<string, string>;
  is_active?: boolean;
}

export interface MemberLookupResult {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  badge_number?: string;
  rank?: string;
  station?: string;
  email?: string;
}

export interface MemberLookupResponse {
  members: MemberLookupResult[];
  total: number;
}

export interface FormDef {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  category: string;
  status: string;
  allow_multiple_submissions: boolean;
  require_authentication: boolean;
  notify_on_submission: boolean;
  notification_emails?: string[];
  is_public: boolean;
  public_slug?: string;
  version: number;
  is_template: boolean;
  field_count?: number;
  submission_count?: number;
  created_at: string;
  updated_at: string;
  published_at?: string;
  created_by?: string;
}

export interface FormDetailDef extends FormDef {
  fields: FormField[];
  integrations: FormIntegration[];
}

export interface FormCreate {
  name: string;
  description?: string;
  category?: string;
  allow_multiple_submissions?: boolean;
  require_authentication?: boolean;
  notify_on_submission?: boolean;
  notification_emails?: string[];
  is_public?: boolean;
  fields?: FormFieldCreate[];
}

export interface FormUpdate {
  name?: string;
  description?: string;
  category?: string;
  status?: string;
  allow_multiple_submissions?: boolean;
  require_authentication?: boolean;
  notify_on_submission?: boolean;
  notification_emails?: string[];
  is_public?: boolean;
}

export interface FormsListResponse {
  forms: FormDef[];
  total: number;
  skip: number;
  limit: number;
}

export interface FormSubmission {
  id: string;
  organization_id: string;
  form_id: string;
  submitted_by?: string;
  submitted_at: string;
  data: Record<string, unknown>;
  submitter_name?: string;
  submitter_email?: string;
  is_public_submission: boolean;
  integration_processed: boolean;
  integration_result?: Record<string, unknown>;
  created_at: string;
}

export interface SubmissionsListResponse {
  submissions: FormSubmission[];
  total: number;
  skip: number;
  limit: number;
}

export interface FormsSummary {
  total_forms: number;
  published_forms: number;
  draft_forms: number;
  total_submissions: number;
  submissions_this_month: number;
  public_forms: number;
}

// Public form types (no auth required)
export interface PublicFormField {
  id: string;
  label: string;
  field_type: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  required: boolean;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  options?: FormFieldOption[];
  sort_order: number;
  width: string;
}

export interface PublicFormDef {
  id: string;
  name: string;
  description?: string;
  category: string;
  allow_multiple_submissions: boolean;
  fields: PublicFormField[];
  organization_name?: string;
}

export interface PublicFormSubmissionResponse {
  id: string;
  form_name: string;
  submitted_at: string;
  message: string;
}

export const formsService = {
  async getSummary(): Promise<FormsSummary> {
    const response = await api.get<FormsSummary>('/forms/summary');
    return response.data;
  },

  async getForms(params?: {
    status?: string;
    category?: string;
    search?: string;
    is_template?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<FormsListResponse> {
    const response = await api.get<FormsListResponse>('/forms', { params });
    return response.data;
  },

  async getForm(formId: string): Promise<FormDetailDef> {
    const response = await api.get<FormDetailDef>(`/forms/${formId}`);
    return response.data;
  },

  async createForm(data: FormCreate): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>('/forms', data);
    return response.data;
  },

  async updateForm(formId: string, data: FormUpdate): Promise<FormDetailDef> {
    const response = await api.patch<FormDetailDef>(`/forms/${formId}`, data);
    return response.data;
  },

  async deleteForm(formId: string): Promise<void> {
    await api.delete(`/forms/${formId}`);
  },

  async publishForm(formId: string): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>(`/forms/${formId}/publish`);
    return response.data;
  },

  async archiveForm(formId: string): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>(`/forms/${formId}/archive`);
    return response.data;
  },

  async addField(formId: string, data: FormFieldCreate): Promise<FormField> {
    const response = await api.post<FormField>(`/forms/${formId}/fields`, data);
    return response.data;
  },

  async updateField(formId: string, fieldId: string, data: Partial<FormFieldCreate>): Promise<FormField> {
    const response = await api.patch<FormField>(`/forms/${formId}/fields/${fieldId}`, data);
    return response.data;
  },

  async deleteField(formId: string, fieldId: string): Promise<void> {
    await api.delete(`/forms/${formId}/fields/${fieldId}`);
  },

  async submitForm(formId: string, data: Record<string, unknown>): Promise<FormSubmission> {
    const response = await api.post<FormSubmission>(`/forms/${formId}/submit`, { data });
    return response.data;
  },

  async getSubmissions(formId: string, params?: {
    skip?: number;
    limit?: number;
  }): Promise<SubmissionsListResponse> {
    const response = await api.get<SubmissionsListResponse>(`/forms/${formId}/submissions`, { params });
    return response.data;
  },

  async deleteSubmission(formId: string, submissionId: string): Promise<void> {
    await api.delete(`/forms/${formId}/submissions/${submissionId}`);
  },

  // Integration methods
  async addIntegration(formId: string, data: FormIntegrationCreate): Promise<FormIntegration> {
    const response = await api.post<FormIntegration>(`/forms/${formId}/integrations`, data);
    return response.data;
  },

  async updateIntegration(formId: string, integrationId: string, data: Partial<FormIntegrationCreate>): Promise<FormIntegration> {
    const response = await api.patch<FormIntegration>(`/forms/${formId}/integrations/${integrationId}`, data);
    return response.data;
  },

  async deleteIntegration(formId: string, integrationId: string): Promise<void> {
    await api.delete(`/forms/${formId}/integrations/${integrationId}`);
  },

  // Member lookup
  async memberLookup(query: string, limit?: number): Promise<MemberLookupResponse> {
    const response = await api.get<MemberLookupResponse>('/forms/member-lookup', {
      params: { q: query, limit: limit || 20 },
    });
    return response.data;
  },

  /**
   * Reorder form fields
   */
  async reorderFields(formId: string, fieldIds: string[]): Promise<void> {
    await api.post(`/forms/${formId}/fields/reorder`, fieldIds);
  },
};

// Public forms service (no auth required)
export const publicFormsService = {
  async getForm(slug: string): Promise<PublicFormDef> {
    const response = await axios.get<PublicFormDef>(
      `${import.meta.env.VITE_API_URL || '/api'}/public/v1/forms/${slug}`
    );
    return response.data;
  },

  async submitForm(slug: string, data: Record<string, unknown>, submitterName?: string, submitterEmail?: string, honeypot?: string): Promise<PublicFormSubmissionResponse> {
    const payload: Record<string, unknown> = { data, submitter_name: submitterName, submitter_email: submitterEmail };
    // Honeypot field - only sent if bot filled it in (real users never will)
    if (honeypot) {
      payload.website = honeypot;
    }
    const response = await axios.post<PublicFormSubmissionResponse>(
      `${import.meta.env.VITE_API_URL || '/api'}/public/v1/forms/${slug}/submit`,
      payload
    );
    return response.data;
  },
};

// ============================================
// Documents Service
// ============================================

export interface DocumentFolder {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  parent_id?: string;
  document_count: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface DocumentRecord {
  id: string;
  organization_id: string;
  folder_id?: string;
  name: string;
  description?: string;
  file_name: string;
  file_size: number;
  file_type?: string;
  status: string;
  version: number;
  tags?: string;
  created_at: string;
  updated_at: string;
  uploaded_by?: string;
  uploader_name?: string;
  folder_name?: string;
}

export interface DocumentsSummary {
  total_documents: number;
  total_folders: number;
  total_size_bytes: number;
  documents_this_month: number;
}

export const documentsService = {
  async getFolders(parentId?: string): Promise<{ folders: DocumentFolder[]; total: number }> {
    const params: Record<string, string> = {};
    if (parentId) params.parent_id = parentId;
    const response = await api.get('/documents/folders', { params });
    return response.data;
  },

  async createFolder(data: { name: string; description?: string; color?: string; icon?: string; parent_id?: string }): Promise<DocumentFolder> {
    const response = await api.post<DocumentFolder>('/documents/folders', data);
    return response.data;
  },

  async updateFolder(folderId: string, data: Partial<{ name: string; description: string; color: string }>): Promise<DocumentFolder> {
    const response = await api.patch<DocumentFolder>(`/documents/folders/${folderId}`, data);
    return response.data;
  },

  async deleteFolder(folderId: string): Promise<void> {
    await api.delete(`/documents/folders/${folderId}`);
  },

  async getDocuments(params?: { folder_id?: string; search?: string; skip?: number; limit?: number }): Promise<{ documents: DocumentRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get('/documents', { params });
    return response.data;
  },

  async uploadDocument(formData: FormData): Promise<DocumentRecord> {
    const response = await api.post<DocumentRecord>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async getDocument(documentId: string): Promise<DocumentRecord> {
    const response = await api.get<DocumentRecord>(`/documents/${documentId}`);
    return response.data;
  },

  async updateDocument(documentId: string, data: Partial<{ name: string; description: string; folder_id: string; tags: string; status: string }>): Promise<DocumentRecord> {
    const response = await api.patch<DocumentRecord>(`/documents/${documentId}`, data);
    return response.data;
  },

  async deleteDocument(documentId: string): Promise<void> {
    await api.delete(`/documents/${documentId}`);
  },

  async getSummary(): Promise<DocumentsSummary> {
    const response = await api.get<DocumentsSummary>('/documents/stats/summary');
    return response.data;
  },
};

// ============================================
// Meetings (Minutes) Service
// ============================================

export interface MeetingRecord {
  id: string;
  organization_id: string;
  title: string;
  meeting_type: string;
  meeting_date: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  called_by?: string;
  status: string;
  agenda?: string;
  notes?: string;
  motions?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  creator_name?: string;
  attendee_count: number;
  action_item_count: number;
  attendees?: MeetingAttendee[];
  action_items?: MeetingActionItem[];
}

export interface MeetingAttendee {
  id: string;
  meeting_id: string;
  user_id: string;
  present: boolean;
  excused: boolean;
  user_name?: string;
  created_at: string;
}

export interface MeetingActionItem {
  id: string;
  meeting_id: string;
  organization_id: string;
  description: string;
  assigned_to?: string;
  assignee_name?: string;
  due_date?: string;
  status: string;
  priority: number;
  completed_at?: string;
  completion_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingsSummary {
  total_meetings: number;
  meetings_this_month: number;
  open_action_items: number;
  pending_approval: number;
}

export const meetingsService = {
  async getMeetings(params?: { meeting_type?: string; status?: string; search?: string; skip?: number; limit?: number }): Promise<{ meetings: MeetingRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get('/meetings', { params });
    return response.data;
  },

  async createMeeting(data: Record<string, unknown>): Promise<MeetingRecord> {
    const response = await api.post<MeetingRecord>('/meetings', data);
    return response.data;
  },

  async getMeeting(meetingId: string): Promise<MeetingRecord> {
    const response = await api.get<MeetingRecord>(`/meetings/${meetingId}`);
    return response.data;
  },

  async updateMeeting(meetingId: string, data: Record<string, unknown>): Promise<MeetingRecord> {
    const response = await api.patch<MeetingRecord>(`/meetings/${meetingId}`, data);
    return response.data;
  },

  async deleteMeeting(meetingId: string): Promise<void> {
    await api.delete(`/meetings/${meetingId}`);
  },

  async approveMeeting(meetingId: string): Promise<MeetingRecord> {
    const response = await api.post<MeetingRecord>(`/meetings/${meetingId}/approve`);
    return response.data;
  },

  async addAttendee(meetingId: string, data: { user_id: string; present?: boolean; excused?: boolean }): Promise<MeetingAttendee> {
    const response = await api.post<MeetingAttendee>(`/meetings/${meetingId}/attendees`, data);
    return response.data;
  },

  async removeAttendee(meetingId: string, attendeeId: string): Promise<void> {
    await api.delete(`/meetings/${meetingId}/attendees/${attendeeId}`);
  },

  async createActionItem(meetingId: string, data: Record<string, unknown>): Promise<MeetingActionItem> {
    const response = await api.post<MeetingActionItem>(`/meetings/${meetingId}/action-items`, data);
    return response.data;
  },

  async updateActionItem(itemId: string, data: Record<string, unknown>): Promise<MeetingActionItem> {
    const response = await api.patch<MeetingActionItem>(`/meetings/action-items/${itemId}`, data);
    return response.data;
  },

  async deleteActionItem(itemId: string): Promise<void> {
    await api.delete(`/meetings/action-items/${itemId}`);
  },

  async getSummary(): Promise<MeetingsSummary> {
    const response = await api.get<MeetingsSummary>('/meetings/stats/summary');
    return response.data;
  },

  async getOpenActionItems(params?: { assigned_to?: string }): Promise<MeetingActionItem[]> {
    const response = await api.get<MeetingActionItem[]>('/meetings/action-items/open', { params });
    return response.data;
  },

  async getAttendanceDashboard(params?: { period_months?: number; meeting_type?: string }): Promise<Record<string, unknown>> {
    const response = await api.get('/meetings/attendance/dashboard', { params });
    return response.data;
  },

  async grantAttendanceWaiver(meetingId: string, data: { user_id: string; reason: string }): Promise<Record<string, unknown>> {
    const response = await api.post(`/meetings/${meetingId}/attendance-waiver`, data);
    return response.data;
  },

  async getAttendanceWaivers(meetingId: string): Promise<Array<Record<string, unknown>>> {
    const response = await api.get(`/meetings/${meetingId}/attendance-waivers`);
    return response.data;
  },
};

// Minutes Detail Service — uses the /minutes-records API
// Used by MinutesDetailPage for full minutes CRUD, motions, action items, and workflow
export const minutesService = {
  async getMinutes(minutesId: string): Promise<import('../types/minutes').MeetingMinutes> {
    const response = await api.get<import('../types/minutes').MeetingMinutes>(`/minutes-records/${minutesId}`);
    return response.data;
  },

  async updateMinutes(minutesId: string, data: Record<string, unknown>): Promise<import('../types/minutes').MeetingMinutes> {
    const response = await api.put<import('../types/minutes').MeetingMinutes>(`/minutes-records/${minutesId}`, data);
    return response.data;
  },

  async deleteMinutes(minutesId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}`);
  },

  async publishMinutes(minutesId: string): Promise<void> {
    await api.post(`/minutes-records/${minutesId}/publish`);
  },

  async submitForApproval(minutesId: string): Promise<import('../types/minutes').MeetingMinutes> {
    const response = await api.post<import('../types/minutes').MeetingMinutes>(`/minutes-records/${minutesId}/submit`);
    return response.data;
  },

  async approve(minutesId: string): Promise<import('../types/minutes').MeetingMinutes> {
    const response = await api.post<import('../types/minutes').MeetingMinutes>(`/minutes-records/${minutesId}/approve`);
    return response.data;
  },

  async reject(minutesId: string, reason: string): Promise<import('../types/minutes').MeetingMinutes> {
    const response = await api.post<import('../types/minutes').MeetingMinutes>(`/minutes-records/${minutesId}/reject`, { reason });
    return response.data;
  },

  async addMotion(minutesId: string, data: import('../types/minutes').MotionCreate): Promise<import('../types/minutes').Motion> {
    const response = await api.post<import('../types/minutes').Motion>(`/minutes-records/${minutesId}/motions`, data);
    return response.data;
  },

  async deleteMotion(minutesId: string, motionId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/motions/${motionId}`);
  },

  async addActionItem(minutesId: string, data: import('../types/minutes').ActionItemCreate): Promise<import('../types/minutes').ActionItem> {
    const response = await api.post<import('../types/minutes').ActionItem>(`/minutes-records/${minutesId}/action-items`, data);
    return response.data;
  },

  async updateActionItem(minutesId: string, itemId: string, data: Record<string, unknown>): Promise<import('../types/minutes').ActionItem> {
    const response = await api.put<import('../types/minutes').ActionItem>(`/minutes-records/${minutesId}/action-items/${itemId}`, data);
    return response.data;
  },

  async deleteActionItem(minutesId: string, itemId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/action-items/${itemId}`);
  },
};

// ============================================
// Scheduling Service
// ============================================

export interface ShiftRecord {
  id: string;
  organization_id: string;
  shift_date: string;
  start_time: string;
  end_time?: string;
  apparatus_id?: string;
  station_id?: string;
  shift_officer_id?: string;
  shift_officer_name?: string;
  notes?: string;
  activities?: unknown;
  attendee_count: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
  attendees?: ShiftAttendanceRecord[];
}

export interface ShiftAttendanceRecord {
  id: string;
  shift_id: string;
  user_id: string;
  user_name?: string;
  checked_in_at?: string;
  checked_out_at?: string;
  duration_minutes?: number;
  created_at: string;
}

export interface SchedulingSummary {
  total_shifts: number;
  shifts_this_week: number;
  shifts_this_month: number;
  total_hours_this_month: number;
}

export const schedulingService = {
  async getShifts(params?: { start_date?: string; end_date?: string; skip?: number; limit?: number }): Promise<{ shifts: ShiftRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get('/scheduling/shifts', { params });
    return response.data;
  },

  async createShift(data: Record<string, unknown>): Promise<ShiftRecord> {
    const response = await api.post<ShiftRecord>('/scheduling/shifts', data);
    return response.data;
  },

  async getShift(shiftId: string): Promise<ShiftRecord> {
    const response = await api.get<ShiftRecord>(`/scheduling/shifts/${shiftId}`);
    return response.data;
  },

  async updateShift(shiftId: string, data: Record<string, unknown>): Promise<ShiftRecord> {
    const response = await api.patch<ShiftRecord>(`/scheduling/shifts/${shiftId}`, data);
    return response.data;
  },

  async deleteShift(shiftId: string): Promise<void> {
    await api.delete(`/scheduling/shifts/${shiftId}`);
  },

  async addAttendance(shiftId: string, data: Record<string, unknown>): Promise<ShiftAttendanceRecord> {
    const response = await api.post<ShiftAttendanceRecord>(`/scheduling/shifts/${shiftId}/attendance`, data);
    return response.data;
  },

  async getWeekCalendar(weekStart?: string): Promise<ShiftRecord[]> {
    const params: Record<string, string> = {};
    if (weekStart) params.week_start = weekStart;
    const response = await api.get<ShiftRecord[]>('/scheduling/calendar/week', { params });
    return response.data;
  },

  async getMonthCalendar(year?: number, month?: number): Promise<ShiftRecord[]> {
    const params: Record<string, number> = {};
    if (year) params.year = year;
    if (month) params.month = month;
    const response = await api.get<ShiftRecord[]>('/scheduling/calendar/month', { params });
    return response.data;
  },

  async getSummary(): Promise<SchedulingSummary> {
    const response = await api.get<SchedulingSummary>('/scheduling/summary');
    return response.data;
  },

  async getMyShifts(params?: { start_date?: string; end_date?: string; skip?: number; limit?: number }): Promise<{ shifts: ShiftRecord[]; total: number }> {
    const response = await api.get('/scheduling/my-shifts', { params });
    return response.data;
  },

  async getMyAssignments(): Promise<Array<{ id: string; user_id: string; shift_id: string; position: string; status: string; assignment_status: string; shift?: ShiftRecord }>> {
    const response = await api.get('/scheduling/my-assignments');
    // Backend returns assignment_status; provide status alias for convenience
    return (response.data || []).map((a: Record<string, unknown>) => ({
      ...a,
      status: a.assignment_status ?? a.status,
    }));
  },
};

// ============================================
// Reports Service
// ============================================

export const reportsService = {
  async getAvailableReports(): Promise<{ available_reports: Array<{ id: string; title: string; description: string; category: string; available: boolean }> }> {
    const response = await api.get('/reports/available');
    return response.data;
  },

  async generateReport(data: { report_type: string; start_date?: string; end_date?: string; filters?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const response = await api.post('/reports/generate', data);
    return response.data;
  },
};

// ============================================
// Notifications Service
// ============================================

export interface NotificationRuleRecord {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  trigger: string;
  category: string;
  channel: string;
  enabled: boolean;
  config?: unknown;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface NotificationLogRecord {
  id: string;
  organization_id: string;
  rule_id?: string;
  rule_name?: string;
  recipient_id?: string;
  recipient_email?: string;
  recipient_name?: string;
  channel: string;
  subject?: string;
  message?: string;
  sent_at: string;
  delivered: boolean;
  read: boolean;
  read_at?: string;
  error?: string;
  created_at: string;
}

export interface NotificationsSummary {
  total_rules: number;
  active_rules: number;
  emails_sent_this_month: number;
  notifications_sent_this_month: number;
}

export const notificationsService = {
  async getRules(params?: { category?: string; enabled?: boolean; search?: string }): Promise<{ rules: NotificationRuleRecord[]; total: number }> {
    const response = await api.get('/notifications/rules', { params });
    return response.data;
  },

  async createRule(data: Record<string, unknown>): Promise<NotificationRuleRecord> {
    const response = await api.post<NotificationRuleRecord>('/notifications/rules', data);
    return response.data;
  },

  async getRule(ruleId: string): Promise<NotificationRuleRecord> {
    const response = await api.get<NotificationRuleRecord>(`/notifications/rules/${ruleId}`);
    return response.data;
  },

  async updateRule(ruleId: string, data: Record<string, unknown>): Promise<NotificationRuleRecord> {
    const response = await api.patch<NotificationRuleRecord>(`/notifications/rules/${ruleId}`, data);
    return response.data;
  },

  async deleteRule(ruleId: string): Promise<void> {
    await api.delete(`/notifications/rules/${ruleId}`);
  },

  async toggleRule(ruleId: string, enabled: boolean): Promise<NotificationRuleRecord> {
    const response = await api.post<NotificationRuleRecord>(`/notifications/rules/${ruleId}/toggle`, null, { params: { enabled } });
    return response.data;
  },

  async getLogs(params?: { channel?: string; skip?: number; limit?: number }): Promise<{ logs: NotificationLogRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get('/notifications/logs', { params });
    return response.data;
  },

  async markAsRead(logId: string): Promise<NotificationLogRecord> {
    const response = await api.post<NotificationLogRecord>(`/notifications/logs/${logId}/read`);
    return response.data;
  },

  async getSummary(): Promise<NotificationsSummary> {
    const response = await api.get<NotificationsSummary>('/notifications/summary');
    return response.data;
  },
};

export interface DashboardStats {
  total_members: number;
  active_members: number;
  total_documents: number;
  setup_percentage: number;
  recent_events_count: number;
  pending_tasks_count: number;
}

export const dashboardService = {
  /**
   * Get dashboard statistics
   */
  async getStats(): Promise<DashboardStats> {
    const response = await api.get<DashboardStats>('/dashboard/stats');
    return response.data;
  },
};

// ============================================
// Email Templates Service
// ============================================

export interface EmailTemplate {
  id: string;
  organization_id: string;
  template_type: string;
  name: string;
  subject: string;
  html_body: string;
  text_body?: string;
  css_styles?: string;
  allow_attachments: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  id: string;
  template_id: string;
  filename: string;
  content_type: string;
  file_size: string;
  created_at: string;
}

export interface EmailTemplateUpdate {
  subject?: string;
  html_body?: string;
  text_body?: string;
  css_styles?: string;
  is_active?: boolean;
}

export interface EmailTemplatePreview {
  subject: string;
  html_body: string;
  text_body: string;
}

export const emailTemplatesService = {
  async getTemplates(): Promise<EmailTemplate[]> {
    const response = await api.get<EmailTemplate[]>('/email-templates');
    return response.data;
  },

  async getTemplate(templateId: string): Promise<EmailTemplate> {
    const response = await api.get<EmailTemplate>(`/email-templates/${templateId}`);
    return response.data;
  },

  async updateTemplate(templateId: string, data: EmailTemplateUpdate): Promise<EmailTemplate> {
    const response = await api.put<EmailTemplate>(`/email-templates/${templateId}`, data);
    return response.data;
  },

  async previewTemplate(templateId: string, context?: Record<string, unknown>, overrides?: { subject?: string; html_body?: string; css_styles?: string }): Promise<EmailTemplatePreview> {
    const response = await api.post<EmailTemplatePreview>(`/email-templates/${templateId}/preview`, {
      context: context || {},
      ...overrides,
    });
    return response.data;
  },

  async uploadAttachment(templateId: string, file: File): Promise<EmailAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<EmailAttachment>(`/email-templates/${templateId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteAttachment(templateId: string, attachmentId: string): Promise<void> {
    await api.delete(`/email-templates/${templateId}/attachments/${attachmentId}`);
  },
};

// ============================================
// Locations Service
// ============================================

export interface Location {
  id: string;
  organization_id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocationCreate {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
}

export const locationsService = {
  async getLocations(params?: { is_active?: boolean; skip?: number; limit?: number }): Promise<Location[]> {
    const response = await api.get<Location[]>('/locations', { params });
    return response.data;
  },

  async getLocation(locationId: string): Promise<Location> {
    const response = await api.get<Location>(`/locations/${locationId}`);
    return response.data;
  },

  async createLocation(data: LocationCreate): Promise<Location> {
    const response = await api.post<Location>('/locations', data);
    return response.data;
  },

  async updateLocation(locationId: string, data: Partial<LocationCreate>): Promise<Location> {
    const response = await api.patch<Location>(`/locations/${locationId}`, data);
    return response.data;
  },

  async deleteLocation(locationId: string): Promise<void> {
    await api.delete(`/locations/${locationId}`);
  },
};

// ============================================
// Security Monitoring Service
// ============================================

export interface SecurityStatus {
  timestamp: string;
  overall_status: string;
  alerts: {
    total_last_hour: number;
    by_severity: Record<string, number>;
  };
  metrics: Record<string, unknown>;
}

export interface SecurityAlert {
  id: string;
  alert_type: string;
  threat_level: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export const securityService = {
  async getStatus(): Promise<SecurityStatus> {
    const response = await api.get<SecurityStatus>('/security/status');
    return response.data;
  },

  async getAlerts(params?: { limit?: number; threat_level?: string; alert_type?: string }): Promise<{ alerts: SecurityAlert[]; total: number }> {
    const response = await api.get<{ alerts: SecurityAlert[]; total: number }>('/security/alerts', { params });
    return response.data;
  },

  async acknowledgeAlert(alertId: string): Promise<{ status: string; alert_id: string }> {
    const response = await api.post<{ status: string; alert_id: string }>(`/security/alerts/${alertId}/acknowledge`);
    return response.data;
  },

  async verifyAuditIntegrity(params?: { start_id?: number; end_id?: number }): Promise<{ verified: boolean; total_checked: number; errors: string[] }> {
    const response = await api.get<{ verified: boolean; total_checked: number; errors: string[] }>('/security/audit-log/integrity', { params });
    return response.data;
  },

  async triggerManualCheck(): Promise<{ check_completed: boolean; overall_status: string; integrity: Record<string, unknown> }> {
    const response = await api.post<{ check_completed: boolean; overall_status: string; integrity: Record<string, unknown> }>('/security/manual-check');
    return response.data;
  },
};

// ============================================
// Training Sessions Service
// ============================================

export interface TrainingSessionResponse {
  id: string;
  organization_id: string;
  event_id: string;
  course_id?: string;
  category_id?: string;
  program_id?: string;
  phase_id?: string;
  requirement_id?: string;
  course_name: string;
  course_code?: string;
  training_type: string;
  credit_hours: number;
  instructor?: string;
  issues_certification: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;
  auto_create_records: boolean;
  require_completion_confirmation: boolean;
  approval_required: boolean;
  approval_deadline_days: number;
  is_finalized: boolean;
  finalized_at?: string;
  finalized_by?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingSessionCreate {
  title: string;
  description?: string;
  location_id?: string;
  location?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  is_mandatory?: boolean;
  eligible_roles?: string[];
  check_in_window_type?: string;
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  use_existing_course?: boolean;
  course_id?: string;
  category_id?: string;
  program_id?: string;
  phase_id?: string;
  requirement_id?: string;
  course_name?: string;
  course_code?: string;
  training_type: string;
  credit_hours: number;
  instructor?: string;
  issues_certification?: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;
  auto_create_records?: boolean;
  require_completion_confirmation?: boolean;
  approval_required?: boolean;
  approval_deadline_days?: number;
}

export const trainingSessionService = {
  async getCalendar(params?: { start_after?: string; start_before?: string; training_type?: string; include_finalized?: boolean }): Promise<TrainingSessionResponse[]> {
    const response = await api.get<TrainingSessionResponse[]>('/training/sessions/calendar', { params });
    return response.data;
  },

  async createSession(data: TrainingSessionCreate): Promise<TrainingSessionResponse> {
    const response = await api.post<TrainingSessionResponse>('/training/sessions', data);
    return response.data;
  },

  async finalizeSession(sessionId: string): Promise<{ message: string; approval_id: string }> {
    const response = await api.post<{ message: string; approval_id: string }>(`/training/sessions/${sessionId}/finalize`);
    return response.data;
  },
};

// ============================================
// Training Submissions Service
// ============================================

import type {
  SelfReportConfig,
  SelfReportConfigUpdate,
  TrainingSubmission,
  TrainingSubmissionCreate,
  TrainingSubmissionUpdate,
  SubmissionReviewRequest,
} from '../types/training';

export const trainingSubmissionService = {
  // Config
  async getConfig(): Promise<SelfReportConfig> {
    const response = await api.get<SelfReportConfig>('/training/submissions/config');
    return response.data;
  },

  async updateConfig(updates: SelfReportConfigUpdate): Promise<SelfReportConfig> {
    const response = await api.put<SelfReportConfig>('/training/submissions/config', updates);
    return response.data;
  },

  // Member submissions
  async createSubmission(data: TrainingSubmissionCreate): Promise<TrainingSubmission> {
    const response = await api.post<TrainingSubmission>('/training/submissions', data);
    return response.data;
  },

  async getMySubmissions(status?: string): Promise<TrainingSubmission[]> {
    const response = await api.get<TrainingSubmission[]>('/training/submissions/my', {
      params: status ? { status } : undefined,
    });
    return response.data;
  },

  async getSubmission(submissionId: string): Promise<TrainingSubmission> {
    const response = await api.get<TrainingSubmission>(`/training/submissions/${submissionId}`);
    return response.data;
  },

  async updateSubmission(submissionId: string, updates: TrainingSubmissionUpdate): Promise<TrainingSubmission> {
    const response = await api.patch<TrainingSubmission>(`/training/submissions/${submissionId}`, updates);
    return response.data;
  },

  async deleteSubmission(submissionId: string): Promise<void> {
    await api.delete(`/training/submissions/${submissionId}`);
  },

  // Officer review
  async getPendingSubmissions(): Promise<TrainingSubmission[]> {
    const response = await api.get<TrainingSubmission[]>('/training/submissions/pending');
    return response.data;
  },

  async getPendingCount(): Promise<{ pending_count: number }> {
    const response = await api.get<{ pending_count: number }>('/training/submissions/pending/count');
    return response.data;
  },

  async getAllSubmissions(params?: { status?: string; user_id?: string; limit?: number; offset?: number }): Promise<TrainingSubmission[]> {
    const response = await api.get<TrainingSubmission[]>('/training/submissions/all', { params });
    return response.data;
  },

  async reviewSubmission(submissionId: string, review: SubmissionReviewRequest): Promise<TrainingSubmission> {
    const response = await api.post<TrainingSubmission>(`/training/submissions/${submissionId}/review`, review);
    return response.data;
  },
};

// ============================================
// Shift Completion Reports Service
// ============================================

export const shiftCompletionService = {
  async createReport(data: import('../types/training').ShiftCompletionReportCreate): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post('/training/shift-reports', data);
    return response.data;
  },

  async getMyReports(params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get('/training/shift-reports/my-reports', { params });
    return response.data;
  },

  async getMyStats(params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').TraineeShiftStats> {
    const response = await api.get('/training/shift-reports/my-stats', { params });
    return response.data;
  },

  async getReportsByOfficer(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get('/training/shift-reports/by-officer');
    return response.data;
  },

  async getReportsForTrainee(traineeId: string, params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get(`/training/shift-reports/trainee/${traineeId}`, { params });
    return response.data;
  },

  async getTraineeStats(traineeId: string, params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').TraineeShiftStats> {
    const response = await api.get(`/training/shift-reports/trainee/${traineeId}/stats`, { params });
    return response.data;
  },

  async getAllReports(params?: { trainee_id?: string; officer_id?: string; start_date?: string; end_date?: string; limit?: number; offset?: number }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get('/training/shift-reports/all', { params });
    return response.data;
  },

  async getReport(reportId: string): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.get(`/training/shift-reports/${reportId}`);
    return response.data;
  },

  async acknowledgeReport(reportId: string, comments?: string): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post(`/training/shift-reports/${reportId}/acknowledge`, { trainee_comments: comments });
    return response.data;
  },
};

// ============================================
// Training Module Config Service
// ============================================

export const trainingModuleConfigService = {
  async getConfig(): Promise<import('../types/training').TrainingModuleConfig> {
    const response = await api.get('/training/module-config/config');
    return response.data;
  },

  async updateConfig(updates: Partial<import('../types/training').TrainingModuleConfig>): Promise<import('../types/training').TrainingModuleConfig> {
    const response = await api.put('/training/module-config/config', updates);
    return response.data;
  },

  async getVisibility(): Promise<import('../types/training').MemberVisibility> {
    const response = await api.get('/training/module-config/visibility');
    return response.data;
  },

  async getMyTraining(): Promise<import('../types/training').MyTrainingSummary> {
    const response = await api.get('/training/module-config/my-training');
    return response.data;
  },
};

// ============================================
// Integrations Service
// ============================================

export interface IntegrationConfig {
  id: string;
  organization_id: string;
  integration_type: string;
  name: string;
  description?: string;
  category?: string;
  status: 'available' | 'connected' | 'error' | 'coming_soon';
  config: Record<string, unknown>;
  enabled: boolean;
  last_sync_at?: string;
  created_at: string;
  updated_at: string;
}

export const integrationsService = {
  async getIntegrations(): Promise<IntegrationConfig[]> {
    const response = await api.get<IntegrationConfig[]>('/integrations');
    return response.data;
  },

  async getIntegration(integrationId: string): Promise<IntegrationConfig> {
    const response = await api.get<IntegrationConfig>(`/integrations/${integrationId}`);
    return response.data;
  },

  async connectIntegration(integrationId: string, config: Record<string, unknown>): Promise<IntegrationConfig> {
    const response = await api.post<IntegrationConfig>(`/integrations/${integrationId}/connect`, config);
    return response.data;
  },

  async disconnectIntegration(integrationId: string): Promise<void> {
    await api.post(`/integrations/${integrationId}/disconnect`);
  },

  async updateIntegration(integrationId: string, config: Record<string, unknown>): Promise<IntegrationConfig> {
    const response = await api.patch<IntegrationConfig>(`/integrations/${integrationId}`, config);
    return response.data;
  },
};

// ============================================
// Analytics API Service (backend-persisted)
// ============================================

export interface AnalyticsEventRecord {
  id: string;
  event_type: string;
  event_id: string;
  user_id?: string;
  metadata: Record<string, unknown>;
  device_type: string;
  created_at: string;
}

export interface AnalyticsMetrics {
  total_scans: number;
  successful_check_ins: number;
  failed_check_ins: number;
  success_rate: number;
  avg_time_to_check_in: number;
  device_breakdown: Record<string, number>;
  error_breakdown: Record<string, number>;
  hourly_activity: Array<{ hour: number; count: number }>;
}

export const analyticsApiService = {
  async trackEvent(data: { event_type: string; event_id: string; user_id?: string; metadata: Record<string, unknown> }): Promise<void> {
    await api.post('/analytics/track', data);
  },

  async getMetrics(eventId?: string): Promise<AnalyticsMetrics> {
    const response = await api.get<AnalyticsMetrics>('/analytics/metrics', {
      params: eventId ? { event_id: eventId } : undefined,
    });
    return response.data;
  },

  async exportAnalytics(eventId?: string): Promise<string> {
    const response = await api.get('/analytics/export', {
      params: eventId ? { event_id: eventId } : undefined,
    });
    return JSON.stringify(response.data, null, 2);
  },
};

// ============================================
// Error Logs Service (backend-persisted)
// ============================================

export interface ErrorLogRecord {
  id: string;
  error_type: string;
  error_message: string;
  user_message: string;
  troubleshooting_steps: string[];
  context: Record<string, unknown>;
  user_id?: string;
  event_id?: string;
  created_at: string;
}

export interface ErrorLogStats {
  total: number;
  by_type: Record<string, number>;
  recent_errors: ErrorLogRecord[];
}

export const errorLogsService = {
  async logError(data: {
    error_type: string;
    error_message: string;
    user_message: string;
    context: Record<string, unknown>;
    event_id?: string;
  }): Promise<void> {
    await api.post('/errors/log', data);
  },

  async getErrors(params?: { error_type?: string; event_id?: string; skip?: number; limit?: number }): Promise<{ errors: ErrorLogRecord[]; total: number }> {
    const response = await api.get<{ errors: ErrorLogRecord[]; total: number }>('/errors', { params });
    return response.data;
  },

  async getStats(): Promise<ErrorLogStats> {
    const response = await api.get<ErrorLogStats>('/errors/stats');
    return response.data;
  },

  async clearErrors(): Promise<void> {
    await api.delete('/errors');
  },

  async exportErrors(params?: { event_id?: string }): Promise<string> {
    const response = await api.get('/errors/export', { params });
    return JSON.stringify(response.data, null, 2);
  },
};

// ============================================
// Facilities Service
// ============================================

export const facilitiesService = {
  // Facility Types
  async getTypes(): Promise<Array<Record<string, unknown>>> {
    const response = await api.get('/facilities/types');
    return response.data;
  },
  async createType(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post('/facilities/types', data);
    return response.data;
  },
  async updateType(typeId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch(`/facilities/types/${typeId}`, data);
    return response.data;
  },
  async deleteType(typeId: string): Promise<void> {
    await api.delete(`/facilities/types/${typeId}`);
  },

  // Facility Statuses
  async getStatuses(): Promise<Array<Record<string, unknown>>> {
    const response = await api.get('/facilities/statuses');
    return response.data;
  },
  async createStatus(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post('/facilities/statuses', data);
    return response.data;
  },
  async updateStatus(statusId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch(`/facilities/statuses/${statusId}`, data);
    return response.data;
  },
  async deleteStatus(statusId: string): Promise<void> {
    await api.delete(`/facilities/statuses/${statusId}`);
  },

  // Facilities CRUD
  async getFacilities(params?: { facility_type_id?: string; status_id?: string; is_archived?: boolean; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get('/facilities', { params });
    return response.data;
  },
  async getFacility(facilityId: string): Promise<Record<string, unknown>> {
    const response = await api.get(`/facilities/${facilityId}`);
    return response.data;
  },
  async createFacility(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post('/facilities', data);
    return response.data;
  },
  async updateFacility(facilityId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch(`/facilities/${facilityId}`, data);
    return response.data;
  },
  async archiveFacility(facilityId: string): Promise<Record<string, unknown>> {
    const response = await api.post(`/facilities/${facilityId}/archive`);
    return response.data;
  },
  async restoreFacility(facilityId: string): Promise<Record<string, unknown>> {
    const response = await api.post(`/facilities/${facilityId}/restore`);
    return response.data;
  },

  // Maintenance
  async getMaintenanceRecords(params?: { facility_id?: string; status?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get('/facilities/maintenance', { params });
    return response.data;
  },
  async getMaintenanceRecord(recordId: string): Promise<Record<string, unknown>> {
    const response = await api.get(`/facilities/maintenance/${recordId}`);
    return response.data;
  },
  async createMaintenanceRecord(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post('/facilities/maintenance', data);
    return response.data;
  },
  async updateMaintenanceRecord(recordId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch(`/facilities/maintenance/${recordId}`, data);
    return response.data;
  },
  async deleteMaintenanceRecord(recordId: string): Promise<void> {
    await api.delete(`/facilities/maintenance/${recordId}`);
  },

  // Inspections
  async getInspections(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get('/facilities/inspections', { params });
    return response.data;
  },
  async getInspection(inspectionId: string): Promise<Record<string, unknown>> {
    const response = await api.get(`/facilities/inspections/${inspectionId}`);
    return response.data;
  },
  async createInspection(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post('/facilities/inspections', data);
    return response.data;
  },
  async updateInspection(inspectionId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch(`/facilities/inspections/${inspectionId}`, data);
    return response.data;
  },
  async deleteInspection(inspectionId: string): Promise<void> {
    await api.delete(`/facilities/inspections/${inspectionId}`);
  },

  // Rooms
  async getRooms(params?: { facility_id?: string; skip?: number; limit?: number }): Promise<Array<Record<string, unknown>>> {
    const response = await api.get('/facilities/rooms', { params });
    return response.data;
  },
  async createRoom(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post('/facilities/rooms', data);
    return response.data;
  },
  async updateRoom(roomId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch(`/facilities/rooms/${roomId}`, data);
    return response.data;
  },
  async deleteRoom(roomId: string): Promise<void> {
    await api.delete(`/facilities/rooms/${roomId}`);
  },
};
