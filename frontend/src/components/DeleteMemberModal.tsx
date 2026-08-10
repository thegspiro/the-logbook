import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, UserX } from 'lucide-react';
import { Modal } from './Modal';
import { userService } from '../services/api';
import type { DeletionImpact } from '../types/user';

interface DeleteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: { id: string; full_name?: string | undefined; username: string; status: string } | null;
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

  const isConfirmNameValid = confirmName.trim().toLowerCase() === memberDisplayName.trim().toLowerCase();

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
        <div className="inline-flex w-full rounded-md shadow-xs" role="tablist" aria-label="Delete mode">
          <button
            type="button"
            role="tab"
            id="tab-soft-delete"
            aria-selected={activeTab === 'soft'}
            aria-controls="tabpanel-soft-delete"
            onClick={() => setActiveTab('soft')}
            disabled={deleting}
            className={`flex-1 border px-4 py-2 text-sm font-medium ${
              activeTab === 'soft'
                ? 'z-10 border-yellow-600 bg-yellow-600 text-white'
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
            } rounded-l-lg focus:z-10 focus:ring-2 focus:ring-yellow-500 disabled:opacity-50`}
          >
            Deactivate
          </button>
          <button
            type="button"
            role="tab"
            id="tab-hard-delete"
            aria-selected={activeTab === 'hard'}
            aria-controls="tabpanel-hard-delete"
            onClick={() => setActiveTab('hard')}
            disabled={deleting}
            className={`flex-1 border px-4 py-2 text-sm font-medium ${
              activeTab === 'hard'
                ? 'z-10 border-red-700 bg-red-700 text-white'
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
            } focus:ring-theme-focus-ring rounded-r-lg focus:z-10 focus:ring-2 disabled:opacity-50`}
          >
            Permanently Delete
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loadingImpact && (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          <span className="text-theme-text-muted ml-2 text-sm">Loading impact assessment...</span>
        </div>
      )}

      {/* Error State */}
      {impactError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
            <p className="text-sm text-red-700 dark:text-red-400">{impactError}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void fetchImpact(member.id);
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
            <div className="space-y-4" role="tabpanel" id="tabpanel-soft-delete" aria-labelledby="tab-soft-delete">
              {/* Member Info */}
              <div className="bg-theme-surface-secondary flex items-center gap-3 rounded-lg p-3">
                <UserX className="h-8 w-8 shrink-0 text-yellow-500" />
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">{memberDisplayName}</p>
                  <p className="text-theme-text-muted text-xs">
                    Current status: <span className="capitalize">{member.status}</span>
                  </p>
                </div>
              </div>

              {/* Impact Summary */}
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500" />
                  <div>
                    <p className="text-sm font-medium text-yellow-500">Impact Summary</p>
                    <p className="text-theme-text-secondary mt-1 text-sm">
                      {impact.training_records} training record{impact.training_records !== 1 ? 's' : ''},{' '}
                      {impact.inventory_items} inventory item{impact.inventory_items !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Explanation */}
              <p className="text-theme-text-secondary text-sm">
                This member will be deactivated. Their records will be preserved but hidden from regular views. You can
                reactivate their account later from the archived members section.
              </p>

              {/* Action Button */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={deleting}
                  className="text-theme-text-secondary bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md border px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSoftDelete();
                  }}
                  disabled={deleting}
                  className="btn-warning rounded-md text-sm font-medium focus:ring-offset-(--ring-offset-bg)"
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
            <div className="space-y-4" role="tabpanel" id="tabpanel-hard-delete" aria-labelledby="tab-hard-delete">
              {/* Danger Warning */}
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
                  <div>
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">
                      This action is PERMANENT and cannot be undone.
                    </p>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400/80">
                      Training history and inventory assignments will be permanently deleted. Uploaded documents are
                      kept, but will no longer show an uploader.
                    </p>
                  </div>
                </div>
              </div>

              {/* Impact Details */}
              <div className="bg-theme-surface-secondary rounded-lg p-3">
                <p className="text-theme-text-muted mb-2 text-xs font-medium uppercase">Records affected</p>
                <ul className="text-theme-text-secondary space-y-1 text-sm">
                  <li className="flex justify-between">
                    <span>Training records</span>
                    <span className="text-theme-text-primary font-medium">{impact.training_records}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Inventory items</span>
                    <span className="text-theme-text-primary font-medium">{impact.inventory_items}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Documents (uploader cleared)</span>
                    <span className="text-theme-text-primary font-medium">{impact.documents}</span>
                  </li>
                  <li className="border-theme-surface-border mt-1 flex justify-between border-t pt-1">
                    <span className="font-medium">Total</span>
                    <span className="font-medium text-red-700 dark:text-red-400">{impact.total_records}</span>
                  </li>
                </ul>
              </div>

              {/* Confirmation Input */}
              <div>
                <label htmlFor="confirm-delete-name" className="text-theme-text-secondary mb-1 block text-sm">
                  Type <span className="text-theme-text-primary font-semibold">{memberDisplayName}</span> to confirm:
                </label>
                <input
                  id="confirm-delete-name"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={deleting}
                  className="form-input disabled:opacity-50"
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
                  className="text-theme-text-secondary bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md border px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleHardDelete();
                  }}
                  disabled={deleting || !isConfirmNameValid}
                  className="focus:ring-theme-focus-ring rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden disabled:opacity-50"
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
