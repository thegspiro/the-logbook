/**
 * Who signs the department's adopted minutes.
 *
 * Each slot is a title ("Recording Secretary", "Town Clerk") and who may sign
 * it: anyone who manages minutes, or the holders of one position. What is shown
 * is what the server will apply; writing goes through the organization
 * settings and needs `settings.manage`, so anyone who manages minutes can read
 * it and only a settings administrator changes it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { FormField } from '../../../components/ux/FormField';
import { organizationService, roleService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { newSlotKey } from '../utils/signatureSlotKey';
import type { MinutesSettingsPanelProps, SignatureSlot } from '../types/minutes';
import { SettingsSaveBar } from './SettingsSaveBar';

/** SignatureSlotSetting / MinutesSettingsUpdate in schemas/organization.py. */
const MAX_SLOTS = 6;
const MAX_TITLE = 100;

interface Row extends SignatureSlot {
  rowId: number;
}

interface PositionOption {
  slug: string;
  name: string;
}

let nextRowId = 1;

const toRows = (slots: SignatureSlot[]): Row[] =>
  slots.map((s) => ({ ...s, position_slug: s.position_slug ?? null, rowId: nextRowId++ }));

const sameSlots = (rows: Row[], slots: SignatureSlot[]) =>
  rows.length === slots.length &&
  rows.every((r, i) => {
    const slot = slots[i];
    return (
      slot !== undefined &&
      r.key === slot.key &&
      r.title === slot.title &&
      (r.position_slug ?? null) === (slot.position_slug ?? null)
    );
  });

