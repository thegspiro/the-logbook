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
} from '../types/event';

const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
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
    const response = await api.post<{ message: string }>('/auth/password-reset/request', data);
    return response.data;
  },

  /**
   * Confirm password reset with token
   */
  async confirmPasswordReset(data: PasswordResetConfirm): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/password-reset/confirm', data);
    return response.data;
  },

  /**
   * Validate password reset token
   */
  async validateResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    const response = await api.get<{ valid: boolean; email?: string }>(`/auth/password-reset/validate/${token}`);
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
   * Delete an election
   */
  async deleteElection(electionId: string): Promise<void> {
    await api.delete(`/elections/${electionId}`);
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
  async getCheckInMonitoring(eventId: string): Promise<any> {
    const response = await api.get(`/events/${eventId}/check-in-monitoring`);
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
    const response = await api.get<FormsListResponse>('/forms/', { params });
    return response.data;
  },

  async getForm(formId: string): Promise<FormDetailDef> {
    const response = await api.get<FormDetailDef>(`/forms/${formId}`);
    return response.data;
  },

  async createForm(data: FormCreate): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>('/forms/', data);
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
