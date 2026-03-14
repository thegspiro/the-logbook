/**
 * Blocked Countries Table
 */

import React from 'react';
import { Globe, Trash2 } from 'lucide-react';
import { COUNTRY_RISK_LEVEL_COLORS } from '../../../constants/enums';
import { formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import type { CountryBlockRule } from '../types';

interface BlockedCountriesTableProps {
  countries: CountryBlockRule[];
  onRemove?: (countryCode: string) => void;
}

export const BlockedCountriesTable: React.FC<BlockedCountriesTableProps> = ({
  countries,
  onRemove,
}) => {
  const tz = useTimezone();
  if (countries.length === 0) {
    return (
      <div className="text-center py-12 text-theme-text-muted">
        <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No blocked countries configured</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-theme-surface-border text-left text-theme-text-muted">
            <th className="py-3 px-4 font-medium">Country</th>
            <th className="py-3 px-4 font-medium">Code</th>
            <th className="py-3 px-4 font-medium">Risk Level</th>
            <th className="py-3 px-4 font-medium">Reason</th>
            <th className="py-3 px-4 font-medium">Blocked Attempts</th>
            <th className="py-3 px-4 font-medium">Added</th>
            <th className="py-3 px-4 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => (
            <tr
              key={c.id}
              className="border-b border-theme-surface-border/50 hover:bg-theme-surface-hover transition-colors"
            >
              <td className="py-3 px-4 text-theme-text-primary font-medium">
                {c.countryName ?? c.countryCode}
              </td>
              <td className="py-3 px-4 font-mono text-theme-text-secondary">{c.countryCode}</td>
              <td className="py-3 px-4">
                {c.riskLevel && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${COUNTRY_RISK_LEVEL_COLORS[c.riskLevel] ?? ''}`}
                  >
                    {c.riskLevel}
                  </span>
                )}
              </td>
              <td className="py-3 px-4 text-theme-text-secondary max-w-xs truncate">
                {c.reason}
              </td>
              <td className="py-3 px-4 text-theme-text-muted">{c.blockedAttemptsCount ?? 0}</td>
              <td className="py-3 px-4 text-theme-text-muted">
                {c.createdAt ? formatDateTime(c.createdAt, tz) : '—'}
              </td>
              <td className="py-3 px-4">
                <button
                  onClick={() => onRemove?.(c.countryCode)}
                  className="p-1.5 rounded-lg text-red-600 hover:bg-red-500/10 transition-colors"
                  title="Remove country block"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
