/**
 * The positions an Interview Requirement stage needs an interview from.
 *
 * The stage completes only when each ticked position has an interview logged
 * by someone holding it on the day they interviewed. The server grades by the
 * position's slug, so that is what is stored; the department's own name is what
 * is shown. Every position the department has is offered, the Chief's rank
 * mirror and committees such as the Board of Directors included, except the
 * baseline Member position, which everyone holds.
 *
 * A stored value the department no longer has (a deleted position, or an
 * office key typed before this picker existed) stays listed and ticked, so a
 * requirement is never dropped without someone unticking it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { roleService } from '../../../../services/api';
import type { Role } from '../../../../types/role';

interface InterviewerPositionsConfigProps {
  value: string[];
  onChange: (positions: string[]) => void;
}

const humanize = (key: string): string =>
  key
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const InterviewerPositionsConfig: React.FC<InterviewerPositionsConfigProps> = ({ value, onChange }) => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    roleService
      .getRoles()
      .then((loaded) => {
        if (!cancelled) setRoles(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const offered = roles
      .filter((role) => role.slug !== 'member')
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
      .map((role) => ({ key: role.slug, label: role.name }));
    const known = new Set(offered.map((o) => o.key.toLowerCase()));
    const orphans = value
      .filter((key) => key.trim() && !known.has(key.trim().toLowerCase()))
      .map((key) => ({ key, label: `${humanize(key)} (not a current position)` }));
    return [...offered, ...orphans];
  }, [roles, value]);

  const selected = new Set(value.map((key) => key.trim().toLowerCase()));

  const toggle = (key: string, checked: boolean) => {
    const folded = key.toLowerCase();
    onChange(checked ? [...value, key] : value.filter((v) => v.trim().toLowerCase() !== folded));
  };

  return (
    <fieldset>
      <legend className="text-theme-text-muted mb-2 block text-sm">Required Interviewer Positions (optional)</legend>
      <p className="text-theme-text-muted mb-2 text-xs">
        The stage waits until each ticked position has an interview from someone holding it when they interviewed.
      </p>
      {isLoading ? (
        <p className="text-theme-text-muted text-sm">Loading positions…</p>
      ) : (
        <>
          {failed && (
            <p className="text-theme-text-muted mb-2 text-xs" role="status">
              Positions could not be loaded. The positions already required are listed below.
            </p>
          )}
          {options.length === 0 ? (
            <p className="text-theme-text-muted text-sm">This department has no positions to choose from.</p>
          ) : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {options.map((option) => (
                <li key={option.key}>
                  <label className="text-theme-text-secondary flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={selected.has(option.key.trim().toLowerCase())}
                      onChange={(e) => toggle(option.key, e.target.checked)}
                    />
                    {option.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
};

export default InterviewerPositionsConfig;
