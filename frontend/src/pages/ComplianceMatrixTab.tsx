/**
 * Compliance Matrix Tab (TC2)
 *
 * Shows a member × requirement matrix for training coordinators.
 * Lazy-loaded as a tab in TrainingAdminPage.
 */

import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { trainingService } from '../services/api';
import type { ComplianceMatrix, ComplianceMatrixMember } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime } from '../utils/dateFormatting';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />,
  verified: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  in_progress: <Clock className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />,
  expired: <XCircle className="h-3.5 w-3.5 text-red-700 dark:text-red-400" />,
  not_started: <XCircle className="text-theme-text-muted h-3.5 w-3.5" />,
};

const ComplianceMatrixTab: React.FC = () => {
  const tz = useTimezone();
  const [matrix, setMatrix] = useState<ComplianceMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadMatrix();
  }, []);

  const loadMatrix = async () => {
    try {
      setLoading(true);
      const data = await trainingService.getComplianceMatrix();
      setMatrix(data);
    } catch {
      setError('Failed to load compliance matrix');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !matrix) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
          {error || 'No data available'}
        </div>
      </div>
    );
  }

  const { members, requirements } = matrix;

  if (requirements.length === 0) {
    return (
      <div className="text-theme-text-muted mx-auto max-w-7xl px-4 py-8 text-center">
        <AlertTriangle className="mx-auto mb-3 h-12 w-12 opacity-50" />
        <p>No active training requirements found. Create requirements first.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-theme-text-primary text-lg font-semibold">Compliance Matrix</h2>
          <p className="text-theme-text-muted text-sm">
            {members.length} members × {requirements.length} requirements
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-theme-text-muted text-xs">Generated {formatShortDateTime(matrix.generated_at, tz)}</p>
          <button
            onClick={() => window.open('/training/print/compliance', '_blank')}
            className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors print:hidden"
          >
            Print Report
          </button>
        </div>
      </div>

      <div className="card-secondary overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-theme-surface-border border-b">
              <th
                scope="col"
                className="bg-theme-surface-modal text-theme-text-secondary sticky left-0 z-10 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
              >
                Member
              </th>
              {requirements.map((req) => (
                <th
                  key={req.id}
                  className="text-theme-text-secondary px-3 py-3 text-center text-xs font-medium tracking-wider whitespace-nowrap uppercase"
                  title={req.name}
                >
                  {req.name.length > 15 ? req.name.slice(0, 15) + '...' : req.name}
                </th>
              ))}
              <th
                scope="col"
                className="text-theme-text-secondary px-4 py-3 text-center text-xs font-medium tracking-wider uppercase"
              >
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member: ComplianceMatrixMember) => (
              <tr key={member.user_id} className="border-theme-surface-border hover:bg-theme-surface-hover border-b">
                <td className="bg-theme-surface-modal text-theme-text-primary sticky left-0 z-10 px-4 py-2.5 font-medium whitespace-nowrap">
                  {member.member_name}
                </td>
                {member.requirements.map((req) => (
                  <td key={req.requirement_id} className="px-3 py-2.5 text-center">
                    <div
                      className="flex items-center justify-center"
                      title={`${req.status}${req.expiry_date ? ` (expires ${req.expiry_date})` : ''}`}
                    >
                      {STATUS_ICONS[req.status] || STATUS_ICONS.not_started}
                    </div>
                  </td>
                ))}
                <td className="px-4 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="bg-theme-surface-secondary h-2 w-16 overflow-hidden rounded-full">
                      <div
                        className={`h-full rounded-full ${member.completion_pct >= 80 ? 'bg-green-500' : member.completion_pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${member.completion_pct}%` }}
                      />
                    </div>
                    <span className="text-theme-text-muted text-xs">{Math.round(member.completion_pct)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="text-theme-text-muted mt-4 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1">{STATUS_ICONS.completed} Completed</span>
        <span className="flex items-center gap-1">{STATUS_ICONS.in_progress} In Progress</span>
        <span className="flex items-center gap-1">{STATUS_ICONS.expired} Expired</span>
        <span className="flex items-center gap-1">{STATUS_ICONS.not_started} Not Started</span>
      </div>
    </div>
  );
};

export default ComplianceMatrixTab;
