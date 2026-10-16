/**
 * Who signs the department's adopted minutes.
 *
 * Each slot is a title ("Recording Secretary", "Town Clerk") and who may sign
 * it: anyone who manages minutes, or the holders of one position. What is shown
 * is what the server will apply; writing goes through the organization
 * settings and needs `settings.manage`, so anyone who manages minutes can read
 * it and only a settings administrator changes it.
 */

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { organizationService, roleService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import { newSlotKey } from '../utils/signatureSlotKey';
import type { SignatureSlot } from '../types/minutes';

const MAX_SLOTS = 6;

interface Row extends SignatureSlot {
  rowId: number;
}

interface PositionOption {
  slug: string;
  name: string;
}

let nextRowId = 1;

interface SignerSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SignerSettingsDialog: React.FC<SignerSettingsDialogProps> = ({ isOpen, onClose }) => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canEdit = checkPermission('settings.manage') || checkPermission('organization.update_settings');

  const [rows, setRows] = useState<Row[] | null>(null);
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = (slots: SignatureSlot[]) =>
    setRows(slots.map((s) => ({ ...s, position_slug: s.position_slug ?? null, rowId: nextRowId++ })));

  useEffect(() => {
    if (!isOpen) return;
    setRows(null);
    setLoadError(null);
    minutesService
      .getReminderSettings()
      .then((settings) => adopt(settings.signature_slots))
      .catch((err: unknown) => setLoadError(getErrorMessage(err, 'Failed to load the signers')));
    // Choosing a position needs the list of them; without it the dialog still
    // works for the slots that already name one.
    roleService
      .getRoles()
      .then((roles) => setPositions(roles.map((r) => ({ slug: r.slug, name: r.name }))))
      .catch(() => setPositions([]));
  }, [isOpen]);

  const setRow = (rowId: number, patch: Partial<SignatureSlot>) =>
    setRows((current) => (current ?? []).map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const move = (index: number, delta: -1 | 1) =>
    setRows((current) => {
      const list = [...(current ?? [])];
      const target = index + delta;
      const a = list[index];
      const b = list[target];
      if (!a || !b) return current;
      list[index] = b;
      list[target] = a;
      return list;
    });

  const addRow = () =>
    setRows((current) => [...(current ?? []), { rowId: nextRowId++, key: '', title: '', position_slug: null }]);

  const valid = rows !== null && rows.length > 0 && rows.every((r) => r.title.trim() !== '');

  const save = async () => {
    if (!rows || !valid) return;
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
      adopt((await minutesService.getReminderSettings()).signature_slots);
      toast.success('Signers saved');
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the signers'));
    } finally {
      setSaving(false);
    }
  };

  const known = new Set(positions.map((p) => p.slug));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Who signs adopted minutes"
      size="lg"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button type="submit" disabled={saving || !valid} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </>
      }
    >
      {loadError && (
        <p className="alert-danger text-sm" role="alert">
          {loadError}
        </p>
      )}
      {!rows && !loadError && <p className="text-theme-text-muted text-sm">Loading…</p>}
      {rows && (
        <div className="space-y-3">
          <p className="text-theme-text-secondary text-sm">
            Once minutes are adopted, each signature below is asked for. A member signs by typing their name and
            confirming their password. A signature given on a version is kept with it; minutes reopened for a correction
            start unsigned again.
            {!canEdit && ' These are changed by a settings administrator.'}
          </p>
          <ol className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.rowId} className="border-theme-surface-border rounded-md border p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label htmlFor={`slot-title-${row.rowId}`} className="form-label">
                      Signature {index + 1}
                    </label>
                    <input
                      id={`slot-title-${row.rowId}`}
                      type="text"
                      maxLength={100}
                      value={row.title}
                      disabled={!canEdit || saving}
                      onChange={(e) => setRow(row.rowId, { title: e.target.value })}
                      placeholder="Recording Secretary"
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label htmlFor={`slot-who-${row.rowId}`} className="form-label">
                      May be signed by
                    </label>
                    <select
                      id={`slot-who-${row.rowId}`}
                      value={row.position_slug ?? ''}
                      disabled={!canEdit || saving}
                      onChange={(e) => setRow(row.rowId, { position_slug: e.target.value || null })}
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
                  </div>
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
                        className="btn-icon text-red-600 hover:text-red-700"
                        onClick={() => setRows((current) => (current ?? []).filter((r) => r.rowId !== row.rowId))}
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
          {canEdit && rows.length < MAX_SLOTS && (
            <button type="button" onClick={addRow} className="btn-secondary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a signature
            </button>
          )}
        </div>
      )}
    </Modal>
  );
};

export default SignerSettingsDialog;
