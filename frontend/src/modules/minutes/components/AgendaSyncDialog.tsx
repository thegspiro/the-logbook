/**
 * Review how the meeting's agenda differs from the minutes, and choose what to
 * bring across.
 *
 * Only the frame moves: which items exist, their order, who presents and the
 * prepared motion. What the secretary wrote in a section is never touched, and
 * a section that holds text is detached from the agenda rather than deleted
 * when its item is removed. The list is the server's reading of the
 * difference; nothing here recomputes it.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { AgendaSyncChange, AgendaSyncPreview } from '../types/minutes';

interface AgendaSyncDialogProps {
  isOpen: boolean;
  minutesId: string;
  onClose: () => void;
  /** Called once the chosen changes are applied, so the page can reload the minutes. */
  onApplied: () => void | Promise<void>;
}

const show = (value: unknown): string => {
  if (Array.isArray(value)) return value.length === 0 ? 'none' : `${value.length} linked`;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' || typeof value === 'number') return value === '' ? 'none' : String(value);
  return 'none';
};

const headline = (change: AgendaSyncChange): string => {
  switch (change.type) {
    case 'add':
      return `New item: ${change.title}`;
    case 'update':
      return `Changed: ${change.title}`;
    case 'remove':
      return change.has_content
        ? `Removed from the agenda: ${change.title}. It has text, so it stays as an ordinary section.`
        : `Removed from the agenda: ${change.title}. Its empty section will be deleted.`;
    case 'reorder':
      return 'The items are in a different order on the agenda';
  }
};

export const AgendaSyncDialog: React.FC<AgendaSyncDialogProps> = ({ isOpen, minutesId, onClose, onApplied }) => {
  const [preview, setPreview] = useState<AgendaSyncPreview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPreview(null);
    setError(null);
    minutesService
      .getAgendaSync(minutesId)
      .then((result) => {
        setPreview(result);
        setChosen(new Set(result.changes.map((c) => c.id)));
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to compare the agenda')));
  }, [isOpen, minutesId]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      await minutesService.applyAgendaSync(minutesId, [...chosen]);
      await onApplied();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to sync the agenda'));
    } finally {
      setApplying(false);
    }
  };

  const changes = preview?.changes ?? [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Sync from the agenda"
      size="lg"
      onSubmit={(e) => {
        e.preventDefault();
        void apply();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            {changes.length === 0 ? 'Close' : 'Cancel'}
          </button>
          {changes.length > 0 && (
            <button type="submit" disabled={applying || chosen.size === 0} className="btn-primary">
              {applying ? 'Applying…' : `Apply ${chosen.size} ${chosen.size === 1 ? 'change' : 'changes'}`}
            </button>
          )}
        </>
      }
    >
      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {!preview && !error && <p className="text-theme-text-muted text-sm">Comparing…</p>}
      {preview && changes.length === 0 && (
        <p className="text-theme-text-secondary text-sm">These minutes already match the meeting’s agenda.</p>
      )}
      {changes.length > 0 && (
        <>
          <p className="text-theme-text-secondary mb-3 text-sm">
            The agenda has changed since these minutes were started. Choose what to bring across. Nothing you have
            written in a section is changed.
          </p>
          <ul className="space-y-2">
            {changes.map((change) => (
              <li key={change.id} className="border-theme-surface-border rounded-md border p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={chosen.has(change.id)}
                    onChange={() => toggle(change.id)}
                    className="form-checkbox mt-1"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="text-theme-text-primary font-medium">{headline(change)}</span>
                    {change.fields.length > 0 && (
                      <ul className="text-theme-text-muted mt-1 space-y-0.5 text-xs">
                        {change.fields.map((f) => (
                          <li key={f.field}>
                            {f.field}: {show(f.before)} → {show(f.after)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
};

export default AgendaSyncDialog;
