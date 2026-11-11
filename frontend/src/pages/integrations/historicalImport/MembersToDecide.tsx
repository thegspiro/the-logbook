/**
 * The members a historical import's rows name that it cannot place on its own,
 * and those it will create — shared by the administrative-hours and training
 * steps, which settle members through the same decisions.
 *
 * A decision is per member, not per row, and is remembered for later imports
 * once committed.
 */

import React from 'react';
import type { AdminMember, AdminMemberMapping } from '../../../modules/integrations/types/historicalImport';
import { formatNumber } from '../../../utils/dateFormatting';

interface MembersToDecideProps {
  members: AdminMember[];
  options: { id: string; name: string; membership_number: string; status: string }[];
  busy: boolean;
  /** Prefix for control ids, so two sections on one page cannot collide. */
  idPrefix: string;
  onDecide: (members: Record<string, AdminMemberMapping | null>) => void;
}

const CREATE = '__create__';

const MembersToDecide: React.FC<MembersToDecideProps> = ({ members, options, busy, idPrefix, onDecide }) => {
  if (members.length === 0) return null;
  const unresolved = members.filter((m) => m.status !== 'create');
  const toCreate = members.filter((m) => m.status === 'create');
  const unmatched = unresolved.filter((m) => m.status === 'unmatched');

  const row = (member: AdminMember) => {
    const id = `${idPrefix}-member-${member.key}`;
    return (
      <li key={member.key} className="split-row gap-3 py-2 sm:items-center">
        <div className="split-row-main text-sm">
          <span className="text-theme-text-primary font-medium">
            {member.display_name || `#${member.membership_number}`}
          </span>
          <span className="text-theme-text-secondary">
            {' '}
            · {member.row_count} rows
            {member.reason ? ` · ${member.reason}` : ''}
            {member.status === 'create'
              ? ` · will be created as ${
                  [member.new_first_name, member.new_last_name].filter(Boolean).join(' ') ||
                  `Former member ${member.membership_number}`
                }`
              : ''}
          </span>
        </div>
        <div className="split-row-aside sm:w-80">
          <label htmlFor={id} className="sr-only">
            Who is {member.display_name || member.membership_number}?
          </label>
          <select
            id={id}
            className="form-input"
            disabled={busy}
            value={member.status === 'create' ? CREATE : ''}
            onChange={(e) => {
              const value = e.target.value;
              onDecide({
                [member.key]: !value
                  ? null
                  : value === CREATE
                    ? { action: 'create' }
                    : { action: 'map', user_id: value },
              });
            }}
          >
            <option value="">Choose…</option>
            <option value={CREATE}>Create as an archived former member</option>
            <optgroup label="Map to an existing member">
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.membership_number ? ` (#${option.membership_number})` : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </li>
    );
  };

  return (
    <div>
      <div className="split-row gap-3 sm:items-center">
        <h3 className="split-row-main text-theme-text-primary font-semibold">
          Members ({unresolved.length} to decide)
        </h3>
        {unmatched.length > 0 && (
          <button
            type="button"
            className="split-row-aside btn-secondary"
            disabled={busy}
            onClick={() => onDecide(Object.fromEntries(unmatched.map((m) => [m.key, { action: 'create' }])))}
          >
            Create all unmatched as archived
          </button>
        )}
      </div>
      {unresolved.length > 0 && <ul className="divide-theme-surface-border mt-2 divide-y">{unresolved.map(row)}</ul>}
      {/* Decided members are folded away: on a real export they run to hundreds of
          rows and bury the few still to decide. Each stays editable once opened. */}
      {toCreate.length > 0 && (
        <details className="mt-2">
          <summary className="text-theme-text-secondary cursor-pointer py-2 text-sm">
            {toCreate.length === 1
              ? '1 member will be created as an archived former member'
              : `${formatNumber(toCreate.length)} members will be created as archived former members`}
          </summary>
          <ul className="divide-theme-surface-border divide-y">{toCreate.map(row)}</ul>
        </details>
      )}
    </div>
  );
};

export default MembersToDecide;
