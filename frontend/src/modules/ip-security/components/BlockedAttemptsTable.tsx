/**
 * Blocked Access Attempts Table
 */

import React from 'react';
import { ShieldOff } from 'lucide-react';
import { formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import type { BlockedAccessAttempt } from '../types';

interface BlockedAttemptsTableProps {
  attempts: BlockedAccessAttempt[];
}

export const BlockedAttemptsTable: React.FC<BlockedAttemptsTableProps> = ({ attempts }) => {
  const tz = useTimezone();
  if (attempts.length === 0) {
    return (
      <div className="text-theme-text-muted py-12 text-center">
        <ShieldOff className="mx-auto mb-3 h-12 w-12 opacity-50" />
        <p>No blocked access attempts</p>
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
              Country
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Reason
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Path
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Method
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Blocked At
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr
              key={a.id}
              className="border-theme-surface-border/50 hover:bg-theme-surface-hover border-b transition-colors"
            >
              <td className="text-theme-text-primary px-4 py-3 font-mono">{a.ipAddress}</td>
              <td className="text-theme-text-secondary px-4 py-3">{a.countryName ?? a.countryCode ?? '—'}</td>
              <td className="text-theme-text-secondary px-4 py-3">{a.blockReason}</td>
              <td className="text-theme-text-muted px-4 py-3 font-mono text-xs">{a.requestPath ?? '—'}</td>
              <td className="text-theme-text-muted px-4 py-3">{a.requestMethod ?? '—'}</td>
              <td className="text-theme-text-muted px-4 py-3">{a.blockedAt ? formatDateTime(a.blockedAt, tz) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
