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

export const BlockedCountriesTable: React.FC<BlockedCountriesTableProps> = ({ countries, onRemove }) => {
  const tz = useTimezone();
  if (countries.length === 0) {
    return (
      <div className="text-theme-text-muted py-12 text-center">
        <Globe className="mx-auto mb-3 h-12 w-12 opacity-50" />
        <p>No blocked countries configured</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-theme-surface-border text-theme-text-muted border-b text-left">
            <th scope="col" className="px-4 py-3 font-medium">
              Country
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Code
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Risk Level
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Reason
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Blocked Attempts
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Added
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => (
            <tr
              key={c.id}
              className="border-theme-surface-border/50 hover:bg-theme-surface-hover border-b transition-colors"
            >
              <td className="text-theme-text-primary px-4 py-3 font-medium">{c.countryName ?? c.countryCode}</td>
              <td className="text-theme-text-secondary px-4 py-3 font-mono">{c.countryCode}</td>
              <td className="px-4 py-3">
                {c.riskLevel && (
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${COUNTRY_RISK_LEVEL_COLORS[c.riskLevel] ?? ''}`}
                  >
                    {c.riskLevel}
                  </span>
                )}
              </td>
              <td className="text-theme-text-secondary max-w-xs truncate px-4 py-3">{c.reason}</td>
              <td className="text-theme-text-muted px-4 py-3">{c.blockedAttemptsCount ?? 0}</td>
              <td className="text-theme-text-muted px-4 py-3">{c.createdAt ? formatDateTime(c.createdAt, tz) : '—'}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onRemove?.(c.countryCode)}
                  className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-500/10"
                  title="Remove country block"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
