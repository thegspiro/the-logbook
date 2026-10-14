/**
 * Manage one document folder: rename it, choose who may open it, move it, or
 * delete it with everything inside.
 *
 * Access is Organization, Leadership, or Specific positions, optionally with
 * required permissions (decision 27; `FolderAccessFields`). A system folder — one
 * the application made for a module — keeps its name and place and cannot be
 * deleted; the server refuses all three, and this dialog does not offer them.
 * Delete cascades to every subfolder and document, so it goes through
 * `useConfirm()` with a message that says what will be removed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Folder, Loader2 } from 'lucide-react';
import { Modal } from '../Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { documentsService, type DocumentFolder } from '../../services/api';
import { blankToNull } from '../../utils/formValues';
import { getErrorMessage } from '../../utils/errorHandling';
import { FolderAccessFields } from './FolderAccessFields';
import {
  ADMIN_ONLY_CONFIRMATION,
  EMPTY_FOLDER_ACCESS,
  folderAccessIncomplete,
  isAdminOnlyRefusal,
  folderAccessOf,
  folderAccessPayload,
  type FolderAccessValue,
} from './folderAccess';

interface FolderManageDialogProps {
  folder: DocumentFolder | null;
  onClose: () => void;
  /** After a save or delete; the page re-reads the level it is on. */
  onChanged: (change: 'saved' | 'deleted') => void;
}

