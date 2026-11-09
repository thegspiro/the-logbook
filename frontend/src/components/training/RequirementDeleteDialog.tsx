import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Archive, Loader2, ShieldAlert } from 'lucide-react';
import { Modal } from '../Modal';
import { trainingService } from '../../services/api';
import { useTablist } from '../../hooks/useTablist';
import type { TrainingRequirement, TrainingRequirementDeletionImpact } from '../../types/training';

/** What the officer chose; the page reloads and reports it. */
export type RequirementDeleteAction = 'delete' | 'deactivate' | 'permanent';

interface RequirementDeleteDialogProps {
  requirement: TrainingRequirement | null;
  onClose: () => void;
  /**
   * Carries out the choice. Rejects to keep the dialog open — the caller
   * reports the error.
   */
  onConfirm: (requirement: TrainingRequirement, action: RequirementDeleteAction) => Promise<void>;
}

type Tab = 'deactivate' | 'permanent';

/**
 * Deleting a training requirement.
 *
 * Nothing uses it: one confirmation, and it is deleted. Something does: the
 * dialog lists what, and offers the two ways out — deactivate, which keeps
 * every record and is how a requirement members were graded against should be
 * retired, or a permanent delete, for a department clearing out what it set up
 * while trying things. The permanent delete states what goes and what stays,
 * and needs the requirement's name typed, because it cannot be undone.
 */
