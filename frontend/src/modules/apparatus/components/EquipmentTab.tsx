/**
 * Equipment Tab Component
 *
 * Displays equipment assigned to an apparatus in a grid layout
 * with support for add/edit/delete via modals.
 */

import React, { useState } from 'react';
import { Link } from 'react-router';
import { Package, MapPin, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ApparatusEquipment } from '../types';
import { apparatusEquipmentService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useAuthStore } from '../../../stores/authStore';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { EquipmentModal } from './EquipmentModal';

interface EquipmentTabProps {
  equipment: ApparatusEquipment[];
  loadingTab: boolean;
  apparatusId: string;
  onRefresh: () => void;
}

export const EquipmentTab: React.FC<EquipmentTabProps> = ({ equipment, loadingTab, apparatusId, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [editEquipment, setEditEquipment] = useState<ApparatusEquipment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApparatusEquipment | null>(null);
  // Matches the gate on /inventory/admin/checklists.
  const canManageChecklists = useAuthStore((state) => state.checkPermission('inventory.check_manage'));

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
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-theme-text-primary flex items-center gap-2 font-bold">
            <Package className="h-5 w-5" />
            Equipment
          </h2>
          <button onClick={handleAdd} className="btn-primary text-sm">
            Add Equipment
          </button>
        </div>
        {/* The two lists are separate records: nothing here feeds a checklist,
            and a newcomer reasonably assumes it does. */}
        <p className="text-theme-text-secondary mb-4 text-sm">
          This list records what the apparatus carries. Crews check equipment at the start of a shift from an equipment
          checklist, which is built separately.{' '}
          {canManageChecklists && (
            <Link
              to="/inventory/admin/checklists"
              className="mobile-touch-target font-medium text-red-800 hover:underline dark:text-red-300"
            >
              Build equipment checklists →
            </Link>
          )}
        </p>
        {loadingTab ? (
          <div className="py-8 text-center">
            <div className="border-theme-text-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
          </div>
        ) : equipment.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center">
            No equipment yet. Select Add Equipment to list what this apparatus carries.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {equipment.map((item) => (
              <div key={item.id} className="card-secondary p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-theme-text-primary font-medium">{item.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text-muted text-sm">Qty: {item.quantity}</span>
                    <button
                      onClick={() => handleEdit(item)}
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded-md p-1 transition-colors"
                      title="Edit equipment"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(item)}
                      className="text-theme-text-muted hover:bg-theme-surface rounded-md p-1 transition-colors hover:text-red-600"
                      title="Remove equipment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {item.description && <p className="text-theme-text-muted mb-2 truncate text-sm">{item.description}</p>}
                {item.locationOnApparatus && (
                  <p className="text-theme-text-muted flex items-center gap-1 text-sm">
                    <MapPin className="h-3 w-3" />
                    {item.locationOnApparatus}
                  </p>
                )}
                {(item.serialNumber || item.assetTag) && (
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {item.serialNumber && `S/N: ${item.serialNumber}`}
                    {item.serialNumber && item.assetTag && ' • '}
                    {item.assetTag && `Asset: ${item.assetTag}`}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  {item.isRequired && (
                    <span className="rounded-sm bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                      Required
                    </span>
                  )}
                  {item.isMounted && (
                    <span className="rounded-sm bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400">
                      Mounted
                    </span>
                  )}
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      item.isPresent
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                        : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
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
        message={`Remove "${deleteTarget?.name ?? ''}" from this apparatus? You can't undo this.`}
        confirmLabel="Remove equipment"
        variant="danger"
      />
    </>
  );
};

export default EquipmentTab;
