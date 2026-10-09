/**
 * Who each person in the file is.
 *
 * One decision per distinct person in the file, not per row. Exact matches by
 * membership number, email, username or name are settled automatically; the
 * reviewer maps the rest to an existing member or creates them as an inactive
 * record. A close name ("J. Smith" for "John Smith") is never matched for
 * them — it is listed here to be mapped by hand.
 */

import React, { useMemo, useState } from 'react';
import { HISTORY_IMPORT_RESOLUTION_COLORS } from '../../../../constants/enums';
import type {
  HistoryImportAnalysis,
  HistoryImportMappingsUpdate,
  MemberMapping,
} from '../../../../modules/scheduling/types/historyImport';
import { isSettled, memberSourceLabel, RESOLUTION_LABELS } from './historyImportLabels';

interface ReviewMembersProps {
  analysis: HistoryImportAnalysis;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
}

const CREATE = '__create__';
const AUTOMATIC = '';

const ReviewMembers: React.FC<ReviewMembersProps> = ({ analysis, busy, onMappings }) => {
  const [showSettled, setShowSettled] = useState(false);

  const members = useMemo(
    () =>
      [...analysis.members].sort(
        (a, b) => Number(isSettled(a.status)) - Number(isSettled(b.status)) || a.key.localeCompare(b.key)
      ),
    [analysis.members]
  );
  const unresolved = members.filter((m) => !isSettled(m.status));
  // Only people nobody in the department matches are offered for bulk
  // creation: a conflict or an ambiguous name may well be someone already here.
  const creatable = members.filter((m) => m.status === 'unmatched');
  const visible = showSettled ? members : unresolved;

  const decide = (key: string, value: string) => {
    let mapping: MemberMapping | null;
    if (value === AUTOMATIC) mapping = null;
    else if (value === CREATE) mapping = { action: 'create' };
    else mapping = { action: 'map', user_id: value };
    onMappings({ members: { [key]: mapping } });
  };

  return (
    <section aria-labelledby="review-members-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="review-members-heading" className="text-theme-text-primary text-lg font-semibold">
            Members
          </h2>
          <p className="text-theme-text-secondary text-sm">
            {unresolved.length === 0
              ? `All ${members.length} people in the file are settled.`
              : `${unresolved.length} of ${members.length} people need a decision.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {creatable.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                onMappings({
                  members: Object.fromEntries(creatable.map((m) => [m.key, { action: 'create' }])),
                })
              }
            >
              Create all {creatable.length} unmatched as inactive
            </button>
          )}
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={showSettled}
              onChange={(e) => setShowSettled(e.target.checked)}
            />
            Show settled
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">Nothing here needs a decision.</p>
      ) : (
        <ul className="card divide-theme-surface-border divide-y">
          {visible.map((member) => {
            const selectId = `member-decision-${member.key}`;
            const current =
              member.status === 'create'
                ? CREATE
                : member.status === 'mapped'
                  ? (member.user_id ?? AUTOMATIC)
                  : AUTOMATIC;
            const candidates = new Set(member.candidate_ids);
            return (
              <li key={member.key} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-theme-text-primary font-medium break-words">{memberSourceLabel(member)}</span>
                    <span className={`badge border ${HISTORY_IMPORT_RESOLUTION_COLORS[member.status] ?? ''}`}>
                      {RESOLUTION_LABELS[member.status] ?? member.status}
                    </span>
                  </div>
                  <p className="text-theme-text-secondary mt-1 text-sm">
                    {member.row_count} {member.row_count === 1 ? 'row' : 'rows'}
                    {member.reason ? ` · ${member.reason}` : ''}
                  </p>
                  {member.user_id && (
                    <p className="text-theme-text-secondary text-sm">
                      Recorded as {analysis.options.members.find((o) => o.id === member.user_id)?.name ?? 'a member'}
                    </p>
                  )}
                </div>
                <div className="lg:w-80">
                  <label htmlFor={selectId} className="sr-only">
                    Who is {member.display_name || member.key}?
                  </label>
                  <select
                    id={selectId}
                    className="form-input"
                    value={current}
                    disabled={busy}
                    onChange={(e) => decide(member.key, e.target.value)}
                  >
                    <option value={AUTOMATIC}>
                      {member.status === 'matched' ? 'Matched automatically' : 'Choose…'}
                    </option>
                    <option value={CREATE}>Create as an inactive member</option>
                    <optgroup label="Map to an existing member">
                      {analysis.options.members
                        .slice()
                        .sort((a, b) => Number(candidates.has(b.id)) - Number(candidates.has(a.id)))
                        .map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                            {option.membership_number ? ` (#${option.membership_number})` : ''}
                            {option.status && option.status !== 'active' ? ` — ${option.status}` : ''}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ReviewMembers;
