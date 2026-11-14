/**
 * Assignment terms: the step between choosing a member and assigning an item.
 *
 * An assignment is either permanent or temporary, and a temporary one is
 * defined by the date it is due back — the API refuses a temporary assignment
 * without a future date, and a permanent one with any date at all.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';

export interface AssignTerms {
  assignment_type: 'permanent' | 'temporary';
  expected_return_date?: string | undefined;
}

interface AssignTermsModalProps {
  isOpen: boolean;
  memberName: string;
  itemName: string;
  submitting?: boolean;
  /** The server's refusal of the return date on the last attempt, shown on that field. */
  returnDateError?: string | undefined;
  onClose: () => void;
  onConfirm: (terms: AssignTerms) => void;
}

export const AssignTermsModal: React.FC<AssignTermsModalProps> = ({
  isOpen,
  memberName,
  itemName,
  submitting = false,
  returnDateError,
  onClose,
  onConfirm,
}) => {
  const tz = useTimezone();
  const [assignmentType, setAssignmentType] = useState<AssignTerms['assignment_type']>('permanent');
  const [returnAt, setReturnAt] = useState('');
  const [dateError, setDateError] = useState<string | undefined>();
  // Terms chosen are lost on close, so Escape, the X and Cancel ask first (forms review F-6).
  const requestClose = useDiscardGuard({ isDirty: assignmentType !== 'permanent' || returnAt !== '', onClose });

  // Fresh terms on every opening, so a date chosen for one member is never
  // carried onto the next assignment.
  useEffect(() => {
    if (isOpen) {
      setAssignmentType('permanent');
      setReturnAt('');
      setDateError(undefined);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!returnDateError) return;
    setDateError(returnDateError);
    window.setTimeout(() => document.getElementById('assign-return-date')?.focus(), 0);
  }, [returnDateError]);

  const needsDate = assignmentType === 'temporary' && !returnAt;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (needsDate) return;
    onConfirm(
      assignmentType === 'temporary'
        ? { assignment_type: 'temporary', expected_return_date: localToUTC(returnAt, tz) }
        : { assignment_type: 'permanent' }
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={`Assign ${itemName}`}
      size="sm"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={submitting || needsDate}>
            Assign to {memberName}
          </button>
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Cancel
          </button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="text-theme-text-primary mb-2 text-sm font-medium">How long do they keep it?</legend>
        {(
          [
            ['permanent', 'Permanent', 'Theirs until they return it or leave, like turnouts.'],
            ['temporary', 'Temporary', 'Due back on a date you choose, such as gear for an acting role.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="border-theme-surface-border flex cursor-pointer gap-2 rounded-md border p-3">
            <input
              type="radio"
              name="assignment-type"
              checked={assignmentType === value}
              onChange={() => setAssignmentType(value)}
              aria-labelledby={`assign-${value}-label`}
              aria-describedby={`assign-${value}-hint`}
            />
            <span>
              <span id={`assign-${value}-label`} className="text-theme-text-primary block text-sm font-medium">
                {label}
              </span>
              <span id={`assign-${value}-hint`} className="text-theme-text-muted block text-xs">
                {hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {assignmentType === 'temporary' && (
        // The asterisk is left off: the submit stays disabled until a date is
        // chosen, and the hint says it is needed.
        <FormField
          label="Return date"
          id="assign-return-date"
          className="mt-3"
          error={dateError}
          hint="Needed for a temporary assignment."
        >
          {(field) => (
            <input
              {...field}
              aria-required
              type="datetime-local"
              value={returnAt}
              min={formatForDateTimeInput(new Date(), tz)}
              onChange={(event) => {
                setReturnAt(event.target.value);
                setDateError(undefined);
              }}
              className="form-input block w-full"
            />
          )}
        </FormField>
      )}
    </Modal>
  );
};
