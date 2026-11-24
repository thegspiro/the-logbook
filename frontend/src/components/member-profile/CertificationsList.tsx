/**
 * Every certification requirement the member is graded on, each with its
 * state and date: "On file (Expires Mar 14, 2027)", "Expired (Mar 14, 2026)"
 * or "Not recorded" — the same words as My Training and the compliance
 * matrix (`certificationStatusOf`).
 *
 * The profile's training list shows only the five most recent records, so a
 * certificate earned two years ago usually is not among them; this list is
 * where an officer or the member reads when each certificate runs out.
 */

import React from 'react';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { certificationStatusOf } from '../../utils/certificationState';
import type { CertificationStatus } from '../../utils/certificationState';
import type { RequirementDetail } from '../../types/training';

interface CertificationsListProps {
  /** The member's graded requirements; only certifications are listed. */
  requirements: RequirementDetail[];
}

const STATE_LABEL: Record<CertificationStatus['state'], string> = {
  on_file: 'On file',
  expired: 'Expired',
  missing: 'Not recorded',
};

const STATE_CLASS: Record<CertificationStatus['state'], string> = {
  on_file: 'text-green-700 dark:text-green-400',
  expired: 'text-red-700 dark:text-red-400',
  missing: 'text-red-700 dark:text-red-400',
};

const dateLine = (status: CertificationStatus): string | null => {
  if (!status.expiry) return null;
  const date = formatCalendarDate(status.expiry);
  return status.state === 'on_file' ? `(Expires ${date})` : `(${date})`;
};

export const CertificationsList: React.FC<CertificationsListProps> = ({ requirements }) => {
  const rows = requirements.flatMap((req) => {
    const status = certificationStatusOf(req);
    return status ? [{ req, status }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-theme-text-primary mb-2 text-sm font-semibold tracking-wider uppercase">Certifications</h3>
      <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-lg border">
        {rows.map(({ req, status }) => {
          const date = dateLine(status);
          return (
            <li key={req.id} className="flex items-start justify-between gap-3 p-3">
              <span className="text-theme-text-primary min-w-0 text-sm font-medium">{req.name}</span>
              <span className="shrink-0 text-right">
                <span className={`block text-sm font-semibold ${STATE_CLASS[status.state]}`}>
                  {STATE_LABEL[status.state]}
                </span>
                {date && <span className="text-theme-text-muted block text-xs">{date}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
