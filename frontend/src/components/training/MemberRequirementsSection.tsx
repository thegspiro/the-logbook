/**
 * A member's training requirements and leaves of absence, for the training
 * officer reading that member's training page.
 *
 * Loads `/training/module-config/members/{id}/requirements`, which evaluates
 * the member exactly as their own My Training page does, and renders each
 * requirement with the same card. Its own request, so a failure here leaves
 * the training records below it working.
 */

import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { trainingModuleConfigService } from '../../services/api';
import { RequirementDetailCard } from './RequirementDetailCard';
import { LeaveOfAbsenceSummary } from './LeaveOfAbsenceSummary';
import { getErrorMessage } from '../../utils/errorHandling';
import type { MemberRequirementsResponse } from '../../types/training';

interface MemberRequirementsSectionProps {
  userId: string;
  timezone: string;
}

export const MemberRequirementsSection: React.FC<MemberRequirementsSectionProps> = ({ userId, timezone }) => {
  const [data, setData] = useState<MemberRequirementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    trainingModuleConfigService
      .getMemberRequirements(userId)
      .then((res) => {
        // A body that is not this shape (a captive portal's page, an empty
        // object) is a failed load, not "no requirements" and "no leave":
        // both of those are claims about the member an officer acts on.
        if (!Array.isArray(res?.requirements_detail) || !Array.isArray(res?.leaves_of_absence)) {
          throw new TypeError('The member requirements response was not a requirements list');
        }
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const fallback = 'Unable to load this member’s requirements. Refresh to try again.';
        setError(err instanceof TypeError ? fallback : getErrorMessage(err, fallback));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summary = data?.requirements_summary;

  return (
    <section className="card mb-6 p-4" aria-labelledby="member-requirements-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="member-requirements-heading" className="text-theme-text-primary flex items-center gap-2 font-semibold">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
          Requirements
        </h2>
        {summary && summary.total_requirements > 0 && (
          <span className="text-theme-text-muted text-sm">
            {summary.met_requirements} of {summary.total_requirements} met
          </span>
        )}
      </div>

      {loading && <p className="text-theme-text-muted text-sm">Loading requirements…</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      {data && (
        <>
          <LeaveOfAbsenceSummary leaves={data.leaves_of_absence} rule={data.leave_month_rule} />

          {data.requirements_detail.length === 0 ? (
            <p className="text-theme-text-muted text-sm">No training requirements apply to this member.</p>
          ) : (
            <div className="space-y-3">
              {[...data.requirements_detail]
                .sort((a, b) => Number(a.is_met) - Number(b.is_met))
                .map((req) => (
                  <RequirementDetailCard key={req.id} requirement={req} timezone={timezone} audience="officer" />
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};
