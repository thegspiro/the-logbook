/**
 * Operators Tab Component
 *
 * Displays certified operators assigned to an apparatus with
 * support for add/edit/delete via modals.
 */

import React, { useState } from 'react';
import { Users, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ApparatusOperator } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { apparatusOperatorService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { OperatorModal } from './OperatorModal';

interface OperatorsTabProps {
  operators: ApparatusOperator[];
  loadingTab: boolean;
  timezone: string;
  apparatusId: string;
  onRefresh: () => void;
}

export const OperatorsTab: React.FC<OperatorsTabProps> = ({
  operators,
  loadingTab,
  timezone,
  apparatusId,
  onRefresh,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editOperator, setEditOperator] = useState<ApparatusOperator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApparatusOperator | null>(null);

  const handleAdd = () => {
    setEditOperator(null);
    setShowModal(true);
  };

  const handleEdit = (op: ApparatusOperator) => {
    setEditOperator(op);
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apparatusOperatorService.deleteOperator(deleteTarget.id);
      toast.success('Operator removed');
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove operator'));
    }
  };

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Certified Operators
          </h2>
          <button onClick={handleAdd} className="btn-primary text-sm">
            Add Operator
          </button>
        </div>
        {loadingTab ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
          </div>
        ) : operators.length === 0 ? (
          <p className="text-theme-text-muted text-center py-8">No operators assigned.</p>
        ) : (
          <div className="space-y-3">
            {operators.map((op) => (
              <div
                key={op.id}
                className="card-secondary flex items-center justify-between p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary font-medium">Operator ID: {op.userId}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-theme-text-muted text-sm">
                      {op.isCertified ? 'Certified' : 'Not Certified'}
                      {op.certificationExpiration && ` • Expires ${formatDate(op.certificationExpiration, timezone)}`}
                    </p>
                    {op.evocLevel && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-500/10 text-blue-700 dark:text-blue-400">
                        {op.evocLevel.name}
                      </span>
                    )}
                  </div>
                  {op.licenseTypeRequired && (
                    <p className="text-theme-text-muted text-xs mt-0.5">
                      License: {op.licenseTypeRequired}
                      {op.licenseVerified && ' (Verified)'}
                    </p>
                  )}
                  {op.hasRestrictions && (
                    <p className="text-yellow-700 dark:text-yellow-400 text-sm mt-1">
                      Has Restrictions
                      {op.restrictionNotes && ` — ${op.restrictionNotes}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span
                    className={`px-2 py-1 text-xs rounded ${
                      op.isActive ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-theme-surface-secondary text-theme-text-muted'
                    }`}
                  >
                    {op.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={() => handleEdit(op)}
                    className="p-1.5 text-theme-text-muted hover:text-theme-text-primary transition-colors rounded-md hover:bg-theme-surface-secondary"
                    title="Edit operator"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(op)}
                    className="p-1.5 text-theme-text-muted hover:text-red-600 transition-colors rounded-md hover:bg-theme-surface-secondary"
                    title="Remove operator"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <OperatorModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={onRefresh}
        apparatusId={apparatusId}
        editOperator={editOperator}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title="Remove Operator"
        message="Are you sure you want to remove this operator from this apparatus? This action cannot be undone."
        confirmLabel="Remove"
        variant="danger"
      />
    </>
  );
};

export default OperatorsTab;
