/**
 * Maintenance Tab Component
 *
 * Displays maintenance records for an apparatus with status indicators,
 * cost information, and supports add/edit/delete via modals.
 */

import React, { useState } from 'react';
import { Wrench, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ApparatusMaintenance } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '../../../utils/dateFormatting';
import { apparatusMaintenanceService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { MaintenanceRecordModal } from './MaintenanceRecordModal';

interface MaintenanceTabProps {
  maintenanceRecords: ApparatusMaintenance[];
  loadingTab: boolean;
  timezone: string;
  apparatusId: string;
  onRefresh: () => void;
}

export const MaintenanceTab: React.FC<MaintenanceTabProps> = ({
  maintenanceRecords,
  loadingTab,
  timezone,
  apparatusId,
  onRefresh,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editRecord, setEditRecord] = useState<ApparatusMaintenance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApparatusMaintenance | null>(null);

  const handleAdd = () => {
    setEditRecord(null);
    setShowModal(true);
  };

  const handleEdit = (record: ApparatusMaintenance) => {
    setEditRecord(record);
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apparatusMaintenanceService.deleteMaintenanceRecord(deleteTarget.id);
      toast.success('Maintenance record deleted');
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete record'));
    }
  };

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Maintenance Records
          </h2>
          <button onClick={handleAdd} className="btn-primary text-sm">
            Add Record
          </button>
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
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary font-medium">
                      {record.maintenanceType?.name || 'Maintenance'}
                    </p>
                    <p className="text-theme-text-muted text-sm">
                      {record.isCompleted
                        ? `Completed ${formatDate(record.completedDate, timezone)}`
                        : `Due ${formatDate(record.dueDate, timezone)}`}
                    </p>
                    {record.description && (
                      <p className="text-theme-text-secondary text-sm mt-1 truncate">{record.description}</p>
                    )}
                    {record.vendor && (
                      <p className="text-theme-text-muted text-xs mt-1">Vendor: {record.vendor}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <div className="text-right">
                      {record.cost != null && (
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
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => handleEdit(record)}
                        className="p-1.5 text-theme-text-muted hover:text-theme-text-primary transition-colors rounded-md hover:bg-theme-surface-secondary"
                        title="Edit record"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(record)}
                        className="p-1.5 text-theme-text-muted hover:text-red-600 transition-colors rounded-md hover:bg-theme-surface-secondary"
                        title="Delete record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MaintenanceRecordModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={onRefresh}
        apparatusId={apparatusId}
        editRecord={editRecord}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title="Delete Maintenance Record"
        message={`Are you sure you want to delete this ${deleteTarget?.maintenanceType?.name || 'maintenance'} record? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
};

export default MaintenanceTab;
