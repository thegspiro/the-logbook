/**
 * API Service — Barrel re-export
 *
 * This file re-exports all service objects and inline types from their
 * individual domain files. Existing imports like:
 *   import { userService } from '@/services/api'
 * continue to work. New code should import directly from the domain file
 * for better tree-shaking:
 *   import { userService } from '@/services/userServices';
 *   import { authService } from '@/services/authService';
 */

// Shared axios client (for direct use in stores/hooks that need the raw instance)
export { default as api } from './apiClient';

// Auth
export { authService } from './authService';

// Users, Organization, Roles
export { userService, organizationService, roleService } from './userServices';
export type { ModuleSettingsData, OrganizationProfile, EnabledModulesResponse, SetupChecklistItem, SetupChecklistResponse } from './userServices';

// Training
export {
  trainingService,
  externalTrainingService,
  trainingProgramService,
  trainingSessionService,
  trainingSubmissionService,
  trainingModuleConfigService,
  skillsTestingService,
} from './trainingServices';
export type { IntegrationConfig } from './trainingServices';

// Events
export { eventService, eventRequestService } from './eventServices';
// NOTE: Inventory types are temporarily co-located with eventServices due to
// extraction boundary overlap. They will be moved in a follow-up cleanup.
export type {
  UserInventoryItem, UserCheckoutItem, UserIssuedItem, UserInventoryResponse,
  InventoryCategory, InventoryItem, LowStockAlert, MaintenanceRecord,
  MaintenanceRecordCreate, StorageAreaResponse, StorageAreaCreate,
  EquipmentRequestItem, WriteOffRequestItem, InventoryItemCreate,
  ItemIssuance, InventoryItemsListResponse, ItemHistoryEvent,
  InventorySummary, InventoryCategoryCreate, ScanLookupResult,
  ScanLookupResponse, BatchScanItem, BatchCheckoutRequest,
  BatchCheckoutResultItem, BatchCheckoutResponse, BatchReturnItem,
  BatchReturnRequest, BatchReturnResultItem, BatchReturnResponse,
  MemberInventorySummary, MembersInventoryListResponse, LabelFormat,
  NFPACompliance, NFPAExposureRecord, NFPASummary, NFPARetirementDueItem,
  InventoryImportResult,
  SizeVariantCreate, BulkIssuanceTarget, BulkIssuanceResponse,
  IssuanceAllowance, AllowanceCheck,
  ChargeManagementResponse, IssuanceChargeListItem, ReturnRequestItem,
} from './eventServices';

// Elections
export { electionService } from './electionService';

// Inventory
export { inventoryService } from './inventoryService';
// Form types (extracted to dedicated file)
export type {
  FormFieldOption, FormField, FormFieldCreate, FormIntegration,
  FormIntegrationCreate, MemberLookupResult, MemberLookupResponse,
  FormDef, FormDetailDef, FormCreate, FormUpdate, FormsListResponse,
  FormSubmission, SubmissionsListResponse, FormsSummary,
  PublicFormField, PublicFormDef, PublicFormSubmissionResponse,
} from './formTypes';

// Forms
export { formsService, publicFormsService } from './formsServices';
// Document types co-located with formsServices due to extraction overlap
export type { DocumentFolder, DocumentRecord, DocumentsSummary } from './formsServices';

// Documents
export { documentsService } from './documentsService';
// Meeting types co-located with documentsService due to extraction overlap
export type { MeetingRecord, MeetingAttendee, MeetingActionItem, MeetingsSummary } from './documentsService';

// Meetings & Minutes
export { meetingsService, minutesService } from './meetingsServices';

// Communications (notifications, email, messages)
export {
  notificationsService,
  emailTemplatesService,
  scheduledEmailsService,
  messagesService,
  messageHistoryService,
} from './communicationsServices';
export type {
  DashboardStats, AdminSummary, ActionItemSummary, CommunityEngagement,
  ComplianceMatrixMember, ComplianceMatrix, ExpiringCertification,
  ScheduledEmail, ScheduledEmailCreate, ScheduledEmailUpdate,
  MessageHistoryRecord, MessageHistoryListResponse, SendTestEmailRequest,
  Location, LocationCreate,
} from './communicationsServices';

// Facilities, Locations, Ranks
export { facilitiesService, locationsService, ranksService } from './facilitiesServices';
export type {
  LeaveOfAbsenceResponse, TrainingWaiverResponse,
  OperationalRankResponse, OperationalRankCreate, OperationalRankUpdate,
  RankValidationIssue, RankValidationResponse,
  SecurityStatus, SecurityAlert,
} from './facilitiesServices';

// Admin (security, analytics, dashboard, reports, etc.)
export {
  securityService,
  analyticsApiService,
  errorLogsService,
  platformAnalyticsService,
  dashboardService,
  reportsService,
  memberStatusService,
  shiftCompletionService,
  integrationsService,
} from './adminServices';
export type {
  TrainingSessionResponse, TrainingSessionCreate,
  ErrorLogRecord, ErrorLogStats,
  TemplateVariable, EmailTemplate, EmailAttachment, EmailTemplateUpdate, EmailTemplatePreview,
  NotificationRuleRecord, NotificationLogRecord, NotificationsSummary,
  DepartmentMessageRecord, InboxMessage, MessageStats, RoleOption,
  AnalyticsEventRecord, AnalyticsMetrics,
  TestConnectionResult,
} from './adminServices';
