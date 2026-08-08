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
      <div className="text-theme-text-muted py-12 text-center">
        <Shield className="mx-auto mb-3 h-12 w-12 opacity-50" />
        <p>No IP exceptions found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-theme-surface-border text-theme-text-muted border-b text-left">
            <th scope="col" className="px-4 py-3 font-medium">
              IP Address
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Use Case
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Duration
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Country
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Requested
            </th>
            {showActions && (
              <th scope="col" className="px-4 py-3 font-medium">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {exceptions.map((exc) => (
            <tr
              key={exc.id}
              className="border-theme-surface-border/50 hover:bg-theme-surface-hover border-b transition-colors"
            >
              <td className="text-theme-text-primary px-4 py-3 font-mono">{exc.ipAddress}</td>
              <td className="text-theme-text-secondary px-4 py-3">
                {IP_EXCEPTION_USE_CASE_LABELS[exc.useCase ?? ''] ?? exc.useCase ?? '—'}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${IP_EXCEPTION_STATUS_COLORS[exc.approvalStatus] ?? ''}`}
                >
                  {exc.approvalStatus}
                </span>
              </td>
              <td className="text-theme-text-secondary px-4 py-3">
                {exc.approvedDurationDays ?? exc.requestedDurationDays} days
              </td>
              <td className="text-theme-text-secondary px-4 py-3">{exc.countryName ?? exc.countryCode ?? '—'}</td>
              <td className="text-theme-text-muted px-4 py-3">
                {exc.requestedAt ? formatDateTime(exc.requestedAt, tz) : '—'}
              </td>
              {showActions && (
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {exc.approvalStatus === IPExceptionApprovalStatus.PENDING && (
                      <>
                        <button
                          onClick={() => onApprove?.(exc.id)}
                          className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-500/10"
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onReject?.(exc.id)}
                          className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-500/10"
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {exc.approvalStatus === IPExceptionApprovalStatus.APPROVED && (
                      <button
                        onClick={() => onRevoke?.(exc.id)}
                        className="rounded-lg p-1.5 text-orange-600 transition-colors hover:bg-orange-500/10"
                        title="Revoke"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    )}
                    {(exc.approvalStatus === IPExceptionApprovalStatus.EXPIRED ||
                      exc.approvalStatus === IPExceptionApprovalStatus.REJECTED ||
                      exc.approvalStatus === IPExceptionApprovalStatus.REVOKED) && (
                      <Clock className="text-theme-text-muted h-4 w-4" />
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
