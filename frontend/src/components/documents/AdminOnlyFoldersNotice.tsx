/**
 * Folders that have come to open to full administrators alone (decision 30).
 *
 * A folder is checked when it is saved (decision 29), but it can also lose its
 * audience without being touched: the last member holding its permission or
 * position leaves it, is archived, or changes rank. Those changes come from
 * many screens and from unattended jobs, so the server lists the result here
 * instead of asking at each of them. Shown to full administrators only — they
 * are the only people who can open these folders to fix them.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { documentsService } from '../../services/api';
import type { DocumentFolder } from '../../services/formsServices';
import { getErrorMessage } from '../../utils/errorHandling';

interface AdminOnlyFoldersNoticeProps {
  /** Open the folder's access settings. */
  onManage: (folder: DocumentFolder) => void;
  /** Changed by the page after a folder is saved, so the list is read again. */
  refreshKey: number;
}

export const AdminOnlyFoldersNotice: React.FC<AdminOnlyFoldersNoticeProps> = ({ onManage, refreshKey }) => {
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFolders(await documentsService.getAdminOnlyFolders());
    } catch {
      // A notice that cannot load must not take the page with it: the page's
      // own folders are unaffected, and the check runs again on the next visit.
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const keepForAdministrators = async (folder: DocumentFolder) => {
    setConfirming(folder.id);
    try {
      await documentsService.confirmAdminOnlyFolder(folder.id);
      toast.success(`“${folder.name}” is kept for administrators only`);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to confirm this folder'));
    } finally {
      setConfirming(null);
    }
  };

  if (folders.length === 0) return null;

  return (
    <section className="alert-warning mb-6 p-4" aria-labelledby="admin-only-folders-heading">
      <div className="flex items-start gap-2">
        <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="admin-only-folders-heading" className="text-theme-text-primary text-sm font-semibold">
            {folders.length === 1
              ? 'A folder only full administrators can open'
              : `${folders.length} folders only full administrators can open`}
          </h2>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Nobody else holds the position or permission these folders now require — usually because a member changed
            position or left. Change who can open each one, or keep it for administrators if that is intended.
          </p>
          <ul className="mt-3 space-y-2">
            {folders.map((folder) => (
              <li key={folder.id} className="split-row border-theme-surface-border gap-2 border-t pt-2 sm:items-center">
                <span className="split-row-main text-theme-text-primary text-sm font-medium break-words">
                  {folder.name}
                </span>
                <span className="split-row-aside flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-sm"
                    onClick={() => onManage(folder)}
                    aria-label={`Change who can open ${folder.name}`}
                  >
                    Change access
                  </button>
                  <button
                    type="button"
                    className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary touch:min-h-11 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-60"
                    onClick={() => void keepForAdministrators(folder)}
                    disabled={confirming !== null}
                    aria-label={`Keep ${folder.name} for administrators only`}
                  >
                    {confirming === folder.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    Keep for administrators only
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default AdminOnlyFoldersNotice;
