/**
 * Application Status Page (Public)
 *
 * Allows prospects to check their application status via a unique token link.
 * No authentication required. Read-only view of limited, public-safe data.
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Loader2,
  FileText,
} from 'lucide-react';
import { publicStatusService } from '../services/api';

interface StatusData {
  first_name: string;
  last_name: string;
  status: string;
  current_stage_name?: string;
  pipeline_name?: string;
  total_stages: number;
  stage_timeline: { stage_name: string; status: string; completed_at?: string }[];
  applied_at?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'In Progress', color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  on_hold: { label: 'On Hold', color: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30' },
  approved: { label: 'Approved', color: 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/30' },
  rejected: { label: 'Not Accepted', color: 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/30' },
  withdrawn: { label: 'Withdrawn', color: 'text-theme-text-muted bg-theme-surface-hover border-theme-surface-border' },
  inactive: { label: 'Inactive', color: 'text-theme-text-muted bg-theme-surface-hover border-theme-surface-border' },
  transferred: { label: 'Accepted', color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

export const ApplicationStatusPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
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
      <div className="min-h-screen bg-theme-surface-secondary flex items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading application status...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-theme-surface-secondary flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-700 dark:text-amber-400 mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-xl font-bold text-theme-text-primary mb-2">Application Not Found</h1>
          <p className="text-theme-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[data.status] ?? STATUS_LABELS.active;
  const completedCount = data.stage_timeline.filter((s) => s.status === 'completed').length;

  return (
    <div className="min-h-screen bg-theme-surface-secondary py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
            <FileText className="w-7 h-7 text-red-700 dark:text-red-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Application Status</h1>
          <p className="text-theme-text-muted mt-1">
            {data.first_name} {data.last_name}
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-theme-surface rounded-xl shadow-sm border border-theme-surface-border p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-theme-text-muted uppercase tracking-wider">Current Status</p>
              <span className={`inline-block mt-1 text-sm font-medium px-3 py-1 rounded-full border ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <div className="text-right">
              <p className="text-xs text-theme-text-muted uppercase tracking-wider">Progress</p>
              <p className="text-lg font-bold text-theme-text-primary mt-1">
                {completedCount} / {data.total_stages}
              </p>
            </div>
          </div>

          {data.current_stage_name && (
            <div className="bg-theme-surface-secondary rounded-lg p-3 mt-3">
              <p className="text-xs text-theme-text-muted">Current Stage</p>
              <p className="text-sm font-medium text-theme-text-primary">{data.current_stage_name}</p>
            </div>
          )}

          {data.applied_at && (
            <p className="text-xs text-theme-text-muted mt-3">
              Applied {new Date(data.applied_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          )}
        </div>

        {/* Timeline */}
        {data.stage_timeline.length > 0 && (
          <div className="bg-theme-surface rounded-xl shadow-sm border border-theme-surface-border p-6">
            <h2 className="text-sm font-semibold text-theme-text-primary mb-4">Stage Progress</h2>
            <div className="space-y-3" role="list" aria-label="Application stage progress">
              {data.stage_timeline.map((stage, idx) => {
                const isCompleted = stage.status === 'completed';
                const isCurrent = stage.status === 'in_progress';
                return (
                  <div key={idx} className="flex items-start gap-3" role="listitem">
                    <div className="flex-shrink-0 mt-0.5" aria-hidden="true">
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
                      ) : isCurrent ? (
                        <Clock className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                      ) : (
                        <Circle className="w-5 h-5 text-theme-text-muted opacity-40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isCompleted ? 'text-theme-text-primary' : isCurrent ? 'text-blue-700 dark:text-blue-400 font-medium' : 'text-theme-text-muted'}`}>
                        {stage.stage_name}
                        {isCompleted && <span className="sr-only"> (completed)</span>}
                        {isCurrent && <span className="sr-only"> (current stage)</span>}
                      </p>
                      {stage.completed_at && (
                        <p className="text-xs text-theme-text-muted mt-0.5">
                          {new Date(stage.completed_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-theme-text-muted mt-6">
          For questions about your application, please contact the department directly.
        </p>
      </div>
    </div>
  );
};
