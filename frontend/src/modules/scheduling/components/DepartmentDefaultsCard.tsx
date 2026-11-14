/**
 * Department Defaults Card
 *
 * Configures department-level scheduling defaults: shift duration and minimum
 * staffing, which a new shift template starts from (2026-10-31).
 *
 * No control for `requireAssignmentConfirmation`: the backend stores it but
 * nothing acts on it, so a switch would claim an effect it does not have
 * (CLAUDE.md pitfall #19). The value still round-trips unchanged on save.
 *
 * Nor for `overtimeThresholdHoursPerWeek`: nothing read it, and the Overtime
 * advisory card on the same screen is the overtime rule the assignment
 * warning actually uses. Two limits that could disagree would be worse than
 * one (owner decision 2026-10-31), so the field is gone and its stored value
 * round-trips untouched like the switch above.
 */

import React, { useId } from 'react';
import type { ShiftSettings } from '../types/shiftSettings';

interface DepartmentDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
}

export const DepartmentDefaultsCard: React.FC<DepartmentDefaultsCardProps> = ({ settings, onSettingsChange }) => {
  // The number fields have a <label> beside them rather than wrapping
  // them, so each needs an htmlFor to be a label at all rather than a styled
  // caption. `useId` rather than literal ids because this is a component, not a
  // page: two cards on one screen would otherwise point every label at the
  // first card's inputs.
  const durationId = useId();
  const staffingId = useId();

  return (
    <div className="card-secondary space-y-5 p-4 sm:p-5">
      <div>
        <h3 className="text-theme-text-primary text-base font-semibold">Department Defaults</h3>
        <p className="text-theme-text-muted mt-1 text-xs">
          A new shift template starts with this length and minimum staffing. The overtime warning is set under Overtime
          advisory.
        </p>
      </div>

      {/* Bottom-aligned so a label that wraps in a narrow column ("Default
          Shift Duration (hours)") does not drop its input below its neighbour's.
          These fields carry no help text underneath. */}
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={durationId} className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Default Shift Duration (hours)
          </label>
          <input
            id={durationId}
            type="number"
            value={settings.defaultDurationHours}
            onChange={(e) =>
              onSettingsChange((prev) => ({
                ...prev,
                defaultDurationHours: parseFloat(e.target.value) || 12,
              }))
            }
            className="form-input focus:ring-violet-500"
            min="1"
            max="48"
            step="0.5"
          />
        </div>
        <div>
          <label htmlFor={staffingId} className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Default Min Staffing
          </label>
          <input
            id={staffingId}
            type="number"
            value={settings.defaultMinStaffing}
            onChange={(e) =>
              onSettingsChange((prev) => ({
                ...prev,
                defaultMinStaffing: parseInt(e.target.value, 10) || 1,
              }))
            }
            className="form-input focus:ring-violet-500"
            min="1"
            max="50"
          />
        </div>
      </div>
    </div>
  );
};

export default DepartmentDefaultsCard;
