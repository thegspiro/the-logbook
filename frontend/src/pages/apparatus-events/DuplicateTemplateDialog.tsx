/**
 * Copy a template, resized: a new name, optionally a different apparatus,
 * and a count per seat — 0 leaves the seat off. The original is unchanged.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/Modal';
import { apparatusEventService } from '../../services/api';
import type { ApparatusEventTemplate, EditorOptions } from '../../types/apparatusEvent';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  duplicateDraft,
  toPayload,
  totalSeats,
  validateDraft,
  withoutEmptySeats,
  type TemplateDraft,
} from './templateForm';

interface DuplicateTemplateDialogProps {
  template: ApparatusEventTemplate | null;
  options: EditorOptions;
  onClose: () => void;
  onCreated: (template: ApparatusEventTemplate) => void;
}

export const DuplicateTemplateDialog: React.FC<DuplicateTemplateDialogProps> = ({
  template,
  options,
  onClose,
  onCreated,
}) => {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh copy each time the dialog opens, so a name typed for one
  // template is never carried over to the next.
  useEffect(() => {
    setDraft(template ? duplicateDraft(template, `${template.name} (copy)`) : null);
  }, [template]);

  const trimmed = useMemo(() => (draft ? withoutEmptySeats(draft) : null), [draft]);
  const errors = useMemo(() => (trimmed ? validateDraft(trimmed) : []), [trimmed]);
  const seatCount = trimmed ? totalSeats(trimmed) : 0;

  if (!template || !draft || !trimmed) return null;

  const originalCounts = new Map(template.units.flatMap((u) => u.seats.map((s, i) => [`${u.id}:${i}`, s.count])));

  const submit = async () => {
    if (errors.length > 0) return;
    setSaving(true);
    try {
      const created = await apparatusEventService.createTemplate(toPayload(trimmed));
      toast.success(`Created “${created.name}”`);
      onCreated(created);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not create the copy.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Duplicate “${template.name}”`}
      size="lg"
      isDirty
      footer={
        <>
          <button
            type="button"
            className="btn-primary"
            disabled={saving || errors.length > 0}
            onClick={() => void submit()}
          >
            {saving ? 'Creating…' : `Create copy (${seatCount} seat${seatCount === 1 ? '' : 's'})`}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="form-label" htmlFor="dup-name">
            New template name <span className="text-red-700 dark:text-red-400">*</span>
          </label>
          <input
            id="dup-name"
            className="form-input"
            value={draft.name}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        {draft.units.map((unit, unitIndex) => {
          const source = template.units[unitIndex];
          return (
            <fieldset key={unit.key} className="border-theme-surface-border space-y-3 rounded-lg border p-3">
              <legend className="text-theme-text-primary px-1 text-sm font-semibold">
                {source?.unit_number ?? 'Apparatus'}
              </legend>
              <div>
                <label className="form-label" htmlFor={`dup-unit-${unit.key}`}>
                  Apparatus for the copy
                </label>
                <select
                  id={`dup-unit-${unit.key}`}
                  className="form-input"
                  value={unit.apparatus_id}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      units: draft.units.map((u) => (u.key === unit.key ? { ...u, apparatus_id: e.target.value } : u)),
                    })
                  }
                >
                  {options.apparatus.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.unit_number}
                      {a.required_evoc_level_name ? ` (requires ${a.required_evoc_level_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-theme-text-muted text-left text-xs tracking-wide uppercase">
                    <th className="py-1 font-semibold">Seat</th>
                    <th className="py-1 font-semibold">Original</th>
                    <th className="w-28 py-1 font-semibold">This copy</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.seats.map((seat, seatIndex) => (
                    <tr key={seat.key} className="border-theme-surface-border border-t">
                      <td className="text-theme-text-primary py-2">{seat.name}</td>
                      <td className="text-theme-text-muted py-2">
                        {source ? originalCounts.get(`${source.id}:${seatIndex}`) : ''}
                      </td>
                      <td className="py-2">
                        <label className="sr-only" htmlFor={`dup-count-${seat.key}`}>
                          {seat.name} seats on the copy
                        </label>
                        <input
                          id={`dup-count-${seat.key}`}
                          type="number"
                          min={0}
                          max={20}
                          className="form-input"
                          value={seat.count}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              units: draft.units.map((u) =>
                                u.key === unit.key
                                  ? {
                                      ...u,
                                      seats: u.seats.map((s) =>
                                        s.key === seat.key ? { ...s, count: e.target.value } : s
                                      ),
                                    }
                                  : u
                              ),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
          );
        })}
        <p className="text-theme-text-muted text-xs">
          A seat set to 0 is left off the copy. The original template does not change; edit the copy afterwards to
          rename seats or change its rules.
        </p>
        {errors.length > 0 && (
          <div className="alert-warning text-sm" role="status">
            {errors[0]}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default DuplicateTemplateDialog;
