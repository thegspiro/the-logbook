import React, { useId } from 'react';
import type { TrainingRequirement } from '../../types/training';
import { attendanceRequirements } from '../../utils/attendanceRequirements';
import { MEMBERSHIP_TYPE_LABELS } from '../../constants/enums';

interface AttendanceRequirementChecklistProps {
  /** Every active requirement; only session-attendance ones are offered. */
  requirements: TrainingRequirement[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean | undefined;
}

/**
 * Whom a requirement applies to, as configured on it: its own fields, in the
 * requirement editor's words ("Member Categories"). A requirement stores
 * legacy membership words while the department's tiers are ids of another
 * vocabulary, so the words are never looked up as tiers here; which tiers a
 * requirement stands for is the backend's projection
 * (mandatory_tiers_for_requirements), which Mandatory for's pre-fill shows.
 */
const appliesTo = (requirement: TrainingRequirement): string => {
  const types = requirement.required_membership_types ?? [];
  if (
    requirement.applies_to_all ||
    (!types.length && !requirement.required_roles?.length && !requirement.required_positions?.length)
  ) {
    return 'Applies to all members';
  }
  if (types.length) {
    const label = (type: string) => MEMBERSHIP_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
    return `Member categories: ${types.map(label).join(', ')}`;
  }
  return 'Applies to members by rank or position';
};

/**
 * One option per session-attendance requirement. Attendance at a session
 * counts toward the ticked requirements' percentages; ticking one does not by
 * itself make attending mandatory (owner decision, 2026-11-10), which is
 * Mandatory attendance's job on the Settings step. None ticked: the session
 * counts toward no attendance requirement.
 */
const AttendanceRequirementChecklist: React.FC<AttendanceRequirementChecklistProps> = ({
  requirements,
  value,
  onChange,
  disabled = false,
}) => {
  const idPrefix = useId();
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {attendanceRequirements(requirements).map((r) => {
        const checked = value.includes(r.id);
        const descriptionId = `${idPrefix}-${r.id}`;
        return (
          <label
            key={r.id}
            className={`touch:min-h-11 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
              checked ? 'bg-theme-surface-secondary border-red-700 dark:border-red-500' : 'border-theme-surface-border'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            <input
              type="checkbox"
              className="form-checkbox mt-0.5 shrink-0"
              checked={checked}
              onChange={() => toggle(r.id)}
              disabled={disabled}
              aria-describedby={descriptionId}
            />
            <span className="min-w-0">
              <span className="text-theme-text-primary block font-medium">
                {r.required_attendance_pct ? `${r.name} (${r.required_attendance_pct}%)` : r.name}
              </span>
              {/* Its description, not part of its name: aria-describedby still
                  reads it, and the name stays the requirement's alone. */}
              <span id={descriptionId} aria-hidden="true" className="text-theme-text-muted block">
                {appliesTo(r)}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
};

export default AttendanceRequirementChecklist;
