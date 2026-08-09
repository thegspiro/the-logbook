/**
 * RequirementLibraryPicker
 *
 * Picks one of the department's existing training requirements to attach to a
 * program or phase.
 *
 * Why this exists: a program phase used to be able to *create* a requirement
 * and nothing else, so putting "CPR/BLS Certification" into a recruit school
 * meant re-typing a requirement the department already tracked. The duplicate
 * carries its own progress and its own course links, so a member holding a
 * current CPR card still shows the phase as incomplete. Linking the existing
 * requirement is what makes the phase read the same record the department does.
 */

import React, { useMemo, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { REQUIREMENT_TYPE_LABELS } from '../../constants/enums';
import type { TrainingRequirementEnhanced } from '../../types/training';

interface RequirementLibraryPickerProps {
  requirements: TrainingRequirementEnhanced[];
  /** Currently picked requirement id, or '' for none. */
  selectedId: string;
  onChange: (id: string) => void;
  /** Requirement ids already attached to this program — shown but not pickable. */
  linkedIds?: string[];
  loading?: boolean;
  error?: string;
  /** Prefix for generated DOM ids — must be unique per picker on the page. */
  idPrefix: string;
}

const describe = (req: TrainingRequirementEnhanced): string => {
  const parts: string[] = [REQUIREMENT_TYPE_LABELS[req.requirement_type] ?? req.requirement_type];
  if (req.required_hours) parts.push(`${req.required_hours} hrs`);
  if (req.required_shifts) parts.push(`${req.required_shifts} shifts`);
  if (req.required_calls) parts.push(`${req.required_calls} calls`);
  if (req.checklist_items?.length) parts.push(`${req.checklist_items.length} items`);
  if (req.frequency) parts.push(req.frequency.replace(/_/g, ' '));
  if (req.recency_days != null) parts.push(`within last ${req.recency_days}d`);
  return parts.join(' · ');
};

export const RequirementLibraryPicker: React.FC<RequirementLibraryPickerProps> = ({
  requirements,
  selectedId,
  onChange,
  linkedIds = [],
  loading = false,
  error = '',
  idPrefix,
}) => {
  const [search, setSearch] = useState('');
  const linked = useMemo(() => new Set(linkedIds), [linkedIds]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return requirements;
    return requirements.filter(
      (req) =>
        req.name.toLowerCase().includes(term) ||
        (req.registry_code ?? '').toLowerCase().includes(term) ||
        (req.description ?? '').toLowerCase().includes(term)
    );
  }, [requirements, search]);

  const searchId = `${idPrefix}-req-search`;
  const listId = `${idPrefix}-req-list`;

  if (error) {
    return (
      <div className="text-theme-text-secondary rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs">
        {error}
      </div>
    );
  }

  if (loading) {
    return <p className="text-theme-text-muted text-xs">Loading the requirement library…</p>;
  }

  if (requirements.length === 0) {
    return (
      <div className="card-secondary border-dashed p-3 text-center">
        <ClipboardList className="text-theme-text-muted mx-auto mb-1 h-6 w-6" aria-hidden="true" />
        <p className="text-theme-text-muted text-xs">
          No requirements defined yet. Switch to <strong>Create a new one</strong> to add the first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="form-label mb-0" htmlFor={searchId}>
        Requirement
      </label>
      <p className="text-theme-text-muted text-xs">
        Pick a requirement the department already tracks. Members&apos; existing records for it count toward this phase
        — no duplicate to keep in sync.
      </p>

      <div className="relative">
        <Search
          className="text-theme-text-muted pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input-sm pl-8"
          placeholder="Search requirements…"
          aria-controls={listId}
        />
      </div>

      <ul
        id={listId}
        className="divide-theme-surface-border border-theme-surface-border max-h-56 divide-y overflow-y-auto rounded-md border"
      >
        {visible.length === 0 ? (
          <li className="text-theme-text-muted p-3 text-center text-xs">No requirements match your search.</li>
        ) : (
          visible.map((req) => {
            const alreadyLinked = linked.has(req.id);
            return (
              <li key={req.id}>
                <label
                  className={`flex items-start gap-2 p-2 ${
                    alreadyLinked ? 'cursor-not-allowed opacity-60' : 'hover:bg-theme-surface-hover cursor-pointer'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-req-choice`}
                    checked={selectedId === req.id}
                    disabled={alreadyLinked}
                    onChange={() => onChange(req.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-theme-text-primary block truncate text-sm">
                      {req.name}
                      {req.registry_code ? <span className="text-theme-text-muted"> ({req.registry_code})</span> : null}
                    </span>
                    <span className="text-theme-text-muted block text-xs">
                      {describe(req)}
                      {alreadyLinked && ' · already in this program'}
                    </span>
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
};

export default RequirementLibraryPicker;
