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
import { toAppError } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { Modal } from '../../../components/Modal';
import { Collapsible } from '../../../components/ux';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
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

type SizeField = keyof FormState;
// Ordered as on screen, so the first refusal takes focus.
const SIZE_FIELDS: FieldSpecs<SizeField> = {
  shirt_size: { id: 'size-prefs-shirt-size', label: 'Shirt Size' },
  jacket_size: { id: 'size-prefs-jacket-size', label: 'Jacket Size' },
  pant_waist: { id: 'size-prefs-pant-waist', label: 'Pant Waist' },
  pant_inseam: { id: 'size-prefs-pant-inseam', label: 'Pant Inseam' },
  boot_size: { id: 'size-prefs-boot-size', label: 'Boot Size' },
  garment_fit: { id: 'size-prefs-garment-fit', label: 'Fit' },
  boot_width: { id: 'size-prefs-boot-width', label: 'Boot Width' },
  glove_size: { id: 'size-prefs-glove-size', label: 'Glove Size' },
  hat_size: { id: 'size-prefs-hat-size', label: 'Hat Size' },
};
const SIZE_ORDER = Object.keys(SIZE_FIELDS) as SizeField[];
// MemberSizePreferencesCreate: the typed fields' max_length.
const SIZE_LIMITS = { pant_waist: 10, pant_inseam: 10, boot_width: 10, hat_size: 10 } as const;

