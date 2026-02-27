import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, UserX } from 'lucide-react';
import { Modal } from './Modal';
import { userService } from '../services/api';
import type { DeletionImpact } from '../types/user';

interface DeleteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: { id: string; full_name?: string; username: string; status: string } | null;
  onSoftDelete: (userId: string) => Promise<void>;
  onHardDelete: (userId: string) => Promise<void>;
}

type DeleteTab = 'soft' | 'hard';

export const DeleteMemberModal: React.FC<DeleteMemberModalProps> = ({
  isOpen,
  onClose,
  member,
  onSoftDelete,
  onHardDelete,
}) => {
  const [activeTab, setActiveTab] = useState<DeleteTab>('soft');
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const memberDisplayName = member?.full_name || member?.username || '';

  const fetchImpact = useCallback(async (userId: string) => {
    setLoadingImpact(true);
    setImpactError(null);
    try {
      const data = await userService.getDeletionImpact(userId);
      setImpact(data);
    } catch {
      setImpactError('Failed to load deletion impact. Please try again.');
    } finally {
      setLoadingImpact(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && member) {
      setActiveTab('soft');
      setConfirmName('');
      setDeleting(false);
      setImpact(null);
      setImpactError(null);
      void fetchImpact(member.id);
    }
  }, [isOpen, member, fetchImpact]);

  const handleSoftDelete = async () => {
    if (!member) return;
    setDeleting(true);
    try {
      await onSoftDelete(member.id);
      onClose();
    } catch {
      // Error handling is delegated to the parent callback
    } finally {
      setDeleting(false);
    }
  };

  const handleHardDelete = async () => {
    if (!member) return;
    setDeleting(true);
    try {
      await onHardDelete(member.id);
      onClose();
    } catch {
      // Error handling is delegated to the parent callback
    } finally {
      setDeleting(false);
    }
  };

  const isConfirmNameValid =
    confirmName.trim().toLowerCase() === memberDisplayName.trim().toLowerCase();

  if (!member) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Remove Member: ${memberDisplayName}`}
      size="md"
      closeOnClickOutside={!deleting}
      closeOnEscape={!deleting}
    >
      {/* Tab Toggle */}
      <div className="mb-4">
        <div className="inline-flex rounded-md shadow-sm w-full" role="group" aria-label="Delete mode">
          <button
            type="button"
            onClick={() => setActiveTab('soft')}
            disabled={deleting}
            className={`flex-1 px-4 py-2 text-sm font-medium border ${
              activeTab === 'soft'
                ? 'bg-yellow-600 text-white border-yellow-600 z-10'
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
            } rounded-l-lg focus:z-10 focus:ring-2 focus:ring-yellow-500 disabled:opacity-50`}
          >
            Deactivate
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hard')}
            disabled={deleting}
            className={`flex-1 px-4 py-2 text-sm font-medium border ${
              activeTab === 'hard'
                ? 'bg-red-700 text-white border-red-700 z-10'
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
            } rounded-r-lg focus:z-10 focus:ring-2 focus:ring-red-500 disabled:opacity-50`}
          >
            Permanently Delete
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loadingImpact && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
          <span className="ml-2 text-sm text-theme-text-muted">Loading impact assessment...</span>
        </div>
      )}

      {/* Error State */}
      {impactError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{impactError}</p>
          </div>
          <button
            type="button"
            onClick={() => { void fetchImpact(member.id); }}
            className="mt-2 text-sm text-red-400 underline hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Content - only show after loading */}
      {!loadingImpact && !impactError && impact && (
        <>
          {/* Soft Delete Tab */}
          {activeTab === 'soft' && (
            <div className="space-y-4">
              {/* Member Info */}
              <div className="flex items-center gap-3 p-3 bg-theme-surface-secondary rounded-lg">
                <UserX className="h-8 w-8 text-yellow-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-theme-text-primary">{memberDisplayName}</p>
                  <p className="text-xs text-theme-text-muted">
                    Current status: <span className="capitalize">{member.status}</span>
                  </p>
                </div>
              </div>

              {/* Impact Summary */}
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-500">Impact Summary</p>
                    <p className="text-sm text-theme-text-secondary mt-1">
                      {impact.training_records} training record{impact.training_records !== 1 ? 's' : ''},{' '}
                      {impact.inventory_items} inventory item{impact.inventory_items !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Explanation */}
              <p className="text-sm text-theme-text-secondary">
                This member will be deactivated. Their records will be preserved but hidden from
                regular views. You can reactivate their account later from the archived members
                section.
              </p>

              {/* Action Button */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={deleting}
                  className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSoftDelete(); }}
                  disabled={deleting}
                  className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-md hover:bg-yellow-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 focus:ring-offset-[var(--ring-offset-bg)]"
                >
                  {deleting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deactivating...
                    </span>
                  ) : (
                    'Deactivate Member'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Hard Delete Tab */}
          {activeTab === 'hard' && (
            <div className="space-y-4">
              {/* Danger Warning */}
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-400">
                      This action is PERMANENT and cannot be undone.
                    </p>
                    <p className="text-sm text-red-400/80 mt-1">
                      All records including training history, inventory assignments, and documents
                      will be permanently deleted.
                    </p>
                  </div>
                </div>
              </div>

              {/* Impact Details */}
              <div className="bg-theme-surface-secondary rounded-lg p-3">
                <p className="text-xs text-theme-text-muted uppercase font-medium mb-2">
                  Records to be deleted
                </p>
                <ul className="space-y-1 text-sm text-theme-text-secondary">
                  <li className="flex justify-between">
                    <span>Training records</span>
                    <span className="font-medium text-theme-text-primary">
                      {impact.training_records}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Inventory items</span>
                    <span className="font-medium text-theme-text-primary">
                      {impact.inventory_items}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Documents</span>
                    <span className="font-medium text-theme-text-primary">
                      {impact.documents}
                    </span>
                  </li>
                  <li className="flex justify-between border-t border-theme-surface-border pt-1 mt-1">
                    <span className="font-medium">Total</span>
                    <span className="font-medium text-red-400">
                      {impact.total_records}
                    </span>
                  </li>
                </ul>
              </div>

              {/* Confirmation Input */}
              <div>
                <label
                  htmlFor="confirm-delete-name"
                  className="block text-sm text-theme-text-secondary mb-1"
                >
                  Type <span className="font-semibold text-theme-text-primary">{memberDisplayName}</span> to confirm:
                </label>
                <input
                  id="confirm-delete-name"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={deleting}
                  className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                  placeholder={memberDisplayName}
                  autoComplete="off"
                />
              </div>

              {/* Action Button */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={deleting}
                  className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void handleHardDelete(); }}
                  disabled={deleting || !isConfirmNameValid}
                  className="px-4 py-2 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-[var(--ring-offset-bg)]"
                >
                  {deleting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting...
                    </span>
                  ) : (
                    'Permanently Delete'
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

export default DeleteMemberModal;
