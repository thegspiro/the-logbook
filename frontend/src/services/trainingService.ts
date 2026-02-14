/**
 * Training Service
 *
 * Re-exports all training-related API services and types from a single
 * import point. Components and hooks can import everything they need
 * for training functionality from this module instead of reaching into
 * api.ts or types/training.ts directly.
 *
 * Individual services:
 *   - trainingService          – courses, records, categories, requirements, stats, reports
 *   - trainingProgramService   – programs, phases, milestones, enrollments, progress, registry imports
 *   - externalTrainingService  – providers, connections, sync, mappings, imports
 *   - trainingSessionService   – sessions, finalize
 */

// ---------------------------------------------------------------------------
// Service objects (re-exported from the monolithic api module)
// ---------------------------------------------------------------------------

import {
  trainingService,
  trainingProgramService,
  externalTrainingService,
  trainingSessionService,
} from './api';

export {
  trainingService,
  trainingProgramService,
  externalTrainingService,
  trainingSessionService,
};

// ---------------------------------------------------------------------------
// Convenience combined namespace
// ---------------------------------------------------------------------------

export const training = {
  ...trainingService,
  programs: trainingProgramService,
  external: externalTrainingService,
  sessions: trainingSessionService,
} as const;

// ---------------------------------------------------------------------------
// Type re-exports (from the training types module)
// ---------------------------------------------------------------------------

export type {
  // Enums / literal unions
  TrainingType,
  TrainingStatus,
  RequirementFrequency,
  DueDateType,
  RequirementType,
  RequirementSource,
  ProgramStructureType,
  EnrollmentStatus,
  RequirementProgressStatus,
  ExternalProviderType,
  SyncStatus,
  ImportStatus,

  // Sessions
  TrainingSession,
  TrainingSessionCreate,

  // Categories
  TrainingCategory,
  TrainingCategoryCreate,
  TrainingCategoryUpdate,

  // Courses
  TrainingCourse,
  TrainingCourseCreate,
  TrainingCourseUpdate,

  // Records
  TrainingRecord,
  TrainingRecordCreate,
  TrainingRecordUpdate,

  // Requirements
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingRequirementEnhanced,
  TrainingRequirementEnhancedCreate,

  // Stats & reports
  UserTrainingStats,
  TrainingHoursSummary,
  TrainingReport,
  RequirementProgress,

  // Programs
  TrainingProgram,
  TrainingProgramCreate,

  // Program phases
  ProgramPhase,
  ProgramPhaseCreate,

  // Program requirements
  ProgramRequirement,
  ProgramRequirementCreate,

  // Program milestones
  ProgramMilestone,
  ProgramMilestoneCreate,

  // Enrollments
  ProgramEnrollment,
  ProgramEnrollmentCreate,

  // Progress
  RequirementProgressRecord,
  RequirementProgressUpdate,

  // Composite / detail types
  ProgramWithDetails,
  MemberProgramProgress,

  // Registry & bulk operations
  RegistryImportResult,
  BulkEnrollmentRequest,
  BulkEnrollmentResponse,

  // External providers
  ExternalProviderConfig,
  ExternalTrainingProvider,
  ExternalTrainingProviderCreate,
  ExternalTrainingProviderUpdate,

  // External mappings
  ExternalCategoryMapping,
  ExternalCategoryMappingUpdate,
  ExternalUserMapping,
  ExternalUserMappingUpdate,

  // External sync & import
  ExternalTrainingSyncLog,
  ExternalTrainingImport,
  SyncRequest,
  SyncResponse,
  TestConnectionResponse,
  ImportRecordRequest,
  BulkImportRequest,
  BulkImportResponse,
} from '../types/training';
