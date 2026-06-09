/**
 * SizePreferencesModal
 *
 * Edits a member's uniform/PPE size preferences. Used in two modes:
 *  - self-service (no userId): the signed-in member edits their own sizes
 *  - admin (userId set): a quartermaster edits a specific member's sizes
 *
 * Quartermasters use these when issuing gear, so capturing them is the whole
 * point of the size-preferences feature.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { MemberSizePreferencesCreate } from '../types';
import { STANDARD_SIZES, SHOE_SIZES, GARMENT_STYLES } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

interface SizePreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, edits this member's sizes (admin mode); otherwise edits the signed-in user's. */
  userId?: string | undefined;
  memberName?: string | undefined;
}

type FormState = {
  shirt_size: string;
  shirt_style: string;
  pant_waist: string;
  pant_inseam: string;
  jacket_size: string;
  boot_size: string;
  boot_width: string;
  glove_size: string;
  hat_size: string;
};

const EMPTY: FormState = {
  shirt_size: '', shirt_style: '', pant_waist: '', pant_inseam: '',
  jacket_size: '', boot_size: '', boot_width: '', glove_size: '', hat_size: '',
};

const labelClass = 'block text-xs font-medium text-theme-text-primary mb-1';
const inputClass = 'form-input w-full';

export const SizePreferencesModal: React.FC<SizePreferencesModalProps> = ({
  isOpen, onClose, userId, memberName,
}) => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prefs = userId
        ? await inventoryService.getMemberSizePreferences(userId)
        : await inventoryService.getMySizePreferences();
      setForm({
        shirt_size: prefs.shirt_size ?? '',
        shirt_style: prefs.shirt_style ?? '',
        pant_waist: prefs.pant_waist ?? '',
        pant_inseam: prefs.pant_inseam ?? '',
        jacket_size: prefs.jacket_size ?? '',
        boot_size: prefs.boot_size ?? '',
        boot_width: prefs.boot_width ?? '',
        glove_size: prefs.glove_size ?? '',
        hat_size: prefs.hat_size ?? '',
      });
    } catch {
      // No preferences yet (404) is expected — start from a blank form.
      setForm(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleSave = async () => {
    setSaving(true);
    // Coerce empty strings to undefined so unset fields are omitted, not stored as "".
    const payload: MemberSizePreferencesCreate = {
      shirt_size: form.shirt_size || undefined,
      shirt_style: form.shirt_style || undefined,
      pant_waist: form.pant_waist.trim() || undefined,
      pant_inseam: form.pant_inseam.trim() || undefined,
      jacket_size: form.jacket_size || undefined,
      boot_size: form.boot_size || undefined,
      boot_width: form.boot_width.trim() || undefined,
      glove_size: form.glove_size || undefined,
      hat_size: form.hat_size.trim() || undefined,
    };
    try {
      if (userId) {
        await inventoryService.upsertMemberSizePreferences(userId, payload);
      } else {
        await inventoryService.upsertMySizePreferences(payload);
      }
      toast.success('Sizes saved');
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save sizes'));
    } finally {
      setSaving(false);
    }
  };

  const sizeOptions = (
    <>
      <option value="">--</option>
      {STANDARD_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={memberName ? `Sizes — ${memberName}` : 'My Sizes'}
      size="md"
    >
      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Shirt Size</label>
              <select value={form.shirt_size} onChange={(e) => set('shirt_size', e.target.value)} className={inputClass}>{sizeOptions}</select>
            </div>
            <div>
              <label className={labelClass}>Shirt Style</label>
              <select value={form.shirt_style} onChange={(e) => set('shirt_style', e.target.value)} className={inputClass}>
                <option value="">--</option>
                {GARMENT_STYLES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Pant Waist</label>
              <input type="text" value={form.pant_waist} onChange={(e) => set('pant_waist', e.target.value)} className={inputClass} placeholder='e.g. 34' />
            </div>
            <div>
              <label className={labelClass}>Pant Inseam</label>
              <input type="text" value={form.pant_inseam} onChange={(e) => set('pant_inseam', e.target.value)} className={inputClass} placeholder='e.g. 32' />
            </div>
            <div>
              <label className={labelClass}>Jacket Size</label>
              <select value={form.jacket_size} onChange={(e) => set('jacket_size', e.target.value)} className={inputClass}>{sizeOptions}</select>
            </div>
            <div>
              <label className={labelClass}>Glove Size</label>
              <select value={form.glove_size} onChange={(e) => set('glove_size', e.target.value)} className={inputClass}>{sizeOptions}</select>
            </div>
            <div>
              <label className={labelClass}>Boot Size</label>
              <select value={form.boot_size} onChange={(e) => set('boot_size', e.target.value)} className={inputClass}>
                <option value="">--</option>
                {SHOE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Boot Width</label>
              <input type="text" value={form.boot_width} onChange={(e) => set('boot_width', e.target.value)} className={inputClass} placeholder='e.g. D, EE' />
            </div>
            <div>
              <label className={labelClass}>Hat Size</label>
              <input type="text" value={form.hat_size} onChange={(e) => set('hat_size', e.target.value)} className={inputClass} placeholder='e.g. 7 1/4' />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button
              onClick={() => { void handleSave(); }}
              disabled={saving}
              className="btn-info btn-md inline-flex items-center justify-center gap-1"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Sizes
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
