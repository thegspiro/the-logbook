/**
 * CC by position: the positions whose current holders a template copies.
 *
 * A department copies "the Secretary" rather than whoever is Secretary today,
 * so the copy follows the post when it changes hands. The holders are looked
 * up when each email is sent.
 *
 * The list comes from `GET /roles`, which needs `positions.view`. An editor
 * without it sees why the list is missing, and the positions already chosen
 * are kept as they are rather than silently dropped on the next save. The
 * backend re-checks every id against the department before storing it.
 */

import React, { useEffect, useState } from 'react';
import { roleService } from '../../../services/api';
import type { Role } from '../../../types/role';

interface CcPositionsFieldProps {
  /** Selected position ids. */
  value: string[];
  onChange: (ids: string[]) => void;
}

export const CcPositionsField: React.FC<CcPositionsFieldProps> = ({ value, onChange }) => {
  const [positions, setPositions] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await roleService.getRoles();
        if (!cancelled) setPositions([...loaded].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <fieldset aria-describedby="cc-positions-hint">
      <legend className="form-label">CC positions</legend>
      {isLoading ? (
        <p className="text-theme-text-muted text-xs">Loading positions…</p>
      ) : failed ? (
        <p className="text-theme-text-muted text-xs">
          The department&apos;s positions could not be loaded, so they cannot be changed here.
          {value.length > 0 && ` ${value.length} chosen already will keep being copied.`}
        </p>
      ) : positions.length === 0 ? (
        <p className="text-theme-text-muted text-xs">This department has no positions yet.</p>
      ) : (
        <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {positions.map((position) => (
            <label key={position.id} className="touch:min-h-11 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={value.includes(position.id)}
                onChange={() => toggle(position.id)}
              />
              <span className="text-theme-text-primary">{position.name}</span>
            </label>
          ))}
        </div>
      )}
      <p id="cc-positions-hint" className="text-theme-text-muted mt-1 text-xs">
        Whoever holds a chosen position when an email is sent is CC&apos;d on it.
      </p>
    </fieldset>
  );
};
