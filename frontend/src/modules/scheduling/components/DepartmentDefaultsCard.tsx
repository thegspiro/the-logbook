/**
 * Department Defaults Card
 *
 * Configures department-level scheduling defaults: shift duration,
 * minimum staffing, overtime threshold, and assignment confirmation.
 */

import React, { useId } from 'react';
import type { ShiftSettings } from '../types/shiftSettings';

interface DepartmentDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
}

export const DepartmentDefaultsCard: React.FC<DepartmentDefaultsCardProps> = ({ settings, onSettingsChange }) => {
  // The three number fields have a <label> beside them rather than wrapping
  // them, so each needs an htmlFor to be a label at all rather than a styled
  // caption. `useId` rather than literal ids because this is a component, not a
  // page: two cards on one screen would otherwise point every label at the
  // first card's inputs.
  const durationId = useId();
  const staffingId = useId();
  const overtimeId = useId();

  return (
    <div className="card-secondary space-y-5 p-5">
      <h3 className="text-theme-text-primary text-base font-semibold">Department Defaults</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div>
          <label htmlFor={overtimeId} className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Overtime Threshold (hours/week)
          </label>
          <input
            id={overtimeId}
            type="number"
            value={settings.overtimeThresholdHoursPerWeek}
            onChange={(e) =>
              onSettingsChange((prev) => ({
                ...prev,
                overtimeThresholdHoursPerWeek: parseInt(e.target.value, 10) || 48,
              }))
            }
            className="form-input focus:ring-violet-500"
            min="1"
            max="168"
          />
        </div>
        <div className="flex items-center">
          <label className="mobile-touch-row text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.requireAssignmentConfirmation}
              onChange={(e) =>
                onSettingsChange((prev) => ({
                  ...prev,
                  requireAssignmentConfirmation: e.target.checked,
                }))
              }
              className="border-theme-input-border rounded-sm"
            />
            Require assignment confirmation
          </label>
        </div>
      </div>
    </div>
  );
};

export default DepartmentDefaultsCard;
