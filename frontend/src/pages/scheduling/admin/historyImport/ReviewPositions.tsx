/**
 * Which seat each position in the file means.
 *
 * Only rows on the department's own units take a seat; a blank position is the
 * default firefighter seat. Anything the department has no seat for is mapped
 * here to one it does.
 */

import React from 'react';
import { HISTORY_IMPORT_RESOLUTION_COLORS } from '../../../../constants/enums';
import type {
  HistoryImportAnalysis,
  HistoryImportMappingsUpdate,
} from '../../../../modules/scheduling/types/historyImport';
import { isSettled, RESOLUTION_LABELS } from './historyImportLabels';
import RememberedBadge from './RememberedBadge';

interface ReviewPositionsProps {
  analysis: HistoryImportAnalysis;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
}

const ReviewPositions: React.FC<ReviewPositionsProps> = ({ analysis, busy, onMappings }) => {
  const positions = [...analysis.positions].sort(
    (a, b) => Number(isSettled(a.status)) - Number(isSettled(b.status)) || a.key.localeCompare(b.key)
  );

  return (
    <section aria-labelledby="review-positions-heading" className="space-y-4">
      <div>
        <h2 id="review-positions-heading" className="text-theme-text-primary text-lg font-semibold">
          Positions
        </h2>
        <p className="text-theme-text-secondary text-sm">
          The seat each member rode in. A blank position is the firefighter seat. Positions appear once every row's
          member and unit are settled.
        </p>
      </div>
      {positions.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">No positions to review yet.</p>
      ) : (
        <ul className="card divide-theme-surface-border divide-y">
          {positions.map((position) => {
            const selectId = `position-decision-${position.key || 'blank'}`;
            return (
              <li
                key={position.key || 'blank'}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-theme-text-primary font-medium">{position.source || '(blank)'}</span>
                    <span className={`badge border ${HISTORY_IMPORT_RESOLUTION_COLORS[position.status] ?? ''}`}>
                      {RESOLUTION_LABELS[position.status] ?? position.status}
                    </span>
                    {position.remembered && <RememberedBadge />}
                  </div>
                  <p className="text-theme-text-secondary mt-1 text-sm">
                    {position.row_count} {position.row_count === 1 ? 'row' : 'rows'}
                    {position.seat ? ` · seat: ${position.seat}` : ''}
                  </p>
                </div>
                <div className="sm:w-64">
                  <label htmlFor={selectId} className="sr-only">
                    Seat for {position.source || 'blank position'}
                  </label>
                  <select
                    id={selectId}
                    className="form-input"
                    disabled={busy}
                    value={position.status === 'mapped' ? (position.seat ?? '') : ''}
                    onChange={(e) =>
                      onMappings({
                        positions: { [position.key]: e.target.value ? { seat: e.target.value } : null },
                      })
                    }
                  >
                    <option value="">{position.status === 'matched' ? 'Matched automatically' : 'Choose…'}</option>
                    {analysis.options.seats.map((seat) => (
                      <option key={seat} value={seat}>
                        {seat}
                      </option>
                    ))}
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

export default ReviewPositions;
