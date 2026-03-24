/**
 * Equipment Tab Component
 *
 * Displays equipment assigned to an apparatus in a grid layout
 * with support for add/edit/delete via modals.
 */

import React, { useState } from 'react';
import { Package, MapPin, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ApparatusEquipment } from '../types';
import { apparatusEquipmentService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { EquipmentModal } from './EquipmentModal';

interface EquipmentTabProps {
  equipment: ApparatusEquipment[];
  loadingTab: boolean;
  apparatusId: string;
  onRefresh: () => void;
}

export const EquipmentTab: React.FC<EquipmentTabProps> = ({
  equipment,
  loadingTab,
  apparatusId,
  onRefresh,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editEquipment, setEditEquipment] = useState<ApparatusEquipment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApparatusEquipment | null>(null);

  const handleAdd = () => {
    setEditEquipment(null);
    setShowModal(true);
  };

  const handleEdit = (item: ApparatusEquipment) => {
    setEditEquipment(item);
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apparatusEquipmentService.deleteEquipment(deleteTarget.id);
      toast.success('Equipment removed');
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove equipment'));
    }
  };

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Equipment
          </h2>
          <button onClick={handleAdd} className="btn-primary text-sm">
            Add Equipment
          </button>
        </div>
        {loadingTab ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
          </div>
        ) : equipment.length === 0 ? (
          <p className="text-theme-text-muted text-center py-8">No equipment assigned.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {equipment.map((item) => (
              <div
                key={item.id}
                className="card-secondary p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-theme-text-primary font-medium">{item.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text-muted text-sm">Qty: {item.quantity}</span>
                    <button
                      onClick={() => handleEdit(item)}
                      className="p-1 text-theme-text-muted hover:text-theme-text-primary transition-colors rounded-md hover:bg-theme-surface"
                      title="Edit equipment"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(item)}
                      className="p-1 text-theme-text-muted hover:text-red-600 transition-colors rounded-md hover:bg-theme-surface"
                      title="Remove equipment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {item.description && (
                  <p className="text-theme-text-muted text-sm mb-2 truncate">{item.description}</p>
                )}
                {item.locationOnApparatus && (
                  <p className="text-theme-text-muted text-sm flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {item.locationOnApparatus}
                  </p>
                )}
                {(item.serialNumber || item.assetTag) && (
                  <p className="text-theme-text-muted text-xs mt-1">
                    {item.serialNumber && `S/N: ${item.serialNumber}`}
                    {item.serialNumber && item.assetTag && ' • '}
                    {item.assetTag && `Asset: ${item.assetTag}`}
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  {item.isRequired && (
                    <span className="px-2 py-0.5 bg-red-500/10 text-red-700 dark:text-red-400 text-xs rounded-sm">Required</span>
                  )}
                  {item.isMounted && (
                    <span className="px-2 py-0.5 bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs rounded-sm">Mounted</span>
                  )}
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      item.isPresent ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                    }`}
                  >
                    {item.isPresent ? 'Present' : 'Missing'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <EquipmentModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={onRefresh}
        apparatusId={apparatusId}
        editEquipment={editEquipment}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title="Remove Equipment"
        message={`Are you sure you want to remove "${deleteTarget?.name ?? ''}" from this apparatus? This action cannot be undone.`}
        confirmLabel="Remove"
        variant="danger"
      />
    </>
  );
};

export default EquipmentTab;