export const SizePreferencesModal: React.FC<SizePreferencesModalProps> = ({ isOpen, onClose, userId, memberName }) => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Captured at load time, not derived from `form`: deriving it live would
  // re-key the disclosure mid-edit and throw away what is being typed.
  const [detailsPrefilled, setDetailsPrefilled] = useState(false);
  // True only for a load failure that is NOT "no preferences exist yet" (a
  // 404). Blocks Save: every blank field now serializes as an explicit
  // `null` (see handleSave below), so saving a blank form recovered from a
  // timeout/500 would actively clear preferences the failed load never saw,
  // rather than merely failing to show them.
  const [loadError, setLoadError] = useState(false);

  // What the form held when it loaded (or last saved), so Cancel, Escape and
  // the X ask before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<FormState>(EMPTY);
  const sizeErrors = useFieldErrors(SIZE_FIELDS);
  const isDirty = isOpen && JSON.stringify(form) !== JSON.stringify(baseline);
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const set = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    sizeErrors.setError(key, null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const prefs = userId
        ? await inventoryService.getMemberSizePreferences(userId)
        : await inventoryService.getMySizePreferences();
      if (!prefs) {
        // Both endpoints answer null when no sizes are saved: "nothing stored
        // yet", so a blank, save-ready form. Falling through would read fields
        // off null and land in the load-failure branch, which blocks Save.
        setForm(EMPTY);
        setDetailsPrefilled(false);
        return;
      }
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
      setBaseline(loaded);
      setDetailsPrefilled(hasDetailValues(loaded));
    } catch (err: unknown) {
      if (toAppError(err).status === 404) {
        // No preferences yet — genuinely expected, safe to show a blank
        // form ready to create. The service already maps an older backend's
        // 404 to null; this keeps a direct 404 meaning the same thing.
        setForm(EMPTY);
        setBaseline(EMPTY);
        setDetailsPrefilled(false);
      } else {
        // A timeout, a 500, offline — NOT "no preferences exist yet". Leave
        // the form as-is and block Save (see `loadError` above) rather than
        // presenting a save-ready blank form that would clear whatever the
        // failed load never got to see.
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const { clear: clearSizeErrors } = sizeErrors;
  useEffect(() => {
    if (!isOpen) return;
    clearSizeErrors();
    void load();
  }, [isOpen, load, clearSizeErrors]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt-and-suspenders: the Save button is already disabled while
    // `loadError` is true, but this keeps a stray call site (or a future
    // one) from being able to fire the clearing payload described above.
    if (loadError) return;
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
    sizeErrors.setFormError(null);
    try {
      // A refused size is left out and the rest saves (owner rule,
      // 2026-11-05); the stored value of the refused one is kept.
      const { refused } = await saveExceptRefused<SizeField, unknown>({
        payload: { ...payload },
        refused: {},
        send: (body) => {
          // The typed payload, less any key the helper left out of `body`.
          const sent: MemberSizePreferencesCreate = { ...payload };
          for (const key of SIZE_ORDER) if (!(key in body)) delete sent[key];
          return userId
            ? inventoryService.upsertMemberSizePreferences(userId, sent)
            : inventoryService.upsertMySizePreferences(sent);
        },
        place: (err) => placeApiError(SIZE_FIELDS, err),
      });
      const first = firstRefused(SIZE_ORDER, refused);
      if (first) {
        sizeErrors.setErrors(refused);
        sizeErrors.setFormError(
          `Sizes saved, except ${SIZE_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
        );
        sizeErrors.focusFirst(refused);
        const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as SizeField]]));
        setBaseline({ ...form, ...keep });
        return;
      }
      toast.success('Sizes saved');
      onClose();
    } catch (err: unknown) {
      // Said in the dialog, which stays open with what was typed.
      sizeErrors.focusFirst(sizeErrors.setFromApiError(err, 'Failed to save sizes'));
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
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={memberName ? `Sizes — ${memberName}` : 'My Sizes'}
      size="md"
      onSubmit={(e) => void handleSave(e)}
      noValidate
    >
      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {loadError ? (
            <div className="alert-danger" role="alert">
              <p>
                Couldn&apos;t load current sizes. Saving is disabled until this succeeds — saving over an unloaded
                record would clear it.
              </p>
              <button
                type="button"
                onClick={() => {
                  void load();
                }}
                className="btn-secondary btn-sm mt-2"
              >
                Try again
              </button>
            </div>
          ) : null}
          <p className="text-theme-text-secondary text-sm">
            Fill in what you know — every field is optional, and you can update them any time.
          </p>
          {sizeErrors.formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {sizeErrors.formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              id={SIZE_FIELDS.shirt_size.id}
              label="Shirt Size"
              labelClassName={labelClass}
              error={sizeErrors.errors.shirt_size}
            >
              {(field) => (
                <select
                  {...field}
                  value={form.shirt_size}
                  onChange={(e) => set('shirt_size', e.target.value)}
                  className={inputClass}
                >
                  {sizeOptions}
                </select>
              )}
            </FormField>
            <FormField
              id={SIZE_FIELDS.jacket_size.id}
              label="Jacket Size"
              labelClassName={labelClass}
              error={sizeErrors.errors.jacket_size}
            >
              {(field) => (
                <select
                  {...field}
                  value={form.jacket_size}
                  onChange={(e) => set('jacket_size', e.target.value)}
                  className={inputClass}
                >
                  {sizeOptions}
                </select>
              )}
            </FormField>
            <FormField
              id={SIZE_FIELDS.pant_waist.id}
              label="Pant Waist"
              labelClassName={labelClass}
              error={sizeErrors.errors.pant_waist}
              maxLength={SIZE_LIMITS.pant_waist}
              count={form.pant_waist.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={form.pant_waist}
                  onChange={(e) => set('pant_waist', e.target.value)}
                  className={inputClass}
                  placeholder="e.g. 34"
                />
              )}
            </FormField>
            <FormField
              id={SIZE_FIELDS.pant_inseam.id}
              label="Pant Inseam"
              labelClassName={labelClass}
              error={sizeErrors.errors.pant_inseam}
              maxLength={SIZE_LIMITS.pant_inseam}
              count={form.pant_inseam.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  value={form.pant_inseam}
                  onChange={(e) => set('pant_inseam', e.target.value)}
                  className={inputClass}
                  placeholder="e.g. 32"
                />
              )}
            </FormField>
            <FormField
              id={SIZE_FIELDS.boot_size.id}
              label="Boot Size"
              labelClassName={labelClass}
              error={sizeErrors.errors.boot_size}
            >
              {(field) => (
                <select
                  {...field}
                  value={form.boot_size}
                  onChange={(e) => set('boot_size', e.target.value)}
                  className={inputClass}
                >
                  <option value="">--</option>
                  {SHOE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
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
              {/* Fit, not "style". The old select offered all ten style
                  values, which span four axes, so a member could say
                  "Women's" or "Long Sleeve" but not both — and nothing read
                  the answer either way. Fit is the one axis that describes
                  the member rather than what the department stocks, and the
                  request catalog now preselects the variant matching it. */}
              <FormField
                id={SIZE_FIELDS.garment_fit.id}
                label="Fit"
                labelClassName={labelClass}
                error={sizeErrors.errors.garment_fit}
                hint="Used to pick the right cut when a garment is stocked in more than one."
              >
                {(field) => (
                  <select
                    {...field}
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
                )}
              </FormField>
              <FormField
                id={SIZE_FIELDS.boot_width.id}
                label="Boot Width"
                labelClassName={labelClass}
                error={sizeErrors.errors.boot_width}
                maxLength={SIZE_LIMITS.boot_width}
                count={form.boot_width.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={form.boot_width}
                    onChange={(e) => set('boot_width', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. D, EE"
                  />
                )}
              </FormField>
              <FormField
                id={SIZE_FIELDS.glove_size.id}
                label="Glove Size"
                labelClassName={labelClass}
                error={sizeErrors.errors.glove_size}
              >
                {(field) => (
                  <select
                    {...field}
                    value={form.glove_size}
                    onChange={(e) => set('glove_size', e.target.value)}
                    className={inputClass}
                  >
                    {sizeOptions}
                  </select>
                )}
              </FormField>
              <FormField
                id={SIZE_FIELDS.hat_size.id}
                label="Hat Size"
                labelClassName={labelClass}
                error={sizeErrors.errors.hat_size}
                maxLength={SIZE_LIMITS.hat_size}
                count={form.hat_size.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={form.hat_size}
                    onChange={(e) => set('hat_size', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. 7 1/4"
                  />
                )}
              </FormField>
            </div>
          </Collapsible>

          <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
            <button type="button" onClick={requestClose} className="btn-secondary btn-md">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || loadError}
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
