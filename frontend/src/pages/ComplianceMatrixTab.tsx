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

const _STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500',
  verified: 'bg-green-600',
  in_progress: 'bg-blue-500',
  expired: 'bg-red-500',
  not_started: 'bg-theme-surface-secondary',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />,
  verified: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-blue-400" />,
  expired: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  not_started: <XCircle className="w-3.5 h-3.5 text-theme-text-muted" />,
};

const ComplianceMatrixTab: React.FC = () => {
  const tz = useTimezone();
  const [matrix, setMatrix] = useState<ComplianceMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMatrix();
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
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 text-theme-text-muted animate-spin" />
      </div>
    );
  }

  if (error || !matrix) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error || 'No data available'}
        </div>
      </div>
    );
  }

  const { members, requirements } = matrix;

  if (requirements.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-center text-theme-text-muted">
        <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>No active training requirements found. Create requirements first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-theme-text-primary">Compliance Matrix</h2>
          <p className="text-sm text-theme-text-muted">
            {members.length} members × {requirements.length} requirements
          </p>
        </div>
        <p className="text-xs text-theme-text-muted">Generated {formatShortDateTime(matrix.generated_at, tz)}</p>
      </div>

      <div className="overflow-x-auto bg-theme-surface-secondary border border-theme-surface-border rounded-lg">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-theme-surface-border">
              <th className="sticky left-0 z-10 bg-theme-surface px-4 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                Member
              </th>
              {requirements.map(req => (
                <th
                  key={req.id}
                  className="px-3 py-3 text-center text-xs font-medium text-theme-text-secondary uppercase tracking-wider whitespace-nowrap"
                  title={req.name}
                >
                  {req.name.length > 15 ? req.name.slice(0, 15) + '...' : req.name}
                </th>
              ))}
              <th className="px-4 py-3 text-center text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member: ComplianceMatrixMember) => (
              <tr key={member.user_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                <td className="sticky left-0 z-10 bg-theme-surface px-4 py-2.5 whitespace-nowrap text-theme-text-primary font-medium">
                  {member.member_name}
                </td>
                {member.requirements.map(req => (
                  <td key={req.requirement_id} className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center" title={`${req.status}${req.expiry_date ? ` (expires ${req.expiry_date})` : ''}`}>
                      {STATUS_ICONS[req.status] || STATUS_ICONS.not_started}
                    </div>
                  </td>
                ))}
                <td className="px-4 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-16 h-2 bg-theme-surface-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${member.completion_pct >= 80 ? 'bg-green-500' : member.completion_pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${member.completion_pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-theme-text-muted">{Math.round(member.completion_pct)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-xs text-theme-text-muted">
        <span className="flex items-center gap-1">{STATUS_ICONS.completed} Completed</span>
        <span className="flex items-center gap-1">{STATUS_ICONS.in_progress} In Progress</span>
        <span className="flex items-center gap-1">{STATUS_ICONS.expired} Expired</span>
        <span className="flex items-center gap-1">{STATUS_ICONS.not_started} Not Started</span>
      </div>
    </div>
  );
};

export default ComplianceMatrixTab;
