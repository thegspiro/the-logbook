/**
 * SizePreferencesModal
 *
 * Edits a member's uniform/PPE size preferences. Used in two modes:
 *  - self-service (no userId): the signed-in member edits their own sizes
 *  - admin (userId set): a quartermaster edits a specific member's sizes
 *
 * Quartermasters use these when issuing gear, so capturing them is the whole
 * point of the size-preferences feature.
 *
 * The nine stored fields are not equally useful for the member filling this
 * in. Shirt, pants, jacket and boots are what a member actually knows off the
 * top of their head and what a uniform order needs; shirt style, boot width,
 * glove and hat sizes are fitting details a quartermaster usually settles at
 * issue. Presenting all nine as one flat wall made the common case — "record
 * my uniform sizes" — read as a nine-field questionnaire, which is what stops
 * members completing it. The detail fields are still here, still stored, and
 * still feed the impact planner (which reports on all six garment types) —
 * they just sit behind a disclosure, opened automatically when the member
 * already has values there so nothing saved earlier is hidden.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { MemberSizePreferencesCreate } from '../types';
import { STANDARD_SIZES, SHOE_SIZES, GARMENT_FIT_OPTIONS } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { Modal } from '../../../components/Modal';
import { Collapsible } from '../../../components/ux';
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
  garment_fit: string;
  pant_waist: string;
  pant_inseam: string;
  jacket_size: string;
  boot_size: string;
  boot_width: string;
  glove_size: string;
  hat_size: string;
};

const EMPTY: FormState = {
  shirt_size: '',
  garment_fit: '',
  pant_waist: '',
  pant_inseam: '',
  jacket_size: '',
  boot_size: '',
  boot_width: '',
  glove_size: '',
  hat_size: '',
};

/** Fields kept behind the "Additional sizes" disclosure. */
const DETAIL_FIELDS = ['garment_fit', 'boot_width', 'glove_size', 'hat_size'] as const;

const hasDetailValues = (state: FormState): boolean => DETAIL_FIELDS.some((field) => state[field].trim() !== '');

const labelClass = 'form-label-sm';
const inputClass = 'form-input w-full';

