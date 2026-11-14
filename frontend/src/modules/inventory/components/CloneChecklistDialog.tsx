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
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { schedulingService } from '@/modules/scheduling';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type { EquipmentCheckTemplate } from '../types/equipmentCheck';
import { getErrorMessage } from '../../../utils/errorHandling';

const fieldId = 'clone-checklist-apparatus';

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

/**
 * The clone endpoint takes its target as a query parameter, so a 422 on it is
 * reported at `query.target_apparatus_id` (forms review F-2).
 */
const CLONE_FIELDS: Record<'apparatus', ServerFieldSpec> = {
  apparatus: { label: 'Copy onto', api: ['target_apparatus_id', 'query.target_apparatus_id'] },
};

export const CloneChecklistDialog: React.FC<CloneChecklistDialogProps> = ({ template, onClose, onCloned }) => {
  const isOpen = template !== null;
  const [choices, setChoices] = useState<ApparatusChoice[]>([]);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [apparatusId, setApparatusId] = useState('');
  const [touched, setTouched] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // A chosen apparatus is the only thing this dialog holds, so it is what
  // Escape, the X and Cancel ask about before closing (forms review F-6).
  const requestClose = useDiscardGuard({ isDirty: apparatusId !== '', onClose });

  useEffect(() => {
    if (!isOpen) return;
    // Reset on each open: the dialog stays mounted, and a truck chosen for one
    // template must not be preselected for the next.
    setApparatusId('');
    setTouched(false);
    setServerError(null);
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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (!template || missing || cloning) return;
    setCloning(true);
    try {
      const cloned = await equipmentCheckService.cloneEquipmentCheckTemplate(template.id, apparatusId);
      toast.success(`Copied as "${cloned.name}"`);
      onCloned(cloned);
    } catch (err) {
      const mapped = mapServerFieldErrors(err, CLONE_FIELDS);
      if (mapped?.fieldErrors.apparatus) {
        setServerError(mapped.fieldErrors.apparatus);
        document.getElementById(fieldId)?.focus();
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to copy the checklist'));
      }
    } finally {
      setCloning(false);
    }
  };

  const fieldError =
    touched && missing && choices.length > 0 ? 'Choose the apparatus to copy onto.' : (serverError ?? undefined);

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Copy checklist to an apparatus"
      size="sm"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            disabled={cloning}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
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
          <p className={`text-sm ${FIELD_ERROR_CLASS}`} role="alert">
            Could not load the apparatus list. Close this and try again.
          </p>
        ) : noApparatus ? (
          <p className="text-theme-text-secondary text-sm" role="status">
            There is no apparatus to copy onto. A checklist can be copied only onto an apparatus added in the Apparatus
            module.
          </p>
        ) : (
          <FormField label="Copy onto" id={fieldId} error={fieldError}>
            {(props) => (
              <select
                {...props}
                value={apparatusId}
                onChange={(e) => {
                  setApparatusId(e.target.value);
                  setServerError(null);
                }}
                className="form-input"
              >
                <option value="">Choose an apparatus…</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
      </div>
    </Modal>
  );
};

export default CloneChecklistDialog;
