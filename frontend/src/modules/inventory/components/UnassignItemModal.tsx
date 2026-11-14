/**
 * Confirms unassigning an item from its member, and records how it came back.
 *
 * Owner decision 2026-11-01: the item page used to unassign on one click and
 * record no condition, so a coat returned torn went back on the shelf as
 * whatever it was when issued. The condition vocabulary is the Returns
 * screen's (RETURN_CONDITION_OPTIONS), and it is asked for rather than
 * preselected, so the record says what somebody looked at.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';

export interface UnassignReturn {
  return_condition: string;
  return_notes?: string | undefined;
}

export type UnassignField = 'return_condition' | 'return_notes';

/** `UnassignItemRequest.return_notes` is `FreeText`. */
export const RETURN_NOTES_MAX = 2000;

interface UnassignItemModalProps {
  isOpen: boolean;
  itemName: string;
  memberName: string;
  submitting?: boolean;
  /** Fields the server refused on the last attempt, shown on those fields. */
  serverErrors?: Partial<Record<UnassignField, string>> | undefined;
  onClose: () => void;
  onConfirm: (details: UnassignReturn) => void;
}

export const UnassignItemModal: React.FC<UnassignItemModalProps> = ({
  isOpen,
  itemName,
  memberName,
  submitting = false,
  serverErrors,
  onClose,
  onConfirm,
}) => {
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<UnassignField, string>>>({});
  // A condition picked or a note typed is lost on close, so Escape, the X and
  // "Keep it assigned" ask first (forms review F-6).
  const requestClose = useDiscardGuard({ isDirty: condition !== '' || notes !== '', onClose });

  const clearError = (field: UnassignField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // Fresh on every opening, so a condition recorded for one return is never
  // carried onto the next.
  useEffect(() => {
    if (isOpen) {
      setCondition('');
      setNotes('');
      setErrors({});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!serverErrors) return;
    setErrors(serverErrors);
    const first = serverErrors.return_condition
      ? 'unassign-condition-first'
      : serverErrors.return_notes
        ? 'unassign-notes'
        : null;
    if (first) window.setTimeout(() => document.getElementById(first)?.focus(), 0);
  }, [serverErrors]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!condition) {
      setErrors({ return_condition: 'Choose the condition it came back in.' });
      window.setTimeout(() => document.getElementById('unassign-condition-first')?.focus(), 0);
      return;
    }
    onConfirm({ return_condition: condition, return_notes: notes.trim() || undefined });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={`Unassign ${itemName}`}
      size="sm"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={submitting}>
            Unassign and record return
          </button>
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Keep it assigned
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">
        This returns the item from <strong className="text-theme-text-primary">{memberName}</strong>. Poor or damaged
        gear goes to maintenance instead of back on the shelf.
      </p>
      <fieldset
        className="space-y-2"
        aria-describedby={errors.return_condition ? 'unassign-condition-error' : undefined}
        aria-invalid={errors.return_condition ? true : undefined}
      >
        <legend className="text-theme-text-primary mb-2 text-sm font-medium">
          What condition did it come back in?
          <span className="text-red-800 dark:text-red-300" aria-hidden="true">
            {' '}
            *
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {RETURN_CONDITION_OPTIONS.map((option, index) => (
            <label
              key={option.value}
              className="border-theme-surface-border touch-target-phone flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <input
                id={index === 0 ? 'unassign-condition-first' : undefined}
                type="radio"
                name="return-condition"
                value={option.value}
                checked={condition === option.value}
                onChange={() => {
                  setCondition(option.value);
                  clearError('return_condition');
                }}
              />
              <span className="text-theme-text-primary">{option.label}</span>
            </label>
          ))}
        </div>
        {errors.return_condition && (
          <p id="unassign-condition-error" className="text-sm text-red-800 dark:text-red-300">
            {errors.return_condition}
          </p>
        )}
      </fieldset>
      <FormField
        label="Return notes"
        optional
        id="unassign-notes"
        className="mt-3"
        error={errors.return_notes}
        maxLength={RETURN_NOTES_MAX}
        count={notes.length}
      >
        {(field) => (
          <textarea
            {...field}
            rows={2}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              clearError('return_notes');
            }}
            className="form-input block w-full"
            placeholder="e.g. Torn left sleeve"
          />
        )}
      </FormField>
    </Modal>
  );
};
