/**
 * One request type's role preset, in Event settings: the roles an event of
 * that type usually needs (owner decision, 2026-11-20). A preset prefills the
 * signup sheet a coordinator opens; they can still change it for each event.
 */

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { OutreachEventTypeConfig, OutreachRole, StaffingRoleNeed } from '../../types/event';
import { describePreset } from '../../utils/outreachRoles';

interface TypeRolePresetProps {
  type: OutreachEventTypeConfig;
  roles: OutreachRole[];
  saving: boolean;
  onSave: (roles: StaffingRoleNeed[]) => Promise<boolean>;
}

const TypeRolePreset: React.FC<TypeRolePresetProps> = ({ type, roles, saving, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StaffingRoleNeed[]>([]);
  const summary = describePreset(type.default_roles, roles);
  const total = draft.reduce((sum, need) => sum + need.count, 0);

  const start = () => {
    const known = (type.default_roles ?? []).filter((need) => roles.some((r) => r.value === need.role));
    setDraft(known.length > 0 ? known : roles[0] ? [{ role: roles[0].value, count: 1 }] : []);
    setEditing(true);
  };

  const update = (index: number, patch: Partial<StaffingRoleNeed>) =>
    setDraft((prev) => prev.map((need, i) => (i === index ? { ...need, ...patch } : need)));

  const addRow = () => {
    const unused = roles.find((r) => !draft.some((need) => need.role === r.value));
    if (unused) setDraft((prev) => [...prev, { role: unused.value, count: 1 }]);
  };

  const save = async (next: StaffingRoleNeed[]) => {
    if (await onSave(next)) setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-theme-text-secondary">{summary ? `Usually needs ${summary}` : 'No role preset'}</span>
        {roles.length > 0 && (
          <button
            type="button"
            onClick={start}
            disabled={saving}
            className="touch-target-phone font-medium text-red-700 hover:text-red-800 disabled:opacity-50 dark:text-red-400"
            aria-label={`${summary ? 'Edit' : 'Set'} the roles a ${type.label} usually needs`}
          >
            {summary ? 'Edit roles' : 'Set roles'}
          </button>
        )}
      </div>
    );
  }

  return (
    <fieldset className="bg-theme-surface-secondary mt-2 space-y-2 rounded-lg p-3">
      <legend className="text-theme-text-primary text-xs font-semibold">Roles a {type.label} usually needs</legend>
      {draft.map((need, index) => (
        <div key={need.role} className="flex items-center gap-2">
          <select
            value={need.role}
            onChange={(e) => update(index, { role: e.target.value })}
            aria-label={`Role ${index + 1}`}
            className="form-input-sm min-w-0 flex-1"
          >
            {roles
              .filter((r) => r.value === need.role || !draft.some((other) => other.role === r.value))
              .map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
          </select>
          <input
            type="number"
            min={1}
            max={50}
            // Empty while it is being retyped (0 here), so clearing the box does
            // not snap it back to 1 under the cursor; Save waits for a number.
            value={need.count || ''}
            onChange={(e) =>
              update(index, {
                count: e.target.value === '' ? 0 : Math.max(1, Math.min(50, Number(e.target.value) || 1)),
              })
            }
            aria-label={`How many for role ${index + 1}`}
            className="form-input-sm w-20"
          />
          <button
            type="button"
            onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
            className="btn-icon text-theme-text-muted hover:text-red-700"
            aria-label={`Remove role ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {total > 50 && <p className="text-xs text-red-800 dark:text-red-300">A signup sheet holds at most 50 people.</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {draft.length < roles.length && (
          <button
            type="button"
            onClick={addRow}
            className="touch-target-phone inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add a role
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary text-xs">
          Cancel
        </button>
        {(type.default_roles?.length ?? 0) > 0 && (
          <button type="button" onClick={() => void save([])} disabled={saving} className="btn-secondary text-xs">
            Clear preset
          </button>
        )}
        <button
          type="button"
          onClick={() => void save(draft)}
          disabled={saving || draft.length === 0 || total > 50 || draft.some((need) => need.count < 1)}
          className="btn-primary text-xs"
        >
          Save roles
        </button>
      </div>
    </fieldset>
  );
};

export default TypeRolePreset;
