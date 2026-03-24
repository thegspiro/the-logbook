/**
 * Fuel Logs Tab Component
 *
 * Displays fuel log records for an apparatus in a table layout.
 */

import React from 'react';
import { Fuel } from 'lucide-react';
import type { ApparatusFuelLog } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';

interface FuelLogsTabProps {
  fuelLogs: ApparatusFuelLog[];
  loadingTab: boolean;
  timezone: string;
  onAdd?: () => void;
}

export const FuelLogsTab: React.FC<FuelLogsTabProps> = ({
  fuelLogs,
  loadingTab,
  timezone,
  onAdd,
}) => {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
          <Fuel className="w-5 h-5" />
          Fuel Logs
        </h2>
        {onAdd && (
          <button
            onClick={onAdd}
            className="btn-primary text-sm"
          >
            Add Fuel Log
          </button>
        )}
      </div>
      {loadingTab ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
        </div>
      ) : fuelLogs.length === 0 ? (
        <p className="text-theme-text-muted text-center py-8">No fuel logs found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-theme-surface-border">
              <tr>
                <th scope="col" className="px-4 py-2 text-left text-xs text-theme-text-muted uppercase">Date</th>
                <th scope="col" className="px-4 py-2 text-left text-xs text-theme-text-muted uppercase">Fuel Type</th>
                <th scope="col" className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Gallons</th>
                <th scope="col" className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Cost</th>
                <th scope="col" className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Mileage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
              {fuelLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-3 text-theme-text-primary">{formatDate(log.fuelDate, timezone)}</td>
                  <td className="px-4 py-3 text-theme-text-secondary capitalize">{log.fuelType}</td>
                  <td className="px-4 py-3 text-right text-theme-text-primary">{log.gallons.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-theme-text-primary">{formatCurrency(log.totalCost)}</td>
                  <td className="px-4 py-3 text-right text-theme-text-secondary">
                    {log.mileageAtFill != null ? formatNumber(log.mileageAtFill) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FuelLogsTab;
