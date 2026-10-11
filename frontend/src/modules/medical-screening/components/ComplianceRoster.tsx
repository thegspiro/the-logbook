/**
 * The department's screening standing, one row per member and open prospect,
 * with a filter — "Not compliant" is the overdue view an officer works from.
 *
 * Rows and totals come from `GET /medical-screening/compliance`, graded by the
 * same rule as the per-subject summary a row opens, so the two cannot
 * disagree. The filter is applied on the server; the totals always describe
 * everyone.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { medicalScreeningService } from '../services/api';
import type { ComplianceRoster as Roster, ComplianceRowStanding, ComplianceStanding } from '../types';
import type { ComplianceSubject } from './SubjectCompliancePanel';
import { getErrorMessage } from '../../../utils/errorHandling';

const FILTERS: ReadonlyArray<readonly [ComplianceStanding | '', string]> = [
  ['', 'Everyone'],
  ['not_compliant', 'Not compliant (overdue or missing)'],
  ['expiring_soon', 'Expiring within 30 days'],
  ['compliant', 'Compliant'],
];

const STANDING_LABELS: Record<ComplianceRowStanding, string> = {
  not_compliant: 'Not compliant',
  expiring_soon: 'Expiring soon',
  compliant: 'Compliant',
  not_applicable: 'Not applicable',
};

const STANDING_CLASSES: Record<ComplianceRowStanding, string> = {
  not_compliant: 'text-red-700 dark:text-red-300',
  expiring_soon: 'text-amber-700 dark:text-amber-300',
  compliant: 'text-green-700 dark:text-green-300',
  not_applicable: 'text-theme-text-muted',
};

interface ComplianceRosterProps {
  onOpen: (subject: ComplianceSubject) => void;
}

export const ComplianceRoster: React.FC<ComplianceRosterProps> = ({ onOpen }) => {
  const [standing, setStanding] = useState<ComplianceStanding | ''>('');
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Switching the filter while a request is in flight must not let the older
  // response land last and show its rows under the newer filter's name.
  const latestRequest = useRef(0);

  const load = useCallback(async (filter: ComplianceStanding | '') => {
    const request = ++latestRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await medicalScreeningService.getComplianceRoster(filter || undefined);
      if (request === latestRequest.current) setRoster(result);
    } catch (err: unknown) {
      if (request === latestRequest.current) setLoadError(getErrorMessage(err, 'Could not load compliance.'));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(standing);
  }, [load, standing]);

  const noRequirements = roster?.total_requirements === 0;

  return (
    <section aria-labelledby="compliance-roster-heading" className="space-y-3">
      <h3 id="compliance-roster-heading" className="text-theme-text-primary text-sm font-medium">
        Department compliance
      </h3>

      {roster && !noRequirements && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['Requirements', roster.total_requirements],
              ['Compliant', roster.compliant],
              ['Not compliant', roster.not_compliant],
              ['Expiring soon', roster.expiring_soon],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="card-secondary p-3">
              <dt className="text-theme-text-muted text-xs">{label}</dt>
              <dd className="text-theme-text-primary text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {noRequirements ? (
        // An empty requirement set is not a compliant department.
        <p className="text-theme-text-muted text-sm">
          No screening requirements are active, so nobody is graded. Add one on the Requirements tab.
        </p>
      ) : (
        <>
          <label className="form-label block">
            Show
            <select
              className="form-input mt-1 block w-full sm:max-w-xs"
              value={standing}
              onChange={(event) => setStanding(FILTERS.find(([value]) => value === event.target.value)?.[0] ?? '')}
            >
              {FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {loadError && (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {loadError}
            </p>
          )}
          {loading && !roster && (
            <p className="text-theme-text-muted flex items-center gap-2 text-sm" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          )}

          {roster && roster.rows.length === 0 && !loading && (
            <p className="text-theme-text-muted text-sm">
              {standing ? 'Nobody matches this filter.' : 'No members or open prospects to grade.'}
            </p>
          )}

          {roster && roster.rows.length > 0 && (
            <ul className="divide-theme-surface-border card divide-y" aria-busy={loading}>
              {roster.rows.map((row) => (
                <li
                  key={`${row.subject_type}:${row.subject_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">
                      {row.subject_name || 'Unnamed'}
                      {row.subject_type === 'prospect' && (
                        <span className="text-theme-text-muted ml-2 text-xs">Prospect</span>
                      )}
                    </p>
                    <p className="text-theme-text-muted text-xs">
                      {row.compliant_count} of {roster.total_requirements} met
                      {row.non_compliant_count > 0 ? ` · ${row.non_compliant_count} not met` : ''}
                      {row.expiring_soon_count > 0 ? ` · ${row.expiring_soon_count} expiring soon` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium ${STANDING_CLASSES[row.standing]}`}>
                      {STANDING_LABELS[row.standing]}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      aria-label={`View ${row.subject_name || 'unnamed'} compliance`}
                      onClick={() =>
                        onOpen({ type: row.subject_type, id: row.subject_id, name: row.subject_name || 'Unnamed' })
                      }
                    >
                      View
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};
