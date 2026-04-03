import React from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../../utils/dateFormatting";
import type { TrainingRecord, ComplianceSummary } from "../../types/training";

interface TrainingSectionProps {
  userId: string;
  trainings: TrainingRecord[];
  trainingsLoading: boolean;
  complianceSummary: ComplianceSummary | null;
  tz: string;
}

function getTrainingStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400";
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400";
    case "scheduled":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400";
    case "cancelled":
      return "bg-theme-surface-secondary text-theme-text-muted";
    default:
      return "bg-theme-surface-secondary text-theme-text-secondary";
  }
}

function isExpiringSoon(record: TrainingRecord): boolean {
  if (!record.expiration_date) return false;
  const expDate = new Date(record.expiration_date);
  const now = new Date();
  const daysUntilExpiry =
    (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
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
    <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-6">
      {/* Compliance Summary Card */}
      {complianceSummary && (
        <div className="mb-6">
          <div
            className={`rounded-lg p-4 border ${
              complianceSummary.compliance_status === "exempt"
                ? "border-theme-surface-border bg-theme-surface-secondary"
                : complianceSummary.compliance_status === "green"
                  ? "border-green-500/30 bg-green-500/5"
                  : complianceSummary.compliance_status === "yellow"
                    ? "border-yellow-500/30 bg-yellow-500/5"
                    : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-theme-text-primary uppercase tracking-wider">
                Compliance Summary
              </h3>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  complianceSummary.compliance_status === "exempt"
                    ? "bg-theme-surface-secondary text-theme-text-muted"
                    : complianceSummary.compliance_status === "green"
                      ? "bg-green-500/20 text-green-700 dark:text-green-400"
                      : complianceSummary.compliance_status === "yellow"
                        ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                        : "bg-red-500/20 text-red-700 dark:text-red-400"
                }`}
              >
                {complianceSummary.compliance_label}
              </span>
            </div>
            {complianceSummary.is_exempt ? (
              <p className="text-sm text-theme-text-muted">
                This member is exempt from compliance requirements
                (training hours, certificates, shifts, and admin
                hours).
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-theme-text-muted">
                    Requirements
                  </p>
                  <p className="text-lg font-semibold text-theme-text-primary">
                    {complianceSummary.requirements_met}/
                    {complianceSummary.requirements_total}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-theme-text-muted">
                    Hours (YTD)
                  </p>
                  <p className="text-lg font-semibold text-theme-text-primary">
                    {complianceSummary.hours_this_year.toFixed(1)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-theme-text-muted">
                    Active Certs
                  </p>
                  <p className="text-lg font-semibold text-theme-text-primary">
                    {complianceSummary.active_certifications}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-theme-text-muted">
                    Expiring Soon
                  </p>
                  <p
                    className={`text-lg font-semibold ${
                      complianceSummary.certs_expiring_soon > 0
                        ? "text-yellow-700 dark:text-yellow-400"
                        : complianceSummary.certs_expired > 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-theme-text-primary"
                    }`}
                  >
                    {complianceSummary.certs_expiring_soon}
                    {complianceSummary.certs_expired > 0 && (
                      <span className="text-red-700 dark:text-red-400 text-sm ml-1">
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

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-theme-text-primary">
          Training & Certifications
        </h2>
        <Link
          to={`/members/${userId}/training`}
          className="text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
        >
          View Full History
        </Link>
      </div>
      {trainingsLoading ? (
        <div className="flex items-center justify-center h-24">
          <div className="text-sm text-theme-text-muted">
            Loading training records...
          </div>
        </div>
      ) : trainings.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-theme-text-muted">
            No training records found.
          </p>
          <p className="text-xs text-theme-text-muted mt-1">
            Training records will appear here as they are completed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Show only the 5 most recent/important records */}
          {trainings.slice(0, 5).map((training) => (
            <div
              key={training.id}
              className="border border-theme-surface-border rounded-lg p-4 hover:border-theme-surface-border transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-medium text-theme-text-primary">
                    {training.course_name}
                  </h3>
                  {training.certification_number && (
                    <p className="text-sm text-theme-text-secondary mt-1">
                      Cert #: {training.certification_number}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-theme-text-secondary">
                    {training.completion_date && (
                      <span>
                        Completed:{" "}
                        {formatDate(training.completion_date, tz)}
                      </span>
                    )}
                    {training.expiration_date && (
                      <span
                        className={
                          isExpired(training)
                            ? "text-red-700 dark:text-red-400"
                            : isExpiringSoon(training)
                              ? "text-yellow-700 dark:text-yellow-400"
                              : ""
                        }
                      >
                        Expires:{" "}
                        {formatDate(training.expiration_date, tz)}
                      </span>
                    )}
                    {training.hours_completed > 0 && (
                      <span>{training.hours_completed} hrs</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${getTrainingStatusColor(
                      training.status,
                    )}`}
                  >
                    {training.status.replace("_", " ")}
                  </span>
                  {isExpired(training) && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400">
                      expired
                    </span>
                  )}
                  {!isExpired(training) &&
                    isExpiringSoon(training) && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
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
              className="block text-center py-3 text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
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
