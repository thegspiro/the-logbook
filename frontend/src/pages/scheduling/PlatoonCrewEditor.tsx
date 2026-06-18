/**
 * Platoon Crew Editor
 *
 * Lets a manager split a platoon-rotation pattern into platoons (A/B/C/D) and
 * assign each member to one. The backend offsets each platoon within the
 * rotation cycle so exactly one platoon is on duty per day (standard fire
 * service A/B/C rotation), and staffs each generated shift with that platoon's
 * members. Members left "Unassigned" are not placed on any generated shift.
 */

import React from 'react';
import { Users } from 'lucide-react';
import { BUILTIN_POSITIONS } from '../../modules/scheduling/types/shiftSettings';

export interface PlatoonAssignment {
  user_id: string;
  platoon: string;
  position: string;
}

interface MemberOption {
  id: string;
  label: string;
}

interface PlatoonCrewEditorProps {
  members: MemberOption[];
  platoons: string[];
  assignments: PlatoonAssignment[];
  onPlatoonsChange: (platoons: string[]) => void;
  onAssignmentsChange: (assignments: PlatoonAssignment[]) => void;
}

// Standard platoon labels; departments typically run 2–4 platoons.
const PLATOON_NAMES = ['A', 'B', 'C', 'D'];
const PLATOON_COUNT_OPTIONS = [2, 3, 4];

const selectCls =
  'bg-theme-input-bg border border-theme-input-border rounded-lg px-2 py-1.5 text-xs text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

export const PlatoonCrewEditor: React.FC<PlatoonCrewEditorProps> = ({
  members,
  platoons,
  assignments,
  onPlatoonsChange,
  onAssignmentsChange,
}) => {
  const assignmentFor = (userId: string): PlatoonAssignment | undefined =>
    assignments.find((a) => a.user_id === userId);

  const setCount = (count: number) => {
    const next = PLATOON_NAMES.slice(0, count);
    onPlatoonsChange(next);
    // Drop assignments to platoons that no longer exist.
    onAssignmentsChange(assignments.filter((a) => next.includes(a.platoon)));
  };

  const setMemberPlatoon = (userId: string, platoon: string) => {
    if (!platoon) {
      onAssignmentsChange(assignments.filter((a) => a.user_id !== userId));
      return;
    }
    const existing = assignmentFor(userId);
    if (existing) {
      onAssignmentsChange(
        assignments.map((a) =>
          a.user_id === userId ? { ...a, platoon } : a,
        ),
      );
    } else {
      onAssignmentsChange([
        ...assignments,
        { user_id: userId, platoon, position: 'firefighter' },
      ]);
    }
  };

  const setMemberPosition = (userId: string, position: string) => {
    onAssignmentsChange(
      assignments.map((a) =>
        a.user_id === userId ? { ...a, position } : a,
      ),
    );
  };

  const countByPlatoon = (platoon: string): number =>
    assignments.filter((a) => a.platoon === platoon).length;

  return (
    <div className="border-t border-violet-500/10 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Platoons &amp; Crews
        </h5>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-theme-text-muted">Platoons</label>
          <select
            value={platoons.length || 3}
            onChange={(e) => setCount(parseInt(e.target.value, 10))}
            className={selectCls}
          >
            {PLATOON_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-[11px] text-theme-text-muted">
        Each platoon runs the same cycle offset by a few days so exactly one is
        on duty per day. Assign members to a platoon; only assigned members are
        placed on generated shifts. Leave a member "Unassigned" to skip them.
      </p>

      <div className="flex flex-wrap gap-2">
        {platoons.map((p) => (
          <span
            key={p}
            className="px-2 py-0.5 text-[11px] rounded-full bg-violet-500/10 text-theme-text-secondary border border-violet-500/20"
          >
            Platoon {p}: {countByPlatoon(p)}
          </span>
        ))}
      </div>

      {members.length === 0 ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          No active members found to assign.
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
          {members.map((m) => {
            const assignment = assignmentFor(m.id);
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 justify-between rounded-lg border border-theme-surface-border px-2.5 py-1.5"
              >
                <span className="text-sm text-theme-text-primary truncate">
                  {m.label}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {assignment && (
                    <select
                      value={assignment.position}
                      onChange={(e) => setMemberPosition(m.id, e.target.value)}
                      className={selectCls}
                      aria-label={`Position for ${m.label}`}
                    >
                      {BUILTIN_POSITIONS.map((pos) => (
                        <option key={pos.value} value={pos.value}>
                          {pos.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    value={assignment?.platoon ?? ''}
                    onChange={(e) => setMemberPlatoon(m.id, e.target.value)}
                    className={selectCls}
                    aria-label={`Platoon for ${m.label}`}
                  >
                    <option value="">Unassigned</option>
                    {platoons.map((p) => (
                      <option key={p} value={p}>
                        Platoon {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
