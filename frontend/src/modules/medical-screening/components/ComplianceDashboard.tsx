/**
 * Compliance Dashboard
 *
 * Shows org-wide compliance overview with expiring screenings.
 */

import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useMedicalScreeningStore } from '../store/medicalScreeningStore';
import { SCREENING_TYPE_LABELS } from '../types';

export const ComplianceDashboard: React.FC = () => {
  const { expiringScreenings, fetchExpiringScreenings } = useMedicalScreeningStore();

  useEffect(() => {
    void fetchExpiringScreenings(60);
  }, [fetchExpiringScreenings]);

  return (
    <div className="space-y-6">
      {/* Expiring Soon */}
      <div>
        <h3 className="text-theme-text-primary mb-3 text-sm font-medium">
          Screenings Expiring Within 60 Days
        </h3>
        {expiringScreenings.length === 0 ? (
          <div className="border-theme-surface-border rounded-lg border border-dashed py-8 text-center">
            <CheckCircle className="mx-auto mb-2 h-6 w-6 text-green-500" />
            <p className="text-theme-text-muted text-sm">No screenings expiring soon.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {expiringScreenings.map((screening) => (
              <div
                key={screening.record_id}
                className="border-theme-surface-border bg-theme-surface flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  {screening.days_until_expiration <= 7 ? (
                    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                  ) : screening.days_until_expiration <= 30 ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Clock className="h-4 w-4 shrink-0 text-blue-500" />
                  )}
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">
                      {screening.user_name ?? screening.prospect_name ?? 'Unknown'}
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
                  <p className="text-theme-text-muted text-xs">Expires {screening.expiration_date}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
