/**
 * Checklist timing settings — Inventory's copy of the shape.
 *
 * The values are stored in org.settings under
 * ``shift_reports.checklist_timing``, which is where they have always lived and
 * where the backend reads them (``scheduled_tasks`` gates the start/end-of-shift
 * prompts on the two toggles; ``scheduling_service`` reads the two window
 * values). Only the *editing surface* moved to Inventory with the rest of the
 * checklist feature, so the storage key is deliberately unchanged — moving it
 * would be a data migration over every department's settings for no gain.
 *
 * Declared here rather than imported from the scheduling module so Inventory
 * does not reach back across the boundary the checklist move drew.
 */

export interface ChecklistTimingSettings {
  start_of_shift_enabled: boolean;
  end_of_shift_enabled: boolean;
  checkin_opens_hours_before: number;
  checkin_closes_hours_after: number;
}

/**
 * Bounds for the two check-in window fields, mirroring the backend's own ge/le
 * so an out-of-range value is never sent in the first place.
 */
export const CHECKIN_BOUNDS = {
  checkin_opens_hours_before: { min: 0, max: 24 },
  checkin_closes_hours_after: { min: 0, max: 72 },
} as const;

/**
 * Absence means "current behaviour", never "off" — an organization that has
 * never opened this screen keeps being prompted for checklists, which is what
 * it had before the screen existed. These match ChecklistTimingSettings on the
 * backend; the windows are generous on purpose, because the point is to stop a
 * link from last week, not to police punctuality.
 */
export const DEFAULT_CHECKLIST_TIMING: ChecklistTimingSettings = {
  start_of_shift_enabled: true,
  end_of_shift_enabled: true,
  checkin_opens_hours_before: 2,
  checkin_closes_hours_after: 12,
};
