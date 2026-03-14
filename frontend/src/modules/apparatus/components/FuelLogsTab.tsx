/**
 * Fuel Logs Tab Component
 *
 * Displays fuel log records for an apparatus in a table layout.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Fuel } from 'lucide-react';
import type { ApparatusFuelLog } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '../../../utils/dateFormatting';

interface FuelLogsTabProps {
  id: string;
  fuelLogs: ApparatusFuelLog[];
  loadingTab: boolean;
  timezone: string;
}

export const FuelLogsTab: React.FC<FuelLogsTabProps> = ({
  id,
  fuelLogs,
  loadingTab,
  timezone,
}) => {
  const navigate = useNavigate();

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
          <Fuel className="w-5 h-5" />
          Fuel Logs
        </h2>
        <button
          onClick={() => navigate(`/apparatus/${id}/fuel/new`)}
          className="btn-primary text-sm"
        >
          Add Fuel Log
        </button>
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
                <th className="px-4 py-2 text-left text-xs text-theme-text-muted uppercase">Date</th>
                <th className="px-4 py-2 text-left text-xs text-theme-text-muted uppercase">Fuel Type</th>
                <th className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Gallons</th>
                <th className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Cost</th>
                <th className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Mileage</th>
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
                    {log.mileageAtFill?.toLocaleString() || '-'}
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
