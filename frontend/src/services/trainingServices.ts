/**
 * trainingServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { SkillTemplate, SkillTemplateCreate, SkillTemplateListItem, SkillTemplateUpdate, SkillTest, SkillTestCreate, SkillTestListItem, SkillTestUpdate, SkillTestingSummary } from '../types/skillsTesting';
import type { BulkEnrollmentRequest, BulkEnrollmentResponse, BulkImportRequest, BulkImportResponse, BulkTrainingRecordCreate, BulkTrainingRecordResult, ComplianceSummary, ExternalCategoryMapping, ExternalCategoryMappingUpdate, ExternalTrainingImport, ExternalTrainingProvider, ExternalTrainingProviderCreate, ExternalTrainingProviderUpdate, ExternalTrainingSyncLog, ExternalUserMapping, ExternalUserMappingUpdate, HistoricalImportConfirmRequest, HistoricalImportParseResponse, HistoricalImportResult, ImportRecordRequest, MemberProgramProgress, ProgramEnrollment, ProgramEnrollmentCreate, ProgramMilestone, ProgramMilestoneCreate, ProgramPhase, ProgramPhaseCreate, ProgramRequirement, ProgramRequirementCreate, ProgramWithDetails, RegistryImportResult, RegistryInfo, RequirementProgress, RequirementProgressRecord, RequirementProgressUpdate, SyncRequest, SyncResponse, TestConnectionResponse, TrainingCategory, TrainingCategoryCreate, TrainingCategoryUpdate, TrainingCourse, TrainingCourseCreate, TrainingCourseUpdate, TrainingProgram, TrainingProgramCreate, TrainingRecord, TrainingRecordCreate, TrainingRecordUpdate, TrainingReport, TrainingRequirement, TrainingRequirementCreate, TrainingRequirementEnhanced, TrainingRequirementEnhancedCreate, TrainingRequirementUpdate, UserTrainingStats } from '../types/training';
import type { ComplianceMatrix, ExpiringCertification } from './communicationsServices';
import type { TrainingSessionResponse, TrainingSessionCreate, RecurringTrainingSessionCreate } from './adminServices';

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
   * Create training records for multiple members at once (bulk)
   */
  async createRecordsBulk(payload: BulkTrainingRecordCreate): Promise<BulkTrainingRecordResult> {
    const response = await api.post<BulkTrainingRecordResult>('/training/records/bulk', payload);
    return response.data;
  },

  /**
   * Import training records from a CSV file
   */
  async importCSV(file: File): Promise<{ success: number; failed: number; errors: Array<{ row: number; error: string }> }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<{ success: number; failed: number; errors: Array<{ row: number; error: string }> }>('/training/records/import-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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
   * Permanently delete a training requirement
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
   * Get compliance summary for a member's profile card
   */
  async getComplianceSummary(userId: string): Promise<ComplianceSummary> {
    const response = await api.get<ComplianceSummary>(`/training/compliance-summary/${userId}`);
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

  async getComplianceMatrix(): Promise<ComplianceMatrix> {
    const response = await api.get<ComplianceMatrix>('/training/compliance-matrix');
    return response.data;
  },

  async getExpiringCertificationsDetailed(days: number = 90): Promise<ExpiringCertification[]> {
    const response = await api.get<ExpiringCertification[]>('/training/expiring-certifications', {
      params: { days },
    });
    return response.data;
  },

  // ==================== Historical Training Import ====================

  async parseHistoricalImport(file: File, matchBy: 'email' | 'membership_number' = 'membership_number'): Promise<HistoricalImportParseResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<HistoricalImportParseResponse>(
      '/training/import/parse',
      formData,
      { params: { match_by: matchBy }, headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  async confirmHistoricalImport(request: HistoricalImportConfirmRequest): Promise<HistoricalImportResult> {
    const response = await api.post<HistoricalImportResult>(
      '/training/import/confirm',
      request
    );
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

  /**
   * Fetch training categories from the external provider and create mappings
   */
  async syncCategories(providerId: string): Promise<{ success: boolean; message: string; created: number; existing: number }> {
    const response = await api.post<{ success: boolean; message: string; created: number; existing: number }>(
      `/training/external/providers/${providerId}/sync-categories`
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
   * List available registries with metadata
   */
  async getRegistries(): Promise<RegistryInfo[]> {
    const response = await api.get<RegistryInfo[]>('/training/programs/requirements/registries');
    return response.data;
  },

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

export const trainingSessionService = {
  async getCalendar(params?: { start_after?: string; start_before?: string; training_type?: string; include_finalized?: boolean }): Promise<TrainingSessionResponse[]> {
    const response = await api.get<TrainingSessionResponse[]>('/training/sessions/calendar', { params });
    return response.data;
  },

  async createSession(data: TrainingSessionCreate): Promise<TrainingSessionResponse> {
    const response = await api.post<TrainingSessionResponse>('/training/sessions', data);
    return response.data;
  },

  async createRecurringSessions(data: RecurringTrainingSessionCreate): Promise<TrainingSessionResponse[]> {
    const response = await api.post<TrainingSessionResponse[]>('/training/sessions/recurring', data);
    return response.data;
  },

  async finalizeSession(sessionId: string): Promise<{ message: string; approval_id: string }> {
    const response = await api.post<{ message: string; approval_id: string }>(`/training/sessions/${sessionId}/finalize`);
    return response.data;
  },

  async getApprovalData(token: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(`/training/sessions/approve/${token}`);
    return response.data;
  },

  async submitApproval(token: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/training/sessions/approve/${token}`, data);
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

  async getAllSubmissions(params?: { status?: string | undefined; user_id?: string; limit?: number; offset?: number }): Promise<TrainingSubmission[]> {
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

export const trainingModuleConfigService = {
  async getConfig(): Promise<import('../types/training').TrainingModuleConfig> {
    const response = await api.get<import('../types/training').TrainingModuleConfig>('/training/module-config/config');
    return response.data;
  },

  async updateConfig(updates: Partial<import('../types/training').TrainingModuleConfig>): Promise<import('../types/training').TrainingModuleConfig> {
    const response = await api.put<import('../types/training').TrainingModuleConfig>('/training/module-config/config', updates);
    return response.data;
  },

  async getVisibility(): Promise<import('../types/training').MemberVisibility> {
    const response = await api.get<import('../types/training').MemberVisibility>('/training/module-config/visibility');
    return response.data;
  },

  async getMyTraining(): Promise<import('../types/training').MyTrainingSummary> {
    const response = await api.get<import('../types/training').MyTrainingSummary>('/training/module-config/my-training');
    return response.data;
  },

  async getSkillNames(): Promise<{ id: string; name: string; category: string | null }[]> {
    const response = await api.get<{ id: string; name: string; category: string | null }[]>('/training/module-config/skill-names');
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
  contains_phi?: boolean;
  last_sync_at?: string;
  created_at: string;
  updated_at: string;
}

export const skillsTestingService = {
  // Templates
  async getTemplates(params?: { status?: string; category?: string }): Promise<SkillTemplateListItem[]> {
    const response = await api.get<SkillTemplateListItem[]>('/training/skills-testing/templates', { params });
    return response.data;
  },

  async getTemplate(templateId: string): Promise<SkillTemplate> {
    const response = await api.get<SkillTemplate>(`/training/skills-testing/templates/${templateId}`);
    return response.data;
  },

  async createTemplate(data: SkillTemplateCreate): Promise<SkillTemplate> {
    const response = await api.post<SkillTemplate>('/training/skills-testing/templates', data);
    return response.data;
  },

  async updateTemplate(templateId: string, data: SkillTemplateUpdate): Promise<SkillTemplate> {
    const response = await api.put<SkillTemplate>(`/training/skills-testing/templates/${templateId}`, data);
    return response.data;
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`/training/skills-testing/templates/${templateId}`);
  },

  async publishTemplate(templateId: string): Promise<SkillTemplate> {
    const response = await api.post<SkillTemplate>(`/training/skills-testing/templates/${templateId}/publish`);
    return response.data;
  },

  async duplicateTemplate(templateId: string): Promise<SkillTemplate> {
    const response = await api.post<SkillTemplate>(`/training/skills-testing/templates/${templateId}/duplicate`);
    return response.data;
  },

  // Tests
  async getTests(params?: { status?: string; candidate_id?: string; template_id?: string }): Promise<SkillTestListItem[]> {
    const response = await api.get<SkillTestListItem[]>('/training/skills-testing/tests', { params });
    return response.data;
  },

  async getTest(testId: string): Promise<SkillTest> {
    const response = await api.get<SkillTest>(`/training/skills-testing/tests/${testId}`);
    return response.data;
  },

  async createTest(data: SkillTestCreate): Promise<SkillTest> {
    const response = await api.post<SkillTest>('/training/skills-testing/tests', data);
    return response.data;
  },

  async updateTest(testId: string, data: SkillTestUpdate): Promise<SkillTest> {
    const response = await api.put<SkillTest>(`/training/skills-testing/tests/${testId}`, data);
    return response.data;
  },

  async completeTest(testId: string): Promise<SkillTest> {
    const response = await api.post<SkillTest>(`/training/skills-testing/tests/${testId}/complete`);
    return response.data;
  },

  async deleteTest(testId: string): Promise<void> {
    await api.delete(`/training/skills-testing/tests/${testId}`);
  },

  async discardPracticeTest(testId: string): Promise<void> {
    await api.delete(`/training/skills-testing/tests/${testId}/discard`);
  },

  async emailTestResults(testId: string): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/training/skills-testing/tests/${testId}/email-results`);
    return response.data;
  },

  // Summary
  async getSummary(): Promise<SkillTestingSummary> {
    const response = await api.get<SkillTestingSummary>('/training/skills-testing/summary');
    return response.data;
  },
};

// ==================== Recertification Services ====================

export const recertificationService = {
  async getPathways(activeOnly = true): Promise<import('../types/training').RecertificationPathway[]> {
    const response = await api.get<import('../types/training').RecertificationPathway[]>('/training/recertification/pathways', {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  async createPathway(data: import('../types/training').RecertificationPathwayCreate): Promise<import('../types/training').RecertificationPathway> {
    const response = await api.post<import('../types/training').RecertificationPathway>('/training/recertification/pathways', data);
    return response.data;
  },

  async updatePathway(pathwayId: string, data: import('../types/training').RecertificationPathwayUpdate): Promise<import('../types/training').RecertificationPathway> {
    const response = await api.patch<import('../types/training').RecertificationPathway>(`/training/recertification/pathways/${pathwayId}`, data);
    return response.data;
  },

  async getMyRenewalTasks(status?: string): Promise<import('../types/training').RenewalTask[]> {
    const response = await api.get<import('../types/training').RenewalTask[]>('/training/recertification/tasks/me', {
      params: status ? { status } : undefined,
    });
    return response.data;
  },

  async generateRenewalTasks(): Promise<{ tasks_created: number }> {
    const response = await api.post<{ tasks_created: number }>('/training/recertification/generate-tasks');
    return response.data;
  },
};

// ==================== Competency Services ====================

export const competencyService = {
  async getMatrices(position?: string): Promise<import('../types/training').CompetencyMatrix[]> {
    const response = await api.get<import('../types/training').CompetencyMatrix[]>('/training/competency/matrices', {
      params: position ? { position } : undefined,
    });
    return response.data;
  },

  async createMatrix(data: import('../types/training').CompetencyMatrixCreate): Promise<import('../types/training').CompetencyMatrix> {
    const response = await api.post<import('../types/training').CompetencyMatrix>('/training/competency/matrices', data);
    return response.data;
  },

  async updateMatrix(matrixId: string, data: import('../types/training').CompetencyMatrixUpdate): Promise<import('../types/training').CompetencyMatrix> {
    const response = await api.patch<import('../types/training').CompetencyMatrix>(`/training/competency/matrices/${matrixId}`, data);
    return response.data;
  },

  async getMemberCompetencies(userId: string): Promise<import('../types/training').MemberCompetency[]> {
    const response = await api.get<import('../types/training').MemberCompetency[]>(`/training/competency/members/${userId}`);
    return response.data;
  },

  async getMyCompetencies(): Promise<import('../types/training').MemberCompetency[]> {
    const response = await api.get<import('../types/training').MemberCompetency[]>('/training/competency/me');
    return response.data;
  },
};

// ==================== Instructor Qualification Services ====================

export const instructorService = {
  async getQualifications(params?: { user_id?: string; course_id?: string }): Promise<import('../types/training').InstructorQualification[]> {
    const response = await api.get<import('../types/training').InstructorQualification[]>('/training/instructors/qualifications', { params });
    return response.data;
  },

  async createQualification(data: import('../types/training').InstructorQualificationCreate): Promise<import('../types/training').InstructorQualification> {
    const response = await api.post<import('../types/training').InstructorQualification>('/training/instructors/qualifications', data);
    return response.data;
  },

  async updateQualification(qualId: string, data: import('../types/training').InstructorQualificationUpdate): Promise<import('../types/training').InstructorQualification> {
    const response = await api.patch<import('../types/training').InstructorQualification>(`/training/instructors/qualifications/${qualId}`, data);
    return response.data;
  },

  async getQualifiedInstructors(courseId: string): Promise<import('../types/training').InstructorQualification[]> {
    const response = await api.get<import('../types/training').InstructorQualification[]>(`/training/instructors/qualifications/${courseId}/qualified`);
    return response.data;
  },

  async validateInstructor(userId: string, courseId: string): Promise<{ user_id: string; course_id: string; is_qualified: boolean }> {
    const response = await api.get<{ user_id: string; course_id: string; is_qualified: boolean }>(`/training/instructors/validate/${userId}/${courseId}`);
    return response.data;
  },
};

// ==================== Training Effectiveness Services ====================

export const effectivenessService = {
  async createEvaluation(data: import('../types/training').TrainingEffectivenessCreate): Promise<import('../types/training').TrainingEffectivenessEvaluation> {
    const response = await api.post<import('../types/training').TrainingEffectivenessEvaluation>('/training/effectiveness/evaluations', data);
    return response.data;
  },

  async getEvaluations(params?: { course_id?: string; session_id?: string; level?: string }): Promise<import('../types/training').TrainingEffectivenessEvaluation[]> {
    const response = await api.get<import('../types/training').TrainingEffectivenessEvaluation[]>('/training/effectiveness/evaluations', { params });
    return response.data;
  },

  async getCourseSummary(courseId: string): Promise<import('../types/training').TrainingEffectivenessSummary> {
    const response = await api.get<import('../types/training').TrainingEffectivenessSummary>(`/training/effectiveness/summary/${courseId}`);
    return response.data;
  },
};

// ==================== Multi-Agency Training Services ====================

export const multiAgencyService = {
  async getExercises(params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').MultiAgencyTraining[]> {
    const response = await api.get<import('../types/training').MultiAgencyTraining[]>('/training/multi-agency', { params });
    return response.data;
  },

  async createExercise(data: import('../types/training').MultiAgencyTrainingCreate): Promise<import('../types/training').MultiAgencyTraining> {
    const response = await api.post<import('../types/training').MultiAgencyTraining>('/training/multi-agency', data);
    return response.data;
  },

  async updateExercise(exerciseId: string, data: import('../types/training').MultiAgencyTrainingUpdate): Promise<import('../types/training').MultiAgencyTraining> {
    const response = await api.patch<import('../types/training').MultiAgencyTraining>(`/training/multi-agency/${exerciseId}`, data);
    return response.data;
  },
};

// ==================== xAPI Services ====================

export const xapiService = {
  async ingestStatement(rawStatement: Record<string, unknown>, sourceProviderId?: string): Promise<import('../types/training').XAPIStatement> {
    const response = await api.post<import('../types/training').XAPIStatement>('/training/xapi/statements', {
      raw_statement: rawStatement,
      source_provider_id: sourceProviderId,
    });
    return response.data;
  },

  async ingestBatch(statements: Record<string, unknown>[], sourceProviderId?: string): Promise<import('../types/training').XAPIBatchResponse> {
    const response = await api.post<import('../types/training').XAPIBatchResponse>('/training/xapi/statements/batch', {
      statements,
      source_provider_id: sourceProviderId,
    });
    return response.data;
  },

  async processStatements(): Promise<{ processed: number }> {
    const response = await api.post<{ processed: number }>('/training/xapi/process');
    return response.data;
  },
};

// ==================== Report Export Services ====================

export const reportExportService = {
  async exportReport(data: import('../types/training').ReportExportRequest): Promise<Blob> {
    const response = await api.post('/training/reports/export', data, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  async getComplianceForecast(): Promise<import('../types/training').ComplianceForecast[]> {
    const response = await api.get<import('../types/training').ComplianceForecast[]>('/training/reports/compliance-forecast');
    return response.data;
  },
};

// ==================== Document/Certificate Services ====================

export const documentService = {
  async getRecordAttachments(recordId: string): Promise<{ record_id: string; attachments: string[] }> {
    const response = await api.get<{ record_id: string; attachments: string[] }>(`/training/records/${recordId}/attachments`);
    return response.data;
  },

  async uploadAttachment(recordId: string, file: File): Promise<{ message: string; record_id: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<{ message: string; record_id: string }>(`/training/records/${recordId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};

// ============================================
// Compliance Officer Services
// ============================================

export const complianceOfficerService = {
  async getISOReadiness(year?: number): Promise<import('../types/training').ISOReadiness> {
    const params = year ? { year } : {};
    const response = await api.get<import('../types/training').ISOReadiness>('/compliance/iso-readiness', { params });
    return response.data;
  },

  async createAttestation(data: import('../types/training').AttestationCreate): Promise<import('../types/training').ComplianceAttestation> {
    const response = await api.post<import('../types/training').ComplianceAttestation>('/compliance/attestations', data);
    return response.data;
  },

  async getAttestations(limit = 20): Promise<import('../types/training').ComplianceAttestation[]> {
    const response = await api.get<import('../types/training').ComplianceAttestation[]>('/compliance/attestations', { params: { limit } });
    return response.data;
  },

  async getAnnualReport(year: number): Promise<import('../types/training').AnnualComplianceReport> {
    const response = await api.get<import('../types/training').AnnualComplianceReport>('/compliance/annual-report', { params: { year } });
    return response.data;
  },

  async exportAnnualReport(year: number): Promise<Blob> {
    const response = await api.post('/compliance/annual-report/export', { year, format: 'csv' }, { responseType: 'blob' });
    return response.data as Blob;
  },

  async getRecordCompleteness(startDate?: string, endDate?: string): Promise<import('../types/training').RecordCompleteness> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const response = await api.get<import('../types/training').RecordCompleteness>('/compliance/record-completeness', { params });
    return response.data;
  },

  async getIncompleteRecords(limit = 50): Promise<import('../types/training').IncompleteRecord[]> {
    const response = await api.get<import('../types/training').IncompleteRecord[]>('/compliance/incomplete-records', { params: { limit } });
    return response.data;
  },

  async getContributedHours(year: number): Promise<import('../types/training').ContributedHoursResponse> {
    const response = await api.get<import('../types/training').ContributedHoursResponse>('/compliance/contributed-hours', { params: { year } });
    return response.data;
  },
};

// ============================================
// Compliance Configuration Services
// ============================================

export const complianceConfigService = {
  async getConfig(): Promise<import('../types/training').ComplianceConfigData | null> {
    const response = await api.get<import('../types/training').ComplianceConfigData | null>('/compliance/config');
    return response.data;
  },

  async updateConfig(data: import('../types/training').ComplianceConfigUpdate): Promise<import('../types/training').ComplianceConfigData> {
    const response = await api.put<import('../types/training').ComplianceConfigData>('/compliance/config', data);
    return response.data;
  },

  async initializeConfig(data: import('../types/training').ComplianceConfigUpdate): Promise<import('../types/training').ComplianceConfigData> {
    const response = await api.post<import('../types/training').ComplianceConfigData>('/compliance/config/initialize', data);
    return response.data;
  },

  async getAvailableRequirements(): Promise<{ requirements: import('../types/training').AvailableRequirement[] }> {
    const response = await api.get<{ requirements: import('../types/training').AvailableRequirement[] }>('/compliance/config/requirements');
    return response.data;
  },

  async createProfile(data: import('../types/training').ComplianceProfileCreate): Promise<import('../types/training').ComplianceProfile> {
    const response = await api.post<import('../types/training').ComplianceProfile>('/compliance/config/profiles', data);
    return response.data;
  },

  async updateProfile(profileId: string, data: import('../types/training').ComplianceProfileUpdate): Promise<import('../types/training').ComplianceProfile> {
    const response = await api.put<import('../types/training').ComplianceProfile>(`/compliance/config/profiles/${profileId}`, data);
    return response.data;
  },

  async deleteProfile(profileId: string): Promise<void> {
    await api.delete(`/compliance/config/profiles/${profileId}`);
  },

  async generateReport(data: import('../types/training').ComplianceReportGenerate): Promise<import('../types/training').ComplianceReportDetail> {
    const response = await api.post<import('../types/training').ComplianceReportDetail>('/compliance/reports/generate', data);
    return response.data;
  },

  async listReports(params?: { report_type?: string; year?: number; limit?: number; offset?: number }): Promise<{ reports: import('../types/training').ComplianceReportSummary[]; total: number }> {
    const response = await api.get<{ reports: import('../types/training').ComplianceReportSummary[]; total: number }>('/compliance/reports', { params });
    return response.data;
  },

  async getReport(reportId: string): Promise<import('../types/training').ComplianceReportDetail> {
    const response = await api.get<import('../types/training').ComplianceReportDetail>(`/compliance/reports/${reportId}`);
    return response.data;
  },

  async deleteReport(reportId: string): Promise<void> {
    await api.delete(`/compliance/reports/${reportId}`);
  },

  async emailReport(reportId: string, recipients: string[]): Promise<void> {
    await api.post(`/compliance/reports/${reportId}/email`, recipients);
  },
};