export const SignerSettingsPanel: React.FC<MinutesSettingsPanelProps> = ({ settings, canEdit, onSaved }) => {
  const [rows, setRows] = useState<Row[]>(() => toRows(settings.signature_slots));
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [saving, setSaving] = useState(false);
  // Keyed `title-<rowId>`, `who-<rowId>`, or `slots` for the list as a whole.
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const clearError = (field: string) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  // Rows are keyed by rowId, so re-seeding on mount would replace every input
  // the first render just painted; only a later change from the server (after a
  // save) re-seeds.
  const seeded = useRef(settings.signature_slots);
  useEffect(() => {
    if (seeded.current === settings.signature_slots) return;
    seeded.current = settings.signature_slots;
    setRows(toRows(settings.signature_slots));
  }, [settings.signature_slots]);

  useEffect(() => {
    // Choosing a position needs the list of them; without it the panel still
    // works for the slots that already name one.
    roleService
      .getRoles()
      .then((roles) => setPositions(roles.map((r) => ({ slug: r.slug, name: r.name }))))
      .catch(() => setPositions([]));
  }, []);

  const setRow = (rowId: number, patch: Partial<SignatureSlot>) =>
    setRows((current) => current.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const move = (index: number, delta: -1 | 1) =>
    setRows((current) => {
      const list = [...current];
      const target = index + delta;
      const a = list[index];
      const b = list[target];
      if (!a || !b) return current;
      list[index] = b;
      list[target] = a;
      return list;
    });

  const addRow = () => {
    clearError('slots');
    setRows((current) => [...current, { rowId: nextRowId++, key: '', title: '', position_slug: null }]);
  };

  const dirty = !sameSlots(rows, settings.signature_slots);

  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    const first = rows.find((r) => next[`title-${r.rowId}`] || next[`who-${r.rowId}`]);
    const id = first ? (next[`title-${first.rowId}`] ? `slot-title-${first.rowId}` : `slot-who-${first.rowId}`) : null;
    if (id) window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  };

  /** Server field specs for these rows, as the API names them. */
  const fieldSpecs = (): Record<string, ServerFieldSpec> => {
    const specs: Record<string, ServerFieldSpec> = {
      slots: { label: 'Signatures', api: 'minutes.signature_slots' },
    };
    rows.forEach((r, index) => {
      specs[`title-${r.rowId}`] = {
        label: `Signature ${index + 1}`,
        maxLength: MAX_TITLE,
        api: `minutes.signature_slots.${index}.title`,
      };
      specs[`who-${r.rowId}`] = { label: 'May be signed by', api: `minutes.signature_slots.${index}.position_slug` };
    });
    return specs;
  };

  // The slots are one setting, so a refusal anywhere in them saves none of it:
  // the server keeps the signers it applies now and each refusal stays flagged.
  const save = async () => {
    const refused: Partial<Record<string, string>> = {};
    if (rows.length === 0) refused.slots = 'Not saved: adopted minutes need at least one signature.';
    for (const r of rows) if (!r.title.trim()) refused[`title-${r.rowId}`] = 'Give this signature a title.';
    if (Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    setErrors({});
    const taken = new Set(rows.map((r) => r.key).filter(Boolean));
    const slots: SignatureSlot[] = rows.map((r) => {
      // A key is given once and kept, so renaming a slot does not detach the
      // signatures already given in it.
      const key = r.key || newSlotKey(r.title, taken);
      taken.add(key);
      return { key, title: r.title.trim(), position_slug: r.position_slug || null };
    });
    setSaving(true);
    try {
      await organizationService.updateSettings({ minutes: { signature_slots: slots } });
      await onSaved();
      toast.success('Signers saved');
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, fieldSpecs());
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) showErrors(mapped.fieldErrors);
      if (!mapped || mapped.unmatched.length > 0 || Object.keys(mapped.fieldErrors).length === 0) {
        toast.error(getErrorMessage(err, 'Failed to save the signers'));
      }
    } finally {
      setSaving(false);
    }
  };

  const known = new Set(positions.map((p) => p.slug));

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-theme-text-secondary text-sm">
        Once minutes are adopted, each signature below is asked for. A member signs by typing their name and confirming
        their password. A signature given on a version is kept with it; minutes reopened for a correction start unsigned
        again.
        {!canEdit && ' These are changed by a settings administrator.'}
      </p>
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.rowId} className="border-theme-surface-border rounded-md border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <FormField
                label={`Signature ${index + 1}`}
                required
                id={`slot-title-${row.rowId}`}
                error={errors[`title-${row.rowId}`]}
                maxLength={MAX_TITLE}
                count={row.title.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={row.title}
                    disabled={!canEdit || saving}
                    onChange={(e) => {
                      setRow(row.rowId, { title: e.target.value });
                      clearError(`title-${row.rowId}`);
                    }}
                    placeholder="Recording Secretary"
                    className="form-input"
                  />
                )}
              </FormField>
              <FormField label="May be signed by" id={`slot-who-${row.rowId}`} error={errors[`who-${row.rowId}`]}>
                {(field) => (
                  <select
                    {...field}
                    value={row.position_slug ?? ''}
                    disabled={!canEdit || saving}
                    onChange={(e) => {
                      setRow(row.rowId, { position_slug: e.target.value || null });
                      clearError(`who-${row.rowId}`);
                    }}
                    className="form-input"
                  >
                    <option value="">Anyone who manages minutes</option>
                    {row.position_slug && !known.has(row.position_slug) && (
                      <option value={row.position_slug}>{row.position_slug}</option>
                    )}
                    {positions.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              {canEdit && (
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move signature ${index + 1} up`}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move signature ${index + 1} down`}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon text-red-800 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
                    onClick={() => setRows((current) => current.filter((r) => r.rowId !== row.rowId))}
                    aria-label={`Remove signature ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="text-theme-text-muted text-sm">Add at least one signature.</p>}
      {errors.slots && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {errors.slots}
        </p>
      )}
      {canEdit && rows.length < MAX_SLOTS && (
        <button type="button" onClick={addRow} className="btn-secondary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a signature
        </button>
      )}
      <SettingsSaveBar canEdit={canEdit} dirty={dirty} saving={saving} />
    </form>
  );
};

export default SignerSettingsPanel;
