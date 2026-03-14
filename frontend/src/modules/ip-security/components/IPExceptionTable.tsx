/**
 * IP Exception Table
 *
 * Displays a list of IP exceptions with status badges and action buttons.
 */

import React from 'react';
import { Check, X, Ban, Clock, Shield } from 'lucide-react';
import {
  IPExceptionApprovalStatus,
  IP_EXCEPTION_STATUS_COLORS,
  IP_EXCEPTION_USE_CASE_LABELS,
} from '../../../constants/enums';
import { formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import type { IPException } from '../types';

interface IPExceptionTableProps {
  exceptions: IPException[];
  showActions?: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onRevoke?: (id: string) => void;
}

export const IPExceptionTable: React.FC<IPExceptionTableProps> = ({
  exceptions,
  showActions = false,
  onApprove,
  onReject,
  onRevoke,
}) => {
  const tz = useTimezone();
  if (exceptions.length === 0) {
    return (
      <div className="text-center py-12 text-theme-text-muted">
        <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No IP exceptions found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-theme-surface-border text-left text-theme-text-muted">
            <th className="py-3 px-4 font-medium">IP Address</th>
            <th className="py-3 px-4 font-medium">Use Case</th>
            <th className="py-3 px-4 font-medium">Status</th>
            <th className="py-3 px-4 font-medium">Duration</th>
            <th className="py-3 px-4 font-medium">Country</th>
            <th className="py-3 px-4 font-medium">Requested</th>
            {showActions && <th className="py-3 px-4 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {exceptions.map((exc) => (
            <tr
              key={exc.id}
              className="border-b border-theme-surface-border/50 hover:bg-theme-surface-hover transition-colors"
            >
              <td className="py-3 px-4 font-mono text-theme-text-primary">{exc.ipAddress}</td>
              <td className="py-3 px-4 text-theme-text-secondary">
                {IP_EXCEPTION_USE_CASE_LABELS[exc.useCase ?? ''] ?? exc.useCase ?? '—'}
              </td>
              <td className="py-3 px-4">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${IP_EXCEPTION_STATUS_COLORS[exc.approvalStatus] ?? ''}`}
                >
                  {exc.approvalStatus}
                </span>
              </td>
              <td className="py-3 px-4 text-theme-text-secondary">
                {exc.approvedDurationDays ?? exc.requestedDurationDays} days
              </td>
              <td className="py-3 px-4 text-theme-text-secondary">
                {exc.countryName ?? exc.countryCode ?? '—'}
              </td>
              <td className="py-3 px-4 text-theme-text-muted">
                {exc.requestedAt ? formatDateTime(exc.requestedAt, tz) : '—'}
              </td>
              {showActions && (
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    {exc.approvalStatus === IPExceptionApprovalStatus.PENDING && (
                      <>
                        <button
                          onClick={() => onApprove?.(exc.id)}
                          className="p-1.5 rounded-lg text-green-600 hover:bg-green-500/10 transition-colors"
                          title="Approve"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onReject?.(exc.id)}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 transition-colors"
                          title="Reject"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {exc.approvalStatus === IPExceptionApprovalStatus.APPROVED && (
                      <button
                        onClick={() => onRevoke?.(exc.id)}
                        className="p-1.5 rounded-lg text-orange-600 hover:bg-orange-500/10 transition-colors"
                        title="Revoke"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    {(exc.approvalStatus === IPExceptionApprovalStatus.EXPIRED ||
                      exc.approvalStatus === IPExceptionApprovalStatus.REJECTED ||
                      exc.approvalStatus === IPExceptionApprovalStatus.REVOKED) && (
                      <Clock className="w-4 h-4 text-theme-text-muted" />
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
