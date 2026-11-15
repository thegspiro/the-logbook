import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { TrainingSessionResponse } from '../../services/api';
import type { TrainingRequirement } from '../../types/training';
import { attendanceRequirements } from '../../utils/attendanceRequirements';
import { linkedAttendanceLabel } from '../../hooks/useRetiredAttendanceRequirements';

interface SessionAttendanceRequirementsProps {
  session: TrainingSessionResponse;
  /** Every active requirement; only session-attendance ones are named. */
  requirements: TrainingRequirement[];
  /** Whether `requirements` has loaded: until then a linked id is not known to be retired. */
  loaded?: boolean | undefined;
  /** Linked requirements no longer active, id to name (useRetiredAttendanceRequirements). */
  retiredNames?: Readonly<Record<string, string>> | undefined;
}

/**
 * Which session-attendance requirements a training session counts toward, on
 * the event page. Attendance at it counts toward their percentages.
 *
 * Read-only: the links are changed in the training form's Training Info step,
 * which the card's "Edit training details" opens, even after attendance is
 * finalized, since they change how the session is graded and no record it
 * wrote.
 */
const SessionAttendanceRequirements: React.FC<SessionAttendanceRequirementsProps> = ({
  session,
  requirements,
  loaded = true,
  retiredNames = {},
}) => {
  const linked = session.attendance_requirement_ids ?? [];
  const options = attendanceRequirements(requirements);

  if (!loaded) return null;

  if (options.length === 0 && linked.length === 0) return null;

  const names = linked.map((id) => linkedAttendanceLabel(id, options, retiredNames));

  return (
    <div className="border-theme-surface-border mt-6 border-t pt-4">
      <h3 className="text-theme-text-primary mb-2 flex items-center gap-2 text-sm font-medium">
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        Counts toward attendance
      </h3>
      {linked.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {names.map((name, i) => (
            <li
              key={linked[i] ?? name}
              className="badge border border-blue-500/30 bg-blue-500/10 text-sm text-blue-800 dark:text-blue-300"
            >
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-theme-text-secondary text-sm">
          None: this session is not graded against an attendance requirement.
        </p>
      )}
    </div>
  );
};

export default SessionAttendanceRequirements;
