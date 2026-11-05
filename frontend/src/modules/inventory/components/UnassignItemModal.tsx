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
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';

export interface UnassignReturn {
  return_condition: string;
  return_notes?: string | undefined;
}

interface UnassignItemModalProps {
  isOpen: boolean;
  itemName: string;
  memberName: string;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (details: UnassignReturn) => void;
}

export const UnassignItemModal: React.FC<UnassignItemModalProps> = ({
  isOpen,
  itemName,
  memberName,
  submitting = false,
  onClose,
  onConfirm,
}) => {
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');

  // Fresh on every opening, so a condition recorded for one return is never
  // carried onto the next.
  useEffect(() => {
    if (isOpen) {
      setCondition('');
      setNotes('');
    }
  }, [isOpen]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!condition) return;
    onConfirm({ return_condition: condition, return_notes: notes.trim() || undefined });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Unassign ${itemName}`}
      size="sm"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={submitting || !condition}>
            Unassign and record return
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Keep it assigned
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">
        This returns the item from <strong className="text-theme-text-primary">{memberName}</strong>. Poor or damaged
        gear goes to maintenance instead of back on the shelf.
      </p>
      <fieldset className="space-y-2">
        <legend className="text-theme-text-primary mb-2 text-sm font-medium">
          What condition did it come back in?
        </legend>
        <div className="flex flex-wrap gap-2">
          {RETURN_CONDITION_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="border-theme-surface-border touch-target-phone flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="return-condition"
                value={option.value}
                checked={condition === option.value}
                onChange={() => setCondition(option.value)}
              />
              <span className="text-theme-text-primary">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="form-label mt-3 block">
        Return notes (optional)
        <textarea
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="form-input mt-1 block w-full"
          placeholder="e.g. Torn left sleeve"
        />
      </label>
    </Modal>
  );
};
