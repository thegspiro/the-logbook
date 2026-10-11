/**
 * One member's or prospect's screening compliance, requirement by requirement.
 *
 * Renders the `ComplianceSummary` the server computed for the subject
 * (`GET /medical-screening/compliance/{user_id}` or `/compliance/prospect/{id}`)
 * rather than grading records here — the dashboard readiness line and this
 * panel must agree, so there is one definition of "compliant" and it lives in
 * `MedicalScreeningService.get_compliance_status`. Each opening is a PHI read
 * the server audit-logs.
 */

import React, { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useMedicalScreeningStore } from '../store/medicalScreeningStore';
import { SCREENING_STATUS_LABELS, SCREENING_TYPE_LABELS, type ComplianceItem } from '../types';
import { SelfRecordedBadge } from './SelfRecordedBadge';
import { formatCalendarDate } from '../../../utils/dateFormatting';

/** Matches the window `get_compliance_status` counts as expiring soon. */
const EXPIRING_SOON_DAYS = 30;

export interface ComplianceSubject {
  type: 'user' | 'prospect';
  id: string;
  name: string;
}

interface SubjectCompliancePanelProps {
  subject: ComplianceSubject | null;
  onClose: () => void;
}

const itemState = (item: ComplianceItem): { label: string; tone: 'met' | 'soon' | 'unmet' } => {
  if (!item.is_compliant) {
    return { label: item.last_screening_date ? 'Expired' : 'No qualifying record', tone: 'unmet' };
  }
  const days = item.days_until_expiration;
  if (days != null && days <= EXPIRING_SOON_DAYS) {
    return { label: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon' };
  }
  return { label: 'Met', tone: 'met' };
};

export const SubjectCompliancePanel: React.FC<SubjectCompliancePanelProps> = ({ subject, onClose }) => {
  const { compliance, complianceLoading, error, fetchUserCompliance, fetchProspectCompliance, clearCompliance } =
    useMedicalScreeningStore();

  useEffect(() => {
    if (!subject) {
      clearCompliance();
      return;
    }
    if (subject.type === 'user') void fetchUserCompliance(subject.id);
    else void fetchProspectCompliance(subject.id);
  }, [subject, fetchUserCompliance, fetchProspectCompliance, clearCompliance]);

  // Only the summary for the subject on screen; a stale one from an earlier
  // pick is never shown under a new name.
  const shown =
    subject && compliance && compliance.subject_id === subject.id && compliance.subject_type === subject.type
      ? compliance
      : null;

  if (!subject) return null;

  return (
    <section aria-labelledby="subject-compliance-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="subject-compliance-heading" className="text-theme-text-primary text-sm font-medium">
          {subject.name}
        </h3>
        <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {subject && complianceLoading && !shown && (
        <p className="text-theme-text-muted flex items-center gap-2 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading compliance…
        </p>
      )}
      {subject && !complianceLoading && !shown && error && (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

      {shown && (
        <div className="card space-y-3 p-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-theme-text-muted text-xs">{shown.subject_type === 'prospect' ? 'Prospect' : 'Member'}</p>
            {shown.total_requirements === 0 ? (
              <p className="text-theme-text-muted text-sm">No screening requirements are active.</p>
            ) : (
              <p className="text-theme-text-secondary text-sm">
                {shown.compliant_count} of {shown.total_requirements} requirements met
                {shown.non_compliant_count > 0 ? ` · ${shown.non_compliant_count} not met` : ''}
                {shown.expiring_soon_count > 0 ? ` · ${shown.expiring_soon_count} expiring soon` : ''}
              </p>
            )}
          </div>
          {shown.items.length > 0 && (
            <ul className="divide-theme-surface-border divide-y">
              {shown.items.map((item) => {
                const state = itemState(item);
                return (
                  <li key={item.requirement_id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div className="flex items-start gap-2">
                      {state.tone === 'met' ? (
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                      ) : state.tone === 'soon' ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                      )}
                      <div>
                        <p className="text-theme-text-primary flex flex-wrap items-center gap-2 text-sm font-medium">
                          {item.requirement_name}
                          {item.self_recorded && <SelfRecordedBadge />}
                        </p>
                        <p className="text-theme-text-muted text-xs">
                          {SCREENING_TYPE_LABELS[item.screening_type] ?? item.screening_type}
                          {item.status ? ` · ${SCREENING_STATUS_LABELS[item.status] ?? item.status}` : ''}
                          {item.last_screening_date ? ` · last ${formatCalendarDate(item.last_screening_date)}` : ''}
                          {item.expiration_date ? ` · expires ${formatCalendarDate(item.expiration_date)}` : ''}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-sm font-medium ${
                        state.tone === 'met'
                          ? 'text-green-700 dark:text-green-300'
                          : state.tone === 'soon'
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-red-700 dark:text-red-300'
                      }`}
                    >
                      {state.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
