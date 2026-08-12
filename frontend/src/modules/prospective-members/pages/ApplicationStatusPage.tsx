/**
 * Application Status Page (Public)
 *
 * Allows prospects to check their application status via a unique token link.
 * No authentication required. Read-only view of limited, public-safe data.
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Loader2,
  FileText,
  CalendarClock,
  FileSignature,
} from 'lucide-react';
import { publicStatusService } from '../services/api';
import type { CurrentStageAction } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { isSafeExternalUrl } from '../../../utils/safeUrl';

interface StatusData {
  first_name: string;
  last_name: string;
  status: string;
  current_stage_name?: string | undefined;
  pipeline_name?: string | undefined;
  total_stages: number;
  stage_timeline: { stage_name: string; status: string; completed_at?: string | undefined }[];
  applied_at?: string | undefined;
  current_stage_action?: CurrentStageAction | undefined;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: {
    label: 'In Progress',
    color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
  on_hold: { label: 'On Hold', color: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30' },
  approved: { label: 'Approved', color: 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/30' },
  rejected: { label: 'Not Accepted', color: 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/30' },
  withdrawn: { label: 'Withdrawn', color: 'text-theme-text-muted bg-theme-surface-hover border-theme-surface-border' },
  inactive: { label: 'Inactive', color: 'text-theme-text-muted bg-theme-surface-hover border-theme-surface-border' },
  transferred: {
    label: 'Accepted',
    color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
};

export const ApplicationStatusPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const tz = useTimezone();
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid link');
      setLoading(false);
      return;
    }

    publicStatusService
      .getApplicationStatus(token)
      .then((result) => setData(result))
      .catch(() => setError('Application not found. Please check your link or contact the department.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading application status...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
        <div className="w-full max-w-md text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <h1 className="text-theme-text-primary mb-2 text-xl font-bold">Application Not Found</h1>
          <p className="text-theme-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[data.status] ?? STATUS_LABELS.active ?? { label: 'Active', color: '' };
  const completedCount = data.stage_timeline.filter((s) => s.status === 'completed').length;

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 py-8">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
            <FileText className="h-7 w-7 text-red-700 dark:text-red-400" aria-hidden="true" />
          </div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Application Status</h1>
          <p className="text-theme-text-muted mt-1">
            {data.first_name} {data.last_name}
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-theme-surface border-theme-surface-border mb-4 rounded-xl border p-6 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-theme-text-muted text-xs tracking-wider uppercase">Current Status</p>
              <span
                className={`mt-1 inline-block rounded-full border px-3 py-1 text-sm font-medium ${statusInfo.color}`}
              >
                {statusInfo.label}
              </span>
            </div>
            <div className="text-right">
              <p className="text-theme-text-muted text-xs tracking-wider uppercase">Progress</p>
              <p className="text-theme-text-primary mt-1 text-lg font-bold">
                {completedCount} / {data.total_stages}
              </p>
            </div>
          </div>

          {data.current_stage_name && (
            <div className="bg-theme-surface-secondary mt-3 rounded-lg p-3">
              <p className="text-theme-text-muted text-xs">Current Stage</p>
              <p className="text-theme-text-primary text-sm font-medium">{data.current_stage_name}</p>
            </div>
          )}

          {data.applied_at && (
            <p className="text-theme-text-muted mt-3 text-xs">Applied {formatDate(data.applied_at, tz)}</p>
          )}
        </div>

        {/* Current stage action (self-scheduling / e-signature) */}
        {data.current_stage_action && (
          <div className="bg-theme-surface mb-4 rounded-xl border border-blue-500/30 p-5 shadow-xs">
            {data.current_stage_action.type === 'calcom_scheduling' ? (
              <div className="flex items-start gap-3">
                <CalendarClock className="h-6 w-6 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <div className="flex-1">
                  <p className="text-theme-text-primary text-sm font-medium">{data.current_stage_action.label}</p>
                  {data.current_stage_action.message && (
                    <p className="text-theme-text-muted mt-0.5 text-xs">{data.current_stage_action.message}</p>
                  )}
                  {data.current_stage_action.url && isSafeExternalUrl(data.current_stage_action.url) && (
                    <a
                      href={data.current_stage_action.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      Schedule
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <FileSignature className="h-6 w-6 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <div className="flex-1">
                  <p className="text-theme-text-primary text-sm font-medium">{data.current_stage_action.label}</p>
                  {data.current_stage_action.message && (
                    <p className="text-theme-text-muted mt-0.5 text-xs">{data.current_stage_action.message}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        {data.stage_timeline.length > 0 && (
          <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-6 shadow-xs">
            <h2 className="text-theme-text-primary mb-4 text-sm font-semibold">Stage Progress</h2>
            <div className="space-y-3" role="list" aria-label="Application stage progress">
              {data.stage_timeline.map((stage, idx) => {
                const isCompleted = stage.status === 'completed';
                const isCurrent = stage.status === 'in_progress';
                return (
                  <div key={idx} className="flex items-start gap-3" role="listitem">
                    <div className="mt-0.5 shrink-0" aria-hidden="true">
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                      ) : isCurrent ? (
                        <Clock className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                      ) : (
                        <Circle className="text-theme-text-muted h-5 w-5 opacity-40" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm ${isCompleted ? 'text-theme-text-primary' : isCurrent ? 'font-medium text-blue-700 dark:text-blue-400' : 'text-theme-text-muted'}`}
                      >
                        {stage.stage_name}
                        {isCompleted && <span className="sr-only"> (completed)</span>}
                        {isCurrent && <span className="sr-only"> (current stage)</span>}
                      </p>
                      {stage.completed_at && (
                        <p className="text-theme-text-muted mt-0.5 text-xs">{formatDate(stage.completed_at, tz)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-theme-text-muted mt-6 text-center text-xs">
          For questions about your application, please contact the department directly.
        </p>
      </div>
    </div>
  );
};
