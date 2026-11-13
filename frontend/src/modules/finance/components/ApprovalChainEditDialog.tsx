/**
 * Edit an approval chain's name, description and active flag.
 *
 * Deliberately limited to the three fields that change what a chain is called
 * and whether it is used; routing (applies-to, amounts, category, default) is
 * set when the chain is created.
 */

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import type { ApprovalChain, ApprovalChainUpdatePayload } from '../types';
import { firstErrorField, updateExceptRefused, useDialogFieldErrors } from '../utils/fieldRefusals';

type ChainField = 'name' | 'description' | 'isActive';

/** `ApprovalChainUpdate` (schemas/finance.py); the description has no limit. */
const SERVER_FIELDS: Record<ChainField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 200 },
  description: { label: 'Description' },
  isActive: { label: 'Active', api: ['is_active', 'isActive'] },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as ChainField[];
const PAYLOAD_KEYS: Partial<Record<ChainField, readonly (keyof ApprovalChainUpdatePayload)[]>> = {
  name: ['name'],
  description: ['description'],
  isActive: ['is_active'],
};
const FIELD_IDS: Record<ChainField, string> = {
  name: 'chain-name',
  description: 'chain-description',
  isActive: 'chain-active',
};

interface ApprovalChainEditDialogProps {
  chain: ApprovalChain;
  onClose: () => void;
  /** Sends the update; rejects as the API does, so the dialog can place a refusal. */
  save: (data: ApprovalChainUpdatePayload) => Promise<void>;
  /** Called once everything saved. */
  onSaved: () => void;
}

export const ApprovalChainEditDialog: React.FC<ApprovalChainEditDialogProps> = ({ chain, onClose, save, onSaved }) => {
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description || '');
  const [isActive, setIsActive] = useState(chain.isActive);
  const { errors, setErrors, clearError } = useDialogFieldErrors<ChainField>();
  const [saving, setSaving] = useState(false);
  const initial = useRef({ name, description, isActive });
  const isDirty =
    name !== initial.current.name ||
    description !== initial.current.description ||
    isActive !== initial.current.isActive;
  // Escape, the X and Cancel all ask before throwing away a changed chain.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<ChainField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!flag(trimmed ? {} : { name: 'Enter a name for this chain.' })) return;
    void submit({ name: trimmed, description: blankToNull(description), is_active: isActive });
  };

  const submit = async (payload: ApprovalChainUpdatePayload) => {
    setSaving(true);
    try {
      // Owner rule (2026-11-05) for a single-save edit: a refused value is not
      // written, the rest saves, and the field stays flagged.
      const { refused } = await updateExceptRefused(save, payload, SERVER_FIELDS, PAYLOAD_KEYS);
      const first = firstErrorField(refused, FIELD_ORDER);
      if (first) {
        flag(refused);
        // What did save is now the stored chain, so closing loses nothing.
        initial.current = { name, description, isActive };
        toast.error(`Chain saved, except ${SERVER_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''}`);
        return;
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the chain.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Edit chain"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Save chain
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField id={FIELD_IDS.name} label="Name" error={errors.name} maxLength={200} count={name.length}>
          {(field) => (
            <input
              {...field}
              className="form-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearError('name');
              }}
            />
          )}
        </FormField>
        <FormField id={FIELD_IDS.description} label="Description" error={errors.description}>
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearError('description');
              }}
            />
          )}
        </FormField>
        <label className="text-theme-text-primary touch:min-h-[44px] flex items-start gap-2 text-sm">
          <input
            id={FIELD_IDS.isActive}
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={isActive}
            onChange={(e) => {
              setIsActive(e.target.checked);
              clearError('isActive');
            }}
            aria-invalid={errors.isActive ? true : undefined}
          />
          <span>
            Active
            <span className="text-theme-text-secondary block text-xs">
              Only active chains are used for newly submitted requests. Turning a chain off does not change requests
              already going through it.
            </span>
            {errors.isActive && (
              <span className="mt-1 block text-sm text-red-800 dark:text-red-300">{errors.isActive}</span>
            )}
          </span>
        </label>
      </div>
    </Modal>
  );
};

export default ApprovalChainEditDialog;
