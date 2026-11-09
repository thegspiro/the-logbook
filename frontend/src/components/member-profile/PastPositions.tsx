/**
 * Offices and committee seats the member held earlier, with their dates.
 *
 * Read-only, and shown to everyone who sees the member's current positions:
 * the server sends the list with the profile, already without the baseline
 * Member position and the rank mirrors (owner decision 2026-11-06). History
 * starts when the dated record began, so a seat given up before then is not
 * listed. Collapsed by default so a long-serving member's header stays short.
 */

import React from 'react';
import type { PastPosition } from '../../types/role';
import { PositionKind } from '../../constants/enums';
import { formatDate } from '../../utils/dateFormatting';

interface PastPositionsProps {
  positions: readonly PastPosition[];
  tz: string;
}

export const PastPositions: React.FC<PastPositionsProps> = ({ positions, tz }) => {
  if (positions.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="text-theme-text-muted touch-target-phone cursor-pointer text-xs font-medium uppercase">
        Earlier positions ({positions.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {positions.map((position) => (
          <li
            key={`${position.position_id ?? position.name}-${position.started_at}`}
            className="text-theme-text-secondary text-sm"
          >
            <span className="text-theme-text-primary font-medium">{position.name}</span>
            {position.kind === PositionKind.COMMITTEE && <span className="text-theme-text-muted"> (committee)</span>}
            <span className="text-theme-text-muted">
              {' '}
              · {formatDate(position.started_at, tz)} – {formatDate(position.ended_at, tz)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
};
