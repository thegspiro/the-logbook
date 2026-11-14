/**
 * Completing calibration (owner decision 2026-11-02: flag items, no notes).
 *
 * The calibrator ticks the evaluator's items they want revisited. Only the
 * ticks are kept: what was discussed goes to the evaluator in person. The
 * evaluator is emailed, and the member sees the ticks once the evaluation is
 * released to them.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';
import type { TemplateDefinition } from '../../types/evaluations';
import { partItems } from '../../utils/evaluationRecord';

interface CalibrationDialogProps {
  isOpen: boolean;
  definition: TemplateDefinition;
  busy: boolean;
  onClose: () => void;
  onComplete: (flaggedItems: string[]) => void;
}

export const CalibrationDialog: React.FC<CalibrationDialogProps> = ({
  isOpen,
  definition,
  busy,
  onClose,
  onComplete,
}) => {
  const [flagged, setFlagged] = useState<string[]>([]);

  // Ticks chosen for one evaluation are never carried to the next.
  useEffect(() => {
    if (isOpen) setFlagged([]);
  }, [isOpen]);

  const items = partItems(definition, 'evaluator');
  const toggle = (key: string, on: boolean) =>
    setFlagged((current) => (on ? [...current, key] : current.filter((k) => k !== key)));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onComplete(items.map((item) => item.key).filter((key) => flagged.includes(key)));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Complete calibration"
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Not yet
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {flagged.length > 0 ? `Mark complete, ${flagged.length} flagged` : 'Mark complete'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-theme-text-primary">
          Tick any items you want the evaluator to revisit before they lock the evaluation. Discuss the changes with
          them directly.
        </p>
        <p className="text-theme-text-secondary">
          Only the ticks are kept. The evaluator is emailed, and the member sees which items were flagged once the
          evaluation reaches them.
        </p>
        <fieldset>
          <legend className="form-label">Flag for the evaluator</legend>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.key}>
                <label className="touch:min-h-11 flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={flagged.includes(item.key)}
                    onChange={(e) => toggle(item.key, e.target.checked)}
                  />
                  <span className="text-theme-text-primary">{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
    </Modal>
  );
};
