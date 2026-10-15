/**
 * Choose the outline new minutes start from.
 *
 * Shown when a meeting has no minutes yet. The department's default outline for
 * that kind of meeting is preselected, so the common case is one click.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { TemplateListItem } from '../types/minutes';

interface OutlinePickerDialogProps {
  isOpen: boolean;
  /** The meeting's type, to preselect that kind's default outline. */
  meetingType: string;
  busy: boolean;
  onClose: () => void;
  onChoose: (outlineId: string) => void;
  title?: string;
  intro?: string;
  confirmLabel?: string;
}

export const OutlinePickerDialog: React.FC<OutlinePickerDialogProps> = ({
  isOpen,
  meetingType,
  busy,
  onClose,
  onChoose,
  title = 'Start the minutes from an outline',
  intro = 'An outline is your order of business. The minutes start with its sections, in its order.',
  confirmLabel = 'Create minutes',
}) => {
  const [outlines, setOutlines] = useState<TemplateListItem[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setOutlines(null);
    setError(null);
    minutesService
      .getOutlines()
      .then((list) => {
        setOutlines(list);
        const ofKind = list.filter((o) => o.meeting_type === meetingType);
        setChosen((ofKind.find((o) => o.is_default) ?? ofKind[0] ?? list[0])?.id ?? '');
      })
      .catch((err: unknown) => {
        setOutlines([]);
        setError(getErrorMessage(err, 'Could not load the outlines'));
      });
  }, [isOpen, meetingType]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen) onChoose(chosen);
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={busy || !chosen} className="btn-primary">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">{intro}</p>
      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {outlines === null ? (
        <p className="text-theme-text-muted text-sm" role="status">
          Loading outlines…
        </p>
      ) : (
        <div>
          <label htmlFor="outline-choice" className="form-label">
            Outline
          </label>
          <select id="outline-choice" value={chosen} onChange={(e) => setChosen(e.target.value)} className="form-input">
            {outlines.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.is_default ? ' (default)' : ''} — {o.section_count} sections
              </option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
};

export default OutlinePickerDialog;
