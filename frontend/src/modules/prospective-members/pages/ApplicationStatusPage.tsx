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
  active: { label: 'In Progress', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  on_hold: { label: 'On Hold', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  approved: { label: 'Approved', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  rejected: { label: 'Not Accepted', color: 'text-red-600 bg-red-50 border-red-200' },
  withdrawn: { label: 'Withdrawn', color: 'text-gray-600 bg-gray-50 border-gray-200' },
  inactive: { label: 'Inactive', color: 'text-gray-600 bg-gray-50 border-gray-200' },
  transferred: { label: 'Accepted', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Application Not Found</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[data.status] ?? STATUS_LABELS.active;
  const completedCount = data.stage_timeline.filter((s) => s.status === 'completed').length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
            <FileText className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Application Status</h1>
          <p className="text-gray-500 mt-1">
            {data.first_name} {data.last_name}
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Current Status</p>
              <span className={`inline-block mt-1 text-sm font-medium px-3 py-1 rounded-full border ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Progress</p>
              <p className="text-lg font-bold text-gray-900 mt-1">
                {completedCount} / {data.total_stages}
              </p>
            </div>
          </div>

          {data.current_stage_name && (
            <div className="bg-gray-50 rounded-lg p-3 mt-3">
              <p className="text-xs text-gray-500">Current Stage</p>
              <p className="text-sm font-medium text-gray-900">{data.current_stage_name}</p>
            </div>
          )}

          {data.applied_at && (
            <p className="text-xs text-gray-400 mt-3">
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Stage Progress</h2>
            <div className="space-y-3">
              {data.stage_timeline.map((stage, idx) => {
                const isCompleted = stage.status === 'completed';
                const isCurrent = stage.status === 'in_progress';
                return (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : isCurrent ? (
                        <Clock className="w-5 h-5 text-blue-500" />
                      ) : (
                        <Circle className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isCompleted ? 'text-gray-900' : isCurrent ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                        {stage.stage_name}
                      </p>
                      {stage.completed_at && (
                        <p className="text-xs text-gray-400 mt-0.5">
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
        <p className="text-center text-xs text-gray-400 mt-6">
          For questions about your application, please contact the department directly.
        </p>
      </div>
    </div>
  );
};
