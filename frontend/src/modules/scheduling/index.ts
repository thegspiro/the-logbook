/**
 * Scheduling Module — Barrel Export
 *
 * Central entry point for the scheduling/shifts feature module.
 */

// Routes
export { getSchedulingRoutes } from "./routes";

// Store
export { useSchedulingStore } from "./store/schedulingStore";

// Services & Response Types
export { schedulingService } from "./services/api";
export type {
  ShiftRecord,
  ShiftAttendanceRecord,
  SchedulingSummary,
  ShiftTemplateRecord,
  BasicApparatusRecord,
  ApparatusOption,
  ApparatusOptionsResponse,
  ShiftComplianceResponse,
  MemberComplianceRecord,
  RequirementComplianceSummary,
} from "./services/api";

// Request/Input Types
export type {
  ShiftCreate,
  ShiftUpdate,
  AttendanceCreate,
  AttendanceUpdate,
  ShiftCallCreate,
  ShiftCallUpdate,
  AssignmentCreate,
  AssignmentUpdate,
  SwapRequestCreate,
  SwapRequestReview,
  SwapRequestFilters,
  TimeOffCreate,
  TimeOffReview,
  TimeOffFilters,
  ShiftTemplateCreate,
  ShiftTemplateUpdate,
  ShiftPatternCreate,
  ShiftPatternUpdate,
  PatternGenerateRequest,
  PatternGenerateResponse,
  BasicApparatusCreate,
  BasicApparatusUpdate,
  ReportFilters,
  AvailabilityFilters,
  MemberHoursReport,
  CoverageReport,
  CallVolumeReport,
  AvailabilityRecord,
  ShiftSignupResponse,
} from "./types";

// Components
export { ShiftSettingsPanel } from "./components/ShiftSettingsPanel";
export { SchedulingNotificationsPanel } from "./components/SchedulingNotificationsPanel";
