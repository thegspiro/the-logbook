/**
 * One complete set of the department's voter-eligibility defaults: the rules
 * every voter must meet, the defaults for new ballot items, and who votes for
 * each position. Election Settings renders one per meeting kind (regular
 * business meetings, and the annual meeting when it has its own).
 *
 * Mount it with a `key` per set: the position rows are local state seeded
 * from `value` once, so a blank or repeated name can stay on screen with its
 * error rather than being dropped from what is saved.
 */

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EligibilityDefaults } from '../../../types/election';
import { SettingsToggle } from '../../../components/settings/SettingsToggle';
import { VOTER_TYPE_OPTIONS } from '../eligibilityRules';
import { EligibilityRulesEditor } from './EligibilityRulesEditor';

interface PositionRow {
  /** Stable React key; a position's name is what the secretary is editing. */
  key: number;
  name: string;
  voterTypes: string[];
}

/**
 * The rows as the map the API stores, or why they cannot be saved yet.
 * Names are compared without regard to case because the backend matches
 * positions that way, and refuses "Chief" and "chief" as a duplicate.
 */
const positionRowsToMap = (rows: PositionRow[]): { map: Record<string, string[]> } | { error: string } => {
  const map: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) return { error: 'Every position needs a name.' };
    const folded = name.toLowerCase();
    if (seen.has(folded)) return { error: `"${name}" is listed more than once.` };
    seen.add(folded);
    map[name] = row.voterTypes;
  }
  return { map };
};

interface EligibilityDefaultsEditorProps {
  value: EligibilityDefaults;
  /** Called with the patched set whenever a valid change is made. */
  onChange: (next: EligibilityDefaults) => void;
  /** Prefixes element ids so two sets on one page cannot collide. */
  idPrefix: string;
}

export const EligibilityDefaultsEditor: React.FC<EligibilityDefaultsEditorProps> = ({ value, onChange, idPrefix }) => {
  const [nextKey, setNextKey] = useState(() => Object.keys(value.position_voter_types).length);
  const [positionRows, setPositionRows] = useState<PositionRow[]>(() =>
    Object.entries(value.position_voter_types).map(([name, voterTypes], key) => ({ key, name, voterTypes }))
  );
  const [positionRowsError, setPositionRowsError] = useState<string | null>(null);
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  const patch = (changes: Partial<EligibilityDefaults>) => onChange({ ...value, ...changes });

  const updatePositionRows = (rows: PositionRow[]) => {
    setPositionRows(rows);
    const result = positionRowsToMap(rows);
    if ('error' in result) {
      setPositionRowsError(result.error);
      return;
    }
    setPositionRowsError(null);
    patch({ position_voter_types: result.map });
  };

  const addPosition = () => {
    setPositionRows([...positionRows, { key: nextKey, name: '', voterTypes: ['operational'] }]);
    setNextKey(nextKey + 1);
  };

  const attendanceLabel = 'Require voters to be checked in as present';

  return (
    <div className="space-y-8">
      <section aria-labelledby={id('rules-heading')} className="space-y-4">
        <h3 id={id('rules-heading')} className="text-theme-text-primary text-base font-semibold">
          Rules every voter must meet
        </h3>
        <EligibilityRulesEditor idPrefix={id('rules')} value={value.rules} onChange={(rules) => patch({ rules })} />
      </section>

      <section aria-labelledby={id('items-heading')} className="space-y-4">
        <h3 id={id('items-heading')} className="text-theme-text-primary text-base font-semibold">
          New ballot items
        </h3>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-theme-text-primary text-sm font-medium">{attendanceLabel}</p>
            <p className="text-theme-text-muted text-xs">
              New ballot items only count a vote from a member checked in at the meeting. Each item can still be changed
              on its own.
            </p>
          </div>
          <SettingsToggle
            checked={value.default_require_attendance}
            onChange={(next) => patch({ default_require_attendance: next })}
            label={attendanceLabel}
          />
        </div>
        <div className="max-w-sm">
          <label htmlFor={id('voter-types')} className="form-label">
            Who can vote on a new item
          </label>
          <select
            id={id('voter-types')}
            className="form-input"
            value={value.default_voter_types.join(',')}
            onChange={(e) => patch({ default_voter_types: e.target.value.split(',') })}
          >
            {VOTER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section aria-labelledby={id('positions-heading')} className="space-y-4">
        <div>
          <h3 id={id('positions-heading')} className="text-theme-text-primary text-base font-semibold">
            Who votes for each position
          </h3>
          <p className="text-theme-text-muted text-sm">
            When a new election or ballot item names one of these positions, only these members may vote for it. A
            position not listed is open to every eligible voter.
          </p>
        </div>
        {positionRows.length === 0 && <p className="text-theme-text-secondary text-sm">No positions are restricted.</p>}
        <ul className="space-y-3">
          {positionRows.map((row, index) => (
            // Stacked on a phone, where two fields side by side cut the
            // voter-type labels short; one row from `sm:` up.
            <li
              key={row.key}
              className="border-theme-surface-border grid gap-3 border-b pb-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:border-0 sm:pb-0"
            >
              <div className="min-w-0">
                <label htmlFor={id(`position-name-${row.key}`)} className="form-label">
                  Position
                </label>
                <input
                  id={id(`position-name-${row.key}`)}
                  type="text"
                  className="form-input"
                  maxLength={200}
                  placeholder="e.g., Chief"
                  value={row.name}
                  onChange={(e) =>
                    updatePositionRows(positionRows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)))
                  }
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={id(`position-voters-${row.key}`)} className="form-label">
                  Who can vote
                </label>
                <select
                  id={id(`position-voters-${row.key}`)}
                  className="form-input"
                  value={row.voterTypes.join(',')}
                  onChange={(e) =>
                    updatePositionRows(
                      positionRows.map((r, i) => (i === index ? { ...r, voterTypes: e.target.value.split(',') } : r))
                    )
                  }
                >
                  {VOTER_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn-icon justify-self-end"
                aria-label={`Remove ${row.name.trim() || 'this position'}`}
                onClick={() => updatePositionRows(positionRows.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {positionRowsError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {positionRowsError} The list is not saved until this is fixed.
          </p>
        )}
        <button
          type="button"
          className="btn-secondary flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          onClick={addPosition}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add position
        </button>
      </section>
    </div>
  );
};

export default EligibilityDefaultsEditor;
