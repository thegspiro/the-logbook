/**
 * Maintenance Tab Component
 *
 * Displays maintenance records for an apparatus with status indicators
 * and cost information.
 */

import React from 'react';
import { Wrench } from 'lucide-react';
import type { ApparatusMaintenance } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '../../../utils/dateFormatting';

interface MaintenanceTabProps {
  maintenanceRecords: ApparatusMaintenance[];
  loadingTab: boolean;
  timezone: string;
  onAdd?: () => void;
}

export const MaintenanceTab: React.FC<MaintenanceTabProps> = ({
  maintenanceRecords,
  loadingTab,
  timezone,
  onAdd,
}) => {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
          <Wrench className="w-5 h-5" />
          Maintenance Records
        </h2>
        {onAdd && (
          <button
            onClick={onAdd}
            className="btn-primary text-sm"
          >
            Add Record
          </button>
        )}
      </div>
      {loadingTab ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
        </div>
      ) : maintenanceRecords.length === 0 ? (
        <p className="text-theme-text-muted text-center py-8">No maintenance records found.</p>
      ) : (
        <div className="space-y-3">
          {maintenanceRecords.map((record) => (
            <div
              key={record.id}
              className="card-secondary p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-theme-text-primary font-medium">
                    {record.maintenanceType?.name || 'Maintenance'}
                  </p>
                  <p className="text-theme-text-muted text-sm">
                    {record.isCompleted
                      ? `Completed ${formatDate(record.completedDate, timezone)}`
                      : `Due ${formatDate(record.dueDate, timezone)}`}
                  </p>
                </div>
                <div className="text-right">
                  {record.cost && (
                    <p className="text-theme-text-primary">{formatCurrency(record.cost)}</p>
                  )}
                  <span
                    className={`px-2 py-1 text-xs rounded ${
                      record.isCompleted
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                        : record.isOverdue
                        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                        : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                    }`}
                  >
                    {record.isCompleted ? 'Completed' : record.isOverdue ? 'Overdue' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MaintenanceTab;
