/**
 * Clone Checklist Dialog
 *
 * Copies an equipment-check template onto one apparatus. The server clones a
 * template *to an apparatus* — `target_apparatus_id` is required and must be a
 * full Apparatus record in the caller's organization — so the only thing worth
 * asking for is which apparatus. Both clone buttons used to ask for something
 * else (a new name, or nothing at all) and sent it in that field, so every
 * clone was refused with "Target apparatus not found".
 */

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { schedulingService } from '@/modules/scheduling';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type { EquipmentCheckTemplate } from '../types/equipmentCheck';
import { getErrorMessage } from '../../../utils/errorHandling';

interface ApparatusChoice {
  id: string;
  label: string;
}

interface CloneChecklistDialogProps {
  /** The template to copy; the dialog is open while this is set. */
  template: Pick<EquipmentCheckTemplate, 'id' | 'name'> | null;
  onClose: () => void;
  onCloned: (cloned: EquipmentCheckTemplate) => void;
}

export const CloneChecklistDialog: React.FC<CloneChecklistDialogProps> = ({ template, onClose, onCloned }) => {
  const isOpen = template !== null;
  const [choices, setChoices] = useState<ApparatusChoice[]>([]);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [apparatusId, setApparatusId] = useState('');
  const [touched, setTouched] = useState(false);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // Reset on each open: the dialog stays mounted, and a truck chosen for one
    // template must not be preselected for the next.
    setApparatusId('');
    setTouched(false);
    setLoadFailed(false);
    setLoadingChoices(true);
    let cancelled = false;
    void schedulingService
      .getApparatusOptions()
      .then((result) => {
        if (cancelled) return;
        // Only full Apparatus records can hold a checklist (the column is a
        // foreign key to apparatus.id); basic apparatus and onboarding defaults
        // would be refused by the server, so they are not offered.
        const usable =
          result.source === 'apparatus'
            ? result.options.flatMap((option) =>
                option.id
                  ? [
                      {
                        id: option.id,
                        label: option.unit_number ? `${option.unit_number} — ${option.name}` : option.name,
                      },
                    ]
                  : []
              )
            : [];
        setChoices(usable);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingChoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const missing = apparatusId === '';
  const noApparatus = !loadingChoices && !loadFailed && choices.length === 0;

  const handleSubmit = async () => {
    setTouched(true);
    if (!template || missing || cloning) return;
    setCloning(true);
    try {
      const cloned = await equipmentCheckService.cloneEquipmentCheckTemplate(template.id, apparatusId);
      toast.success(`Copied as "${cloned.name}"`);
      onCloned(cloned);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to copy the checklist'));
    } finally {
      setCloning(false);
    }
  };

  const fieldId = 'clone-checklist-apparatus';
  const errorId = 'clone-checklist-apparatus-error';
  const showError = touched && missing && choices.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Copy checklist to an apparatus"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={cloning}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={cloning || loadingChoices || choices.length === 0}
            className="btn-primary inline-flex items-center justify-center gap-2 font-medium disabled:opacity-50"
          >
            {cloning && <Loader2 className="h-4 w-4 animate-spin" />}
            Copy checklist
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {template && (
          <p className="text-theme-text-secondary text-sm">
            Copies every compartment and item from &ldquo;{template.name}&rdquo; onto the apparatus you choose. The copy
            starts switched off, so you can review it before crews use it.
          </p>
        )}
        {loadingChoices ? (
          <p className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading apparatus…
          </p>
        ) : loadFailed ? (
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">
            Could not load the apparatus list. Close this and try again.
          </p>
        ) : noApparatus ? (
          <p className="text-theme-text-secondary text-sm" role="status">
            There is no apparatus to copy onto. A checklist can be copied only onto an apparatus added in the Apparatus
            module.
          </p>
        ) : (
          <div>
            <label htmlFor={fieldId} className="form-label">
              Copy onto
            </label>
            <select
              id={fieldId}
              value={apparatusId}
              onChange={(e) => setApparatusId(e.target.value)}
              aria-invalid={showError}
              {...(showError ? { 'aria-describedby': errorId } : {})}
              className="form-input"
            >
              <option value="">Choose an apparatus…</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
            {showError && (
              <p id={errorId} className="mt-1 text-sm text-red-700 dark:text-red-400">
                Choose the apparatus to copy onto.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CloneChecklistDialog;
