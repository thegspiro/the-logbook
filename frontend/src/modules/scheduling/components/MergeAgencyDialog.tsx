/**
 * Merge one outside department into another, for two spellings of the same
 * department ("Arlington County" and "Arlington County Fire Department").
 *
 * The department this dialog opens on is the one that goes; the officer picks
 * the one to keep. The consequences are spelled out before anything happens,
 * because the relabel overwrites the name every past shift was logged under
 * and nothing in the app can put it back (owner decision 2026-11-16).
 */

import React, { useEffect, useId, useState } from 'react';
import { Modal } from '../../../components/Modal';
import type { ExternalAgency } from '../services/api';

interface MergeAgencyDialogProps {
  /** The department being merged away; null when the dialog is closed. */
  source: ExternalAgency | null;
  agencies: ExternalAgency[];
  busy: boolean;
  onClose: () => void;
  onMerge: (source: ExternalAgency, target: ExternalAgency) => void;
}

const nameKey = (name: string): string => name.trim().toLocaleLowerCase();

export const MergeAgencyDialog: React.FC<MergeAgencyDialogProps> = ({ source, agencies, busy, onClose, onMerge }) => {
  const selectId = useId();
  const [targetId, setTargetId] = useState('');

  // A fresh choice every time it opens, so a department picked for one merge
  // is never carried into the next.
  useEffect(() => {
    setTargetId('');
  }, [source?.id]);

  if (!source) return null;

  const others = agencies.filter((a) => a.id !== source.id);
  const target = others.find((a) => a.id === targetId) ?? null;
  const shared = target
    ? source.apparatus.filter((u) => target.apparatus.some((t) => nameKey(t.name) === nameKey(u.name)))
    : [];
  const moving = source.apparatus.length - shared.length;
  const evaluationDiffers = target !== null && target.evaluate_shifts !== source.evaluate_shifts;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Merge ${source.name}`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Keep both
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || target === null}
            onClick={() => target && onMerge(source, target)}
          >
            Merge departments
          </button>
        </div>
      }
    >
      {others.length === 0 ? (
        <p className="text-theme-text-secondary text-sm">There is no other department on the list to merge into.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor={selectId} className="form-label">
              Merge into
            </label>
            <select
              id={selectId}
              className="form-input"
              value={targetId}
              disabled={busy}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">Choose the department to keep…</option>
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {target && (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p className="text-theme-text-primary font-medium">What happens</p>
              <ul className="text-theme-text-secondary list-disc space-y-1 pl-5">
                <li>
                  {source.apparatus.length === 0
                    ? `${source.name} has no apparatus to move.`
                    : [
                        moving > 0 ? `${moving} apparatus ${moving === 1 ? 'moves' : 'move'} to ${target.name}.` : '',
                        shared.length > 0
                          ? `${shared.map((u) => u.name).join(', ')} ${shared.length === 1 ? 'is' : 'are'} already listed there, so ${shared.length === 1 ? 'it is' : 'they are'} combined into one.`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                </li>
                <li>
                  Every shift logged with {source.name} will show {target.name} instead, on members&apos; hours and in
                  reports.
                </li>
                {evaluationDiffers && (
                  <li>
                    {target.name} {target.evaluate_shifts ? 'evaluates' : 'does not evaluate'} shifts, so the moved
                    apparatus follow that setting.
                  </li>
                )}
                <li>{source.name} is removed from the list.</li>
              </ul>
              <p className="alert-warning">
                The old name is not kept on the shifts, so this cannot be undone from here. The audit log records both
                names.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default MergeAgencyDialog;
