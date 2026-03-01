/**
 * Department Defaults Card
 *
 * Configures department-level scheduling defaults: shift duration,
 * minimum staffing, overtime threshold, and assignment confirmation.
 */

import React from "react";
import type { ShiftSettings } from "../types/shiftSettings";

interface DepartmentDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
}

export const DepartmentDefaultsCard: React.FC<DepartmentDefaultsCardProps> = ({
  settings,
  onSettingsChange,
}) => {
  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 space-y-5">
      <h3 className="text-base font-semibold text-theme-text-primary">
        Department Defaults
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            Default Shift Duration (hours)
          </label>
          <input
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
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            Default Min Staffing
          </label>
          <input
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
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            Overtime Threshold (hours/week)
          </label>
          <input
            type="number"
            value={settings.overtimeThresholdHoursPerWeek}
            onChange={(e) =>
              onSettingsChange((prev) => ({
                ...prev,
                overtimeThresholdHoursPerWeek:
                  parseInt(e.target.value, 10) || 48,
              }))
            }
            className="form-input focus:ring-violet-500"
            min="1"
            max="168"
          />
        </div>
        <div className="flex items-center">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={settings.requireAssignmentConfirmation}
              onChange={(e) =>
                onSettingsChange((prev) => ({
                  ...prev,
                  requireAssignmentConfirmation: e.target.checked,
                }))
              }
              className="rounded border-theme-input-border"
            />
            Require assignment confirmation
          </label>
        </div>
      </div>
    </div>
  );
};

export default DepartmentDefaultsCard;