export const SizePreferencesModal: React.FC<SizePreferencesModalProps> = ({ isOpen, onClose, userId, memberName }) => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Captured at load time, not derived from `form`: deriving it live would
  // re-key the disclosure mid-edit and throw away what is being typed.
  const [detailsPrefilled, setDetailsPrefilled] = useState(false);

  const set = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prefs = userId
        ? await inventoryService.getMemberSizePreferences(userId)
        : await inventoryService.getMySizePreferences();
      const loaded: FormState = {
        shirt_size: prefs.shirt_size ?? '',
        garment_fit: prefs.garment_fit ?? '',
        pant_waist: prefs.pant_waist ?? '',
        pant_inseam: prefs.pant_inseam ?? '',
        jacket_size: prefs.jacket_size ?? '',
        boot_size: prefs.boot_size ?? '',
        boot_width: prefs.boot_width ?? '',
        glove_size: prefs.glove_size ?? '',
        hat_size: prefs.hat_size ?? '',
      };
      setForm(loaded);
      setDetailsPrefilled(hasDetailValues(loaded));
    } catch {
      // No preferences yet (404) is expected — start from a blank form.
      setForm(EMPTY);
      setDetailsPrefilled(false);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleSave = async () => {
    setSaving(true);
    // This is always an update (PUT .../size-preferences upserts an existing
    // row), never a create -- so a blank field must send an explicit `null`,
    // not be coerced to `undefined`. `undefined` drops the key from the JSON
    // body, and the backend's `exclude_unset=True` dump then leaves an
    // already-stored value untouched: a member who clears "Fit" back to "No
    // preference" would see a success toast while the old fit silently
    // survived (CLAUDE.md pitfall #1's update-path shape).
    const payload: MemberSizePreferencesCreate = {
      shirt_size: blankToNull(form.shirt_size),
      garment_fit: blankToNull(form.garment_fit),
      pant_waist: blankToNull(form.pant_waist),
      pant_inseam: blankToNull(form.pant_inseam),
      jacket_size: blankToNull(form.jacket_size),
      boot_size: blankToNull(form.boot_size),
      boot_width: blankToNull(form.boot_width),
      glove_size: blankToNull(form.glove_size),
      hat_size: blankToNull(form.hat_size),
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
      {STANDARD_SIZES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={memberName ? `Sizes — ${memberName}` : 'My Sizes'} size="md">
      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-theme-text-secondary text-sm">
            Fill in what you know — every field is optional, and you can update them any time.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Shirt Size</label>
              <select
                value={form.shirt_size}
                onChange={(e) => set('shirt_size', e.target.value)}
                className={inputClass}
              >
                {sizeOptions}
              </select>
            </div>
            <div>
              <label className={labelClass}>Jacket Size</label>
              <select
                value={form.jacket_size}
                onChange={(e) => set('jacket_size', e.target.value)}
                className={inputClass}
              >
                {sizeOptions}
              </select>
            </div>
            <div>
              <label className={labelClass}>Pant Waist</label>
              <input
                type="text"
                value={form.pant_waist}
                onChange={(e) => set('pant_waist', e.target.value)}
                className={inputClass}
                placeholder="e.g. 34"
              />
            </div>
            <div>
              <label className={labelClass}>Pant Inseam</label>
              <input
                type="text"
                value={form.pant_inseam}
                onChange={(e) => set('pant_inseam', e.target.value)}
                className={inputClass}
                placeholder="e.g. 32"
              />
            </div>
            <div>
              <label className={labelClass}>Boot Size</label>
              <select value={form.boot_size} onChange={(e) => set('boot_size', e.target.value)} className={inputClass}>
                <option value="">--</option>
                {SHOE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Re-keyed on the loaded record so a member who already has detail
              sizes sees them expanded — `defaultOpen` alone is read once, and
              the record arrives after this component first renders. */}
          <Collapsible
            key={detailsPrefilled ? 'details-prefilled' : 'details-empty'}
            title="Additional sizes (optional)"
            defaultOpen={detailsPrefilled}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                {/* Fit, not "style". The old select offered all ten style
                    values, which span four axes, so a member could say
                    "Women's" or "Long Sleeve" but not both — and nothing read
                    the answer either way. Fit is the one axis that describes
                    the member rather than what the department stocks, and the
                    request catalog now preselects the variant matching it. */}
                <label className={labelClass} htmlFor="size-prefs-garment-fit">
                  Fit
                </label>
                <select
                  id="size-prefs-garment-fit"
                  value={form.garment_fit}
                  onChange={(e) => set('garment_fit', e.target.value)}
                  className={inputClass}
                >
                  <option value="">No preference</option>
                  {GARMENT_FIT_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Used to pick the right cut when a garment is stocked in more than one.
                </p>
              </div>
              <div>
                <label className={labelClass}>Boot Width</label>
                <input
                  type="text"
                  value={form.boot_width}
                  onChange={(e) => set('boot_width', e.target.value)}
                  className={inputClass}
                  placeholder="e.g. D, EE"
                />
              </div>
              <div>
                <label className={labelClass}>Glove Size</label>
                <select
                  value={form.glove_size}
                  onChange={(e) => set('glove_size', e.target.value)}
                  className={inputClass}
                >
                  {sizeOptions}
                </select>
              </div>
              <div>
                <label className={labelClass}>Hat Size</label>
                <input
                  type="text"
                  value={form.hat_size}
                  onChange={(e) => set('hat_size', e.target.value)}
                  className={inputClass}
                  placeholder="e.g. 7 1/4"
                />
              </div>
            </div>
          </Collapsible>

          <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
            <button onClick={onClose} className="btn-secondary btn-md">
              Cancel
            </button>
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={saving}
              className="btn-info btn-md inline-flex items-center justify-center gap-1"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Sizes
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
