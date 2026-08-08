/**
 * Fuel Logs Tab Component
 *
 * Displays fuel log records for an apparatus in a table layout
 * with support for adding new entries via modal.
 */

import React, { useState } from 'react';
import { Fuel } from 'lucide-react';
import type { ApparatusFuelLog } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { FuelLogModal } from './FuelLogModal';

interface FuelLogsTabProps {
  fuelLogs: ApparatusFuelLog[];
  loadingTab: boolean;
  timezone: string;
  apparatusId: string;
  onRefresh: () => void;
}

export const FuelLogsTab: React.FC<FuelLogsTabProps> = ({ fuelLogs, loadingTab, timezone, apparatusId, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div className="card p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-theme-text-primary flex items-center gap-2 font-bold">
            <Fuel className="h-5 w-5" />
            Fuel Logs
          </h2>
          <button onClick={() => setShowModal(true)} className="btn-primary text-sm">
            Add Fuel Log
          </button>
        </div>
        {loadingTab ? (
          <div className="py-8 text-center">
            <div className="border-theme-text-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
          </div>
        ) : fuelLogs.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center">No fuel logs found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-theme-surface-border border-b">
                <tr>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs uppercase">
                    Date
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs uppercase">
                    Fuel Type
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs uppercase">
                    Gallons
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs uppercase">
                    Price/Gal
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs uppercase">
                    Cost
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs uppercase">
                    Mileage
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-center text-xs uppercase">
                    Full Tank
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {fuelLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-theme-surface-secondary/50 transition-colors">
                    <td className="text-theme-text-primary px-4 py-3">{formatDate(log.fuelDate, timezone)}</td>
                    <td className="text-theme-text-secondary px-4 py-3 capitalize">{log.fuelType}</td>
                    <td className="text-theme-text-primary px-4 py-3 text-right">{Number(log.gallons).toFixed(2)}</td>
                    <td className="text-theme-text-secondary px-4 py-3 text-right">
                      {log.pricePerGallon != null ? `$${Number(log.pricePerGallon).toFixed(3)}` : '-'}
                    </td>
                    <td className="text-theme-text-primary px-4 py-3 text-right">
                      {log.totalCost != null ? formatCurrency(log.totalCost) : '-'}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-right">
                      {log.mileageAtFill != null ? formatNumber(log.mileageAtFill) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.isFullTank ? (
                        <span className="text-xs text-green-700 dark:text-green-400">Yes</span>
                      ) : (
                        <span className="text-theme-text-muted text-xs">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FuelLogModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={onRefresh}
        apparatusId={apparatusId}
      />
    </>
  );
};

export default FuelLogsTab;
