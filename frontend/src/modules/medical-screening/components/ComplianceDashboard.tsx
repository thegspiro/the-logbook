/**
 * Compliance Dashboard
 *
 * The department's compliance roster (filterable — "Not compliant" is the
 * overdue view), one member's or prospect's detail opened from it, and the
 * org-wide list of screenings expiring soon.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useMedicalScreeningStore } from '../store/medicalScreeningStore';
import { SCREENING_STATUS_COLORS, SCREENING_STATUS_LABELS, SCREENING_TYPE_LABELS, ScreeningStatus } from '../types';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { SelfRecordedBadge } from './SelfRecordedBadge';
import { SubjectCompliancePanel, type ComplianceSubject } from './SubjectCompliancePanel';
import { ComplianceRoster } from './ComplianceRoster';

export const ComplianceDashboard: React.FC = () => {
  const { expiringScreenings, fetchExpiringScreenings } = useMedicalScreeningStore();
  const [subject, setSubject] = useState<ComplianceSubject | null>(null);

  useEffect(() => {
    void fetchExpiringScreenings(60);
  }, [fetchExpiringScreenings]);

  return (
    <div className="space-y-6">
      <ComplianceRoster onOpen={setSubject} />
      <SubjectCompliancePanel subject={subject} onClose={() => setSubject(null)} />

      {/* Expiring Soon */}
      <div>
        <h3 className="text-theme-text-primary mb-3 text-sm font-medium">Screenings Expiring Within 60 Days</h3>
        {expiringScreenings.length === 0 ? (
          <div className="border-theme-surface-border rounded-lg border border-dashed py-8 text-center">
            <CheckCircle className="mx-auto mb-2 h-6 w-6 text-green-500" />
            <p className="text-theme-text-muted text-sm">No screenings expire in the next 60 days.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {expiringScreenings.map((screening) => (
              <div key={screening.record_id} className="card flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  {screening.days_until_expiration <= 7 ? (
                    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                  ) : screening.days_until_expiration <= 30 ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Clock className="h-4 w-4 shrink-0 text-blue-500" />
                  )}
                  <div>
                    <p className="text-theme-text-primary flex flex-wrap items-center gap-2 text-sm font-medium">
                      {screening.user_name ?? screening.prospect_name ?? 'Unknown'}
                      {screening.self_recorded && <SelfRecordedBadge />}
                      {/* A lapsing waiver is listed beside screenings (MS2-7); renewing
                          it is different work from booking a screening, so say which. */}
                      {screening.status === ScreeningStatus.WAIVED && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${SCREENING_STATUS_COLORS.waived}`}>
                          {SCREENING_STATUS_LABELS.waived}
                        </span>
                      )}
                    </p>
                    <p className="text-theme-text-muted text-xs">
                      {SCREENING_TYPE_LABELS[screening.screening_type] ?? screening.screening_type}
                      {screening.requirement_name ? ` — ${screening.requirement_name}` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-medium ${
                      screening.days_until_expiration <= 7
                        ? 'text-red-700 dark:text-red-400'
                        : screening.days_until_expiration <= 30
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-theme-text-secondary'
                    }`}
                  >
                    {screening.days_until_expiration} day{screening.days_until_expiration === 1 ? '' : 's'}
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    {screening.expiration_from_frequency
                      ? `Due ${formatCalendarDate(screening.expiration_date)} (by frequency)`
                      : `Expires ${formatCalendarDate(screening.expiration_date)}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
