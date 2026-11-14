import React from 'react';
import type { TrainingRequirement } from '../../types/training';
import { attendanceRequirements } from '../../utils/attendanceRequirements';

interface AttendanceRequirementChecklistProps {
  /** Every active requirement; only session-attendance ones are offered. */
  requirements: TrainingRequirement[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean | undefined;
}

/**
 * One tick box per session-attendance requirement. A ticked requirement
 * charges the members it grades with attending the session; none ticked
 * leaves the session optional. Shared by the create form and the event page
 * so the two offer the same choice the same way.
 */
const AttendanceRequirementChecklist: React.FC<AttendanceRequirementChecklistProps> = ({
  requirements,
  value,
  onChange,
  disabled = false,
}) => {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      {attendanceRequirements(requirements).map((r) => (
        <label key={r.id} className="text-theme-text-primary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={value.includes(r.id)}
            onChange={() => toggle(r.id)}
            disabled={disabled}
          />
          {r.name}
          {r.required_attendance_pct ? (
            <span className="text-theme-text-muted">({r.required_attendance_pct}%)</span>
          ) : null}
        </label>
      ))}
    </div>
  );
};

export default AttendanceRequirementChecklist;