export const RequirementDeleteDialog: React.FC<RequirementDeleteDialogProps> = ({
  requirement,
  onClose,
  onConfirm,
}) => {
  const tablist = useTablist();
  const [tab, setTab] = useState<Tab>('deactivate');
  const [impact, setImpact] = useState<TrainingRequirementDeletionImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [working, setWorking] = useState(false);

  const fetchImpact = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      setImpact(await trainingService.getRequirementDeletionImpact(id));
    } catch {
      setLoadError('Could not check what uses this requirement. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!requirement) return;
    setImpact(null);
    setConfirmName('');
    setWorking(false);
    // An inactive requirement has nothing left to deactivate.
    setTab(requirement.active ? 'deactivate' : 'permanent');
    void fetchImpact(requirement.id);
  }, [requirement, fetchImpact]);

  if (!requirement) return null;

  const run = async (action: RequirementDeleteAction) => {
    setWorking(true);
    try {
      await onConfirm(requirement, action);
      onClose();
    } catch {
      // The caller has already reported it; stay open so the officer can retry.
    } finally {
      setWorking(false);
    }
  };

  const removed = impact?.references.filter((ref) => ref.on_delete === 'removed') ?? [];
  const unlinked = impact?.references.filter((ref) => ref.on_delete === 'unlinked') ?? [];
  const nameMatches = confirmName.trim().toLowerCase() === requirement.name.trim().toLowerCase();

  const cancelButton = (
    <button type="button" onClick={onClose} disabled={working} className="btn-secondary text-sm font-medium">
      Keep it
    </button>
  );

  return (
    <Modal isOpen onClose={onClose} title="Delete requirement" size="md" closeOnEscape={!working}>
      {loading && (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="text-theme-text-muted ml-2 text-sm">Checking what uses this requirement...</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
            <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchImpact(requirement.id)}
            className="mt-2 text-sm text-red-700 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && impact && impact.total === 0 && (
        <div className="space-y-4">
          <p className="text-theme-text-secondary text-sm">
            Nothing uses &ldquo;{requirement.name}&rdquo;, so it will be deleted. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            {cancelButton}
            <button
              type="button"
              onClick={() => void run('delete')}
              disabled={working}
              className="btn-primary text-sm font-medium"
            >
              {working ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && impact && impact.total > 0 && (
        <div className="space-y-4">
          <div className="bg-theme-surface-secondary rounded-lg p-3">
            <p className="text-theme-text-primary mb-2 text-sm font-medium">
              &ldquo;{requirement.name}&rdquo; is in use by:
            </p>
            <ul className="text-theme-text-secondary space-y-1 text-sm" aria-label="Records that use this requirement">
              {impact.references.map((ref) => (
                <li key={ref.kind} className="flex justify-between gap-4">
                  <span>{ref.label}</span>
                  <span className="text-theme-text-primary font-medium">{ref.count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="inline-flex w-full rounded-md shadow-xs"
            role="tablist"
            {...tablist}
            aria-label="How to delete"
          >
            <button
              type="button"
              role="tab"
              id="tab-requirement-deactivate"
              aria-selected={tab === 'deactivate'}
              aria-controls="tabpanel-requirement-deactivate"
              onClick={() => setTab('deactivate')}
              disabled={working}
              className={`flex-1 rounded-l-lg border px-4 py-2 text-sm font-medium focus:z-10 focus:ring-2 disabled:opacity-50 ${
                tab === 'deactivate'
                  ? 'z-10 border-amber-800 bg-amber-800 text-white'
                  : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
              }`}
            >
              Deactivate (recommended)
            </button>
            <button
              type="button"
              role="tab"
              id="tab-requirement-permanent"
              aria-selected={tab === 'permanent'}
              aria-controls="tabpanel-requirement-permanent"
              onClick={() => setTab('permanent')}
              disabled={working}
              className={`flex-1 rounded-r-lg border px-4 py-2 text-sm font-medium focus:z-10 focus:ring-2 disabled:opacity-50 ${
                tab === 'permanent'
                  ? 'z-10 border-red-800 bg-red-800 text-white'
                  : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
              }`}
            >
              Permanently delete
            </button>
          </div>

          {tab === 'deactivate' && (
            <div
              className="space-y-4"
              role="tabpanel"
              id="tabpanel-requirement-deactivate"
              aria-labelledby="tab-requirement-deactivate"
            >
              <div className="flex items-start gap-2">
                <Archive className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="text-theme-text-secondary text-sm">
                  {impact.active
                    ? 'Deactivating stops grading members against this requirement and hides it from the list. ' +
                      'Every record above is kept, so members’ history and past compliance stay intact, and you ' +
                      'can reactivate it at any time. This is the way to retire a requirement members have been ' +
                      'graded against.'
                    : 'This requirement is already inactive: it no longer grades anyone, and every record above ' +
                      'is kept. Nothing more is needed to retire it.'}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                {cancelButton}
                {impact.active && (
                  <button
                    type="button"
                    onClick={() => void run('deactivate')}
                    disabled={working}
                    className="btn-warning text-sm font-medium"
                  >
                    {working ? 'Deactivating...' : 'Deactivate'}
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'permanent' && (
            <div
              className="space-y-4"
              role="tabpanel"
              id="tabpanel-requirement-permanent"
              aria-labelledby="tab-requirement-permanent"
            >
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <div className="text-sm text-red-700 dark:text-red-400">
                    <p className="font-medium">This is permanent and cannot be undone.</p>
                    <p className="mt-1">
                      Use it only for a requirement created by mistake or while setting up. If members have been graded
                      against it, deactivate it instead: a permanent delete erases their progress toward it, and past
                      compliance can no longer show it.
                    </p>
                  </div>
                </div>
              </div>

              {removed.length > 0 && (
                <div className="bg-theme-surface-secondary rounded-lg p-3">
                  <p className="text-theme-text-muted mb-2 text-xs font-medium uppercase">Deleted with it</p>
                  <ul className="text-theme-text-secondary space-y-1 text-sm" aria-label="Deleted with it">
                    {removed.map((ref) => (
                      <li key={ref.kind} className="flex justify-between gap-4">
                        <span>{ref.label}</span>
                        <span className="font-medium text-red-700 dark:text-red-400">{ref.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {unlinked.length > 0 && (
                <div className="bg-theme-surface-secondary rounded-lg p-3">
                  <p className="text-theme-text-muted mb-2 text-xs font-medium uppercase">
                    Kept, without this requirement
                  </p>
                  <ul
                    className="text-theme-text-secondary space-y-1 text-sm"
                    aria-label="Kept, without this requirement"
                  >
                    {unlinked.map((ref) => (
                      <li key={ref.kind} className="flex justify-between gap-4">
                        <span>{ref.label}</span>
                        <span className="text-theme-text-primary font-medium">{ref.count}</span>
                      </li>
                    ))}
                  </ul>
                  {unlinked.some((ref) => ref.kind === 'training_waivers') && (
                    <p className="text-theme-text-muted mt-2 text-xs">
                      A waiver that excused only this requirement is deactivated rather than edited, so it cannot turn
                      into a waiver of every requirement.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="confirm-requirement-name" className="text-theme-text-secondary mb-1 block text-sm">
                  Type <span className="text-theme-text-primary font-semibold">{requirement.name}</span> to confirm:
                </label>
                <input
                  id="confirm-requirement-name"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={working}
                  className="form-input disabled:opacity-50"
                  autoComplete="off"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {cancelButton}
                <button
                  type="button"
                  onClick={() => void run('permanent')}
                  disabled={working || !nameMatches}
                  className="btn-primary text-sm font-medium disabled:opacity-50"
                >
                  {working ? 'Deleting...' : 'Permanently delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
