/**
 * Platoon Selector
 *
 * Declares the platoons (A/B/C/D) a rotation pattern covers. The backend
 * offsets each platoon within the cycle so exactly one is on duty per day and
 * staffs each generated shift with that platoon's members.
 *
 * Membership itself is a per-member attribute (set on the member's profile),
 * not stored on the pattern — so this control only picks how many platoons the
 * rotation uses and shows how many members are currently assigned to each.
 */

import React from 'react';
import { Users } from 'lucide-react';

interface MemberOption {
  id: string;
  label: string;
  platoon?: string | undefined;
}

interface PlatoonSelectorProps {
  members: MemberOption[];
  platoons: string[];
  onPlatoonsChange: (platoons: string[]) => void;
}

const PLATOON_NAMES = ['A', 'B', 'C', 'D'];
const PLATOON_COUNT_OPTIONS = [2, 3, 4];

const selectCls =
  'bg-theme-input-bg border border-theme-input-border rounded-lg px-2 py-1.5 text-xs text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

export const PlatoonSelector: React.FC<PlatoonSelectorProps> = ({
  members,
  platoons,
  onPlatoonsChange,
}) => {
  const countForPlatoon = (p: string): number =>
    members.filter((m) => m.platoon === p).length;
  const unassignedCount = members.filter((m) => !m.platoon).length;

  return (
    <div className="border-t border-violet-500/10 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Platoons
        </h5>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-theme-text-muted">Platoons</label>
          <select
            value={platoons.length || 3}
            onChange={(e) =>
              onPlatoonsChange(PLATOON_NAMES.slice(0, parseInt(e.target.value, 10)))
            }
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
        on duty per day. Members are assigned to a platoon on their profile
        (Members &rarr; edit member); generated shifts are staffed from current
        platoon membership.
      </p>

      <div className="flex flex-wrap gap-2">
        {platoons.map((p) => {
          const count = countForPlatoon(p);
          return (
            <span
              key={p}
              className={`px-2 py-0.5 text-[11px] rounded-full border ${
                count > 0
                  ? 'bg-violet-500/10 text-theme-text-secondary border-violet-500/20'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
              }`}
            >
              Platoon {p}: {count} member{count === 1 ? '' : 's'}
            </span>
          );
        })}
        {unassignedCount > 0 && (
          <span className="px-2 py-0.5 text-[11px] rounded-full border border-theme-surface-border text-theme-text-muted">
            {unassignedCount} unassigned
          </span>
        )}
      </div>

      {platoons.every((p) => countForPlatoon(p) === 0) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          No members are assigned to these platoons yet — shifts will be created
          but left unstaffed until members are given a platoon on their profile.
        </p>
      )}
    </div>
  );
};
