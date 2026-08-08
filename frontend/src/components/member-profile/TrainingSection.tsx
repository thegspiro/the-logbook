import React from 'react';
import { Link } from 'react-router';
import { formatDate } from '../../utils/dateFormatting';
import type { TrainingRecord, ComplianceSummary } from '../../types/training';

interface TrainingSectionProps {
  userId: string;
  trainings: TrainingRecord[];
  trainingsLoading: boolean;
  complianceSummary: ComplianceSummary | null;
  tz: string;
}

function getTrainingStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400';
    case 'scheduled':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400';
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400';
    case 'cancelled':
      return 'bg-theme-surface-secondary text-theme-text-muted';
    default:
      return 'bg-theme-surface-secondary text-theme-text-secondary';
  }
}

function isExpiringSoon(record: TrainingRecord): boolean {
  if (!record.expiration_date) return false;
  const expDate = new Date(record.expiration_date);
  const now = new Date();
  const daysUntilExpiry = (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry > 0 && daysUntilExpiry <= 90;
}

function isExpired(record: TrainingRecord): boolean {
  if (!record.expiration_date) return false;
  return new Date(record.expiration_date) < new Date();
}

const TrainingSection: React.FC<TrainingSectionProps> = ({
  userId,
  trainings,
  trainingsLoading,
  complianceSummary,
  tz,
}) => {
  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
      {/* Compliance Summary Card */}
      {complianceSummary && (
        <div className="mb-6">
          <div
            className={`rounded-lg border p-4 ${
              complianceSummary.compliance_status === 'exempt'
                ? 'border-theme-surface-border bg-theme-surface-secondary'
                : complianceSummary.compliance_status === 'green'
                  ? 'border-green-500/30 bg-green-500/5'
                  : complianceSummary.compliance_status === 'yellow'
                    ? 'border-yellow-500/30 bg-yellow-500/5'
                    : 'border-red-500/30 bg-red-500/5'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-theme-text-primary text-sm font-semibold tracking-wider uppercase">
                Compliance Summary
              </h3>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  complianceSummary.compliance_status === 'exempt'
                    ? 'bg-theme-surface-secondary text-theme-text-muted'
                    : complianceSummary.compliance_status === 'green'
                      ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                      : complianceSummary.compliance_status === 'yellow'
                        ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                        : 'bg-red-500/20 text-red-700 dark:text-red-400'
                }`}
              >
                {complianceSummary.compliance_label}
              </span>
            </div>
            {complianceSummary.is_exempt ? (
              <p className="text-theme-text-muted text-sm">
                This member is exempt from compliance requirements (training hours, certificates, shifts, and admin
                hours).
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-theme-text-muted text-xs">Requirements</p>
                  <p className="text-theme-text-primary text-lg font-semibold">
                    {complianceSummary.requirements_met}/{complianceSummary.requirements_total}
                  </p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs">Hours (YTD)</p>
                  <p className="text-theme-text-primary text-lg font-semibold">
                    {complianceSummary.hours_this_year.toFixed(1)}
                  </p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs">Active Certs</p>
                  <p className="text-theme-text-primary text-lg font-semibold">
                    {complianceSummary.active_certifications}
                  </p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs">Expiring Soon</p>
                  <p
                    className={`text-lg font-semibold ${
                      complianceSummary.certs_expiring_soon > 0
                        ? 'text-yellow-700 dark:text-yellow-400'
                        : complianceSummary.certs_expired > 0
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-theme-text-primary'
                    }`}
                  >
                    {complianceSummary.certs_expiring_soon}
                    {complianceSummary.certs_expired > 0 && (
                      <span className="ml-1 text-sm text-red-700 dark:text-red-400">
                        ({complianceSummary.certs_expired} expired)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-lg font-semibold">Training & Certifications</h2>
        <Link
          to={`/members/${userId}/training`}
          className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          View Full History
        </Link>
      </div>
      {trainingsLoading ? (
        <div className="flex h-24 items-center justify-center">
          <div className="text-theme-text-muted text-sm">Loading training records...</div>
        </div>
      ) : trainings.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-theme-text-muted text-sm">No training records found.</p>
          <p className="text-theme-text-muted mt-1 text-xs">Training records will appear here as they are completed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Show only the 5 most recent/important records */}
          {trainings.slice(0, 5).map((training) => (
            <div
              key={training.id}
              className="border-theme-surface-border hover:border-theme-surface-border rounded-lg border p-4 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-theme-text-primary font-medium">{training.course_name}</h3>
                  {training.certification_number && (
                    <p className="text-theme-text-secondary mt-1 text-sm">Cert #: {training.certification_number}</p>
                  )}
                  <div className="text-theme-text-secondary mt-2 flex flex-wrap gap-4 text-sm">
                    {training.completion_date && <span>Completed: {formatDate(training.completion_date, tz)}</span>}
                    {training.expiration_date && (
                      <span
                        className={
                          isExpired(training)
                            ? 'text-red-700 dark:text-red-400'
                            : isExpiringSoon(training)
                              ? 'text-yellow-700 dark:text-yellow-400'
                              : ''
                        }
                      >
                        Expires: {formatDate(training.expiration_date, tz)}
                      </span>
                    )}
                    {training.hours_completed > 0 && <span>{training.hours_completed} hrs</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${getTrainingStatusColor(
                      training.status
                    )}`}
                  >
                    {training.status.replace('_', ' ')}
                  </span>
                  {isExpired(training) && (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 dark:bg-red-500/20 dark:text-red-400">
                      expired
                    </span>
                  )}
                  {!isExpired(training) && isExpiringSoon(training) && (
                    <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                      expiring soon
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {trainings.length > 5 && (
            <Link
              to={`/members/${userId}/training`}
              className="border-theme-surface-border hover:bg-theme-surface-hover block rounded-lg border py-3 text-center text-sm text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View all {trainings.length} training records →
            </Link>
          )}
        </div>
      )}
    </div>
  );
};

export default TrainingSection;
