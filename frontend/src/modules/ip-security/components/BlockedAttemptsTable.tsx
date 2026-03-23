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
      <div className="text-center py-12 text-theme-text-muted">
        <ShieldOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No blocked access attempts</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-theme-surface-border text-left text-theme-text-muted">
            <th scope="col" className="py-3 px-4 font-medium">IP Address</th>
            <th scope="col" className="py-3 px-4 font-medium">Country</th>
            <th scope="col" className="py-3 px-4 font-medium">Reason</th>
            <th scope="col" className="py-3 px-4 font-medium">Path</th>
            <th scope="col" className="py-3 px-4 font-medium">Method</th>
            <th scope="col" className="py-3 px-4 font-medium">Blocked At</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr
              key={a.id}
              className="border-b border-theme-surface-border/50 hover:bg-theme-surface-hover transition-colors"
            >
              <td className="py-3 px-4 font-mono text-theme-text-primary">{a.ipAddress}</td>
              <td className="py-3 px-4 text-theme-text-secondary">
                {a.countryName ?? a.countryCode ?? '—'}
              </td>
              <td className="py-3 px-4 text-theme-text-secondary">{a.blockReason}</td>
              <td className="py-3 px-4 font-mono text-xs text-theme-text-muted">
                {a.requestPath ?? '—'}
              </td>
              <td className="py-3 px-4 text-theme-text-muted">{a.requestMethod ?? '—'}</td>
              <td className="py-3 px-4 text-theme-text-muted">
                {a.blockedAt ? formatDateTime(a.blockedAt, tz) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
