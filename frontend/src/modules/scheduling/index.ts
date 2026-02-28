/**
 * Scheduling Module — Barrel Export
 *
 * Central entry point for the scheduling/shifts feature module.
 */

// Store
export { useSchedulingStore } from "./store/schedulingStore";

// Services & Types
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

// Components
export { ShiftSettingsPanel } from "./components/ShiftSettingsPanel";
export { SchedulingNotificationsPanel } from "./components/SchedulingNotificationsPanel";