export const FolderManageDialog: React.FC<FolderManageDialogProps> = ({ folder, onClose, onChanged }) => {
  const { confirm } = useConfirm();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [access, setAccess] = useState<FolderAccessValue>(EMPTY_FOLDER_ACCESS);
  // Move: `undefined` = stay put; `null` = top level; otherwise the folder.
  const [destination, setDestination] = useState<DocumentFolder | null | undefined>(undefined);
  const [browsePath, setBrowsePath] = useState<DocumentFolder[]>([]);
  const [browseFolders, setBrowseFolders] = useState<DocumentFolder[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh state for every folder opened, so nothing typed for one is saved on another.
  useEffect(() => {
    if (!folder) return;
    setName(folder.name);
    setDescription(folder.description ?? '');
    setAccess(folderAccessOf(folder));
    setDestination(undefined);
    setBrowsePath([]);
    setError(null);
  }, [folder]);

  const browseParent = browsePath[browsePath.length - 1];
  useEffect(() => {
    if (!folder || folder.is_system) return;
    let cancelled = false;
    setBrowsing(true);
    documentsService
      .getFolders({ ...(browseParent ? { parent_id: browseParent.id } : {}), limit: 100 })
      .then((response) => {
        // The folder itself is no destination, and nothing inside it can be:
        // leaving it out of the list keeps its own subtree unreachable here.
        if (!cancelled) setBrowseFolders(response.folders.filter((f) => f.id !== folder.id));
      })
      .catch(() => {
        if (!cancelled) setBrowseFolders([]);
      })
      .finally(() => {
        if (!cancelled) setBrowsing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folder, browseParent]);

  const browseLevelId = browseParent?.id ?? null;
  const isCurrentParent = (folder?.parent_id ?? null) === browseLevelId;
  const ownerFolder = folder?.visibility === 'owner';

  const destinationLabel = useMemo(() => {
    if (destination === undefined) return null;
    return destination === null ? 'the top level' : `“${destination.name}”`;
  }, [destination]);

  if (!folder) return null;

  const rolesMissing = folderAccessIncomplete(access);

  const handleSave = async () => {
    if (!folder.is_system && !name.trim()) {
      setError('Give the folder a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      // Every field the dialog owns is sent, so clearing one persists.
      ...(folder.is_system ? {} : { name: name.trim() }),
      description: blankToNull(description),
      ...(ownerFolder ? {} : folderAccessPayload(access, { isSystem: Boolean(folder.is_system) })),
      ...(destination !== undefined ? { parent_id: destination?.id ?? null } : {}),
    };
    try {
      try {
        await documentsService.updateFolder(folder.id, payload);
      } catch (err: unknown) {
        if (!isAdminOnlyRefusal(err)) throw err;
        if (!(await confirm(ADMIN_ONLY_CONFIRMATION))) return;
        await documentsService.updateFolder(folder.id, { ...payload, confirm_admin_only: true });
      }
      onChanged('saved');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to save the folder.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    // How many subfolders the cascade takes with it; unknown if the count
    // cannot be read, and the message then says so in general terms.
    const subfolders = await documentsService
      .getFolders({ parent_id: folder.id, limit: 1 })
      .then((response) => response.total)
      .catch(() => null);
    const docs = folder.document_count;
    const contents = [
      `${docs} ${docs === 1 ? 'document' : 'documents'} directly in it`,
      subfolders === null
        ? 'every folder inside it, with their documents'
        : subfolders === 0
          ? 'no subfolders'
          : `${subfolders} ${subfolders === 1 ? 'subfolder' : 'subfolders'}, with everything inside them`,
    ];
    const proceed = await confirm({
      title: `Delete “${folder.name}”?`,
      message: (
        <div className="space-y-2 text-left">
          <p>This permanently removes the folder and everything in it:</p>
          <ul className="list-disc pl-5">
            {contents.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>The files are deleted too. This cannot be undone.</p>
        </div>
      ),
      confirmLabel: 'Delete folder and contents',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!proceed) return;
    setSaving(true);
    setError(null);
    try {
      await documentsService.deleteFolder(folder.id);
      onChanged('deleted');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to delete the folder.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Manage “${folder.name}”`}
      // Its own id: the delete confirmation opens a second dialog on top, and
      // both would otherwise be labelled by the first "modal-title" found.
      titleId="folder-manage-title"
      size="md"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={saving || rolesMissing}>
            {saving && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="alert-danger" role="alert">
            {error}
          </p>
        )}

        <label className="form-label block">
          Name
          <input
            className="form-input mt-1 block w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={folder.is_system}
            maxLength={255}
          />
        </label>
        {folder.is_system && (
          <p className="text-theme-text-muted -mt-3 text-xs">
            A system folder keeps its name and place, and cannot be deleted: the module that made it files into it.
          </p>
        )}

        <label className="form-label block">
          Description
          <textarea
            className="form-input mt-1 block w-full"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        {ownerFolder ? (
          <p className="text-theme-text-secondary text-sm">
            A personal folder: only its member and full administrators open it, and that can’t be changed.
          </p>
        ) : (
          <FolderAccessFields
            idPrefix="folder-manage"
            value={access}
            onChange={setAccess}
            moduleRights={folder.is_system ? (folder.required_permissions ?? null) : undefined}
          />
        )}

        {!folder.is_system && (
          <section aria-labelledby="folder-move-heading" className="space-y-2">
            <h4 id="folder-move-heading" className="text-theme-text-primary text-sm font-medium">
              Move
            </h4>
            <div className="border-theme-surface-border rounded-md border">
              <div className="border-theme-surface-border flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-theme-text-secondary text-sm">
                  {browseParent ? browseParent.name : 'Top level'}
                </span>
                {browseParent && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setBrowsePath((path) => path.slice(0, -1))}
                  >
                    <ArrowLeft className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                    Up
                  </button>
                )}
              </div>
              <ul className="max-h-48 overflow-y-auto">
                {browsing ? (
                  <li className="text-theme-text-muted px-3 py-2 text-sm">Loading…</li>
                ) : browseFolders.length === 0 ? (
                  <li className="text-theme-text-muted px-3 py-2 text-sm">No folders here.</li>
                ) : (
                  browseFolders.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="hover:bg-theme-surface-hover touch:min-h-11 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                        onClick={() => setBrowsePath((path) => [...path, candidate])}
                      >
                        <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="text-theme-text-primary">{candidate.name}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="border-theme-surface-border flex items-center justify-between gap-2 border-t px-3 py-2">
                <span className="text-theme-text-muted text-xs">{isCurrentParent ? 'It is already here.' : ''}</span>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={isCurrentParent}
                  onClick={() => setDestination(browseParent ?? null)}
                >
                  Move here
                </button>
              </div>
            </div>
            {destinationLabel && (
              <p className="text-theme-text-secondary text-sm" role="status">
                Will move to {destinationLabel} when you save.{' '}
                <button type="button" className="underline" onClick={() => setDestination(undefined)}>
                  Undo
                </button>
              </p>
            )}
          </section>
        )}

        {!folder.is_system && (
          <section className="border-theme-surface-border border-t pt-4">
            <button
              type="button"
              className="btn-secondary text-red-700 dark:text-red-300"
              disabled={saving}
              onClick={() => void handleDelete()}
            >
              Delete folder…
            </button>
          </section>
        )}
      </div>
    </Modal>
  );
};

export default FolderManageDialog;
