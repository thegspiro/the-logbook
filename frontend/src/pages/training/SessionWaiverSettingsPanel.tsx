/**
 * Session waiver requests — the department's policy.
 *
 * Whether members may ask to be excused from a training session that counts
 * toward an attendance requirement, by when, how many a member may have, what
 * a request asks for and who decides. Saved through
 * `PUT /training/waivers/requests/policy` (training.manage), which validates
 * every field again; the checks here only flag a mistake on its field before
 * the round trip.
 *
 * Every field the policy owns is sent on every save: the endpoint replaces the
 * stored policy whole, so an omitted field would be reset to its default.
 *
 * There is no attachment setting: the backend's policy model forbids unknown
 * keys and has none yet, because nothing would read it (CLAUDE.md pitfall
 * #19). The panel says so rather than offer a switch that does nothing.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarX, Plus, Save, Trash2 } from 'lucide-react';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { complianceConfigService } from '../../services/trainingServices';
import { ErrorSummary, FIELD_ERROR_CLASS, FormField } from '../../components/ux';
import { SkeletonCard } from '../../components/ux/Skeleton';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../hooks/useFieldErrors';
import {
  ATTENDANCE_WAIVER_DEADLINE_LABELS,
  AttendanceWaiverCapPeriod,
  AttendanceWaiverDeadline,
  AttendanceWaiverReasonText,
} from '../../constants/enums';
import type { AttendanceWaiverPolicy } from '../../types/attendanceWaiver';
import type { AvailablePosition } from '../../types/training';
import { getErrorMessage } from '../../utils/errorHandling';

/** Mirrors the limits in backend/app/schemas/attendance_waiver.py. */
const CAP_MIN = 1;
const CAP_MAX = 365;
const MAX_CATEGORIES = 20;
const MAX_CATEGORY_LENGTH = 100;

type Field = 'cap' | 'categories' | 'category_required' | 'approver_position_ids';

const FIELDS: FieldSpecs<Field> = {
  cap: { id: 'waiver-policy-cap', label: 'Most waivers per member' },
  categories: { id: 'waiver-policy-category-0', label: 'Reason categories' },
  category_required: { id: 'waiver-policy-category-required', label: 'Category required' },
  approver_position_ids: { id: 'waiver-policy-positions', label: 'Who decides' },
};

const DEADLINE_OPTIONS = Object.values(AttendanceWaiverDeadline);

const REASON_TEXT_OPTIONS = [
  { value: AttendanceWaiverReasonText.OFF, label: 'Not asked' },
  { value: AttendanceWaiverReasonText.OPTIONAL, label: 'Optional' },
  { value: AttendanceWaiverReasonText.REQUIRED, label: 'Required' },
] as const;

interface Draft {
  enabled: boolean;
  deadline: AttendanceWaiverDeadline;
  capOn: boolean;
  /** The input's text, so a half-typed number is not coerced away. */
  cap: string;
  capPeriod: AttendanceWaiverCapPeriod;
  categories: string[];
  categoryRequired: boolean;
  reasonText: AttendanceWaiverReasonText;
  positionIds: string[];
}

const toDraft = (policy: AttendanceWaiverPolicy): Draft => ({
  enabled: policy.enabled,
  deadline: policy.deadline,
  capOn: policy.cap !== null,
  cap: policy.cap !== null ? String(policy.cap) : '',
  capPeriod: policy.cap_period,
  categories: [...policy.categories],
  categoryRequired: policy.category_required,
  reasonText: policy.reason_text,
  positionIds: [...policy.approver_position_ids],
});

/** Field errors for a draft, worded for the officer; empty when it would save. */
const validatePolicyDraft = (draft: Draft): FieldErrors<Field> => {
  const errors: FieldErrors<Field> = {};
  if (draft.capOn) {
    const value = Number(draft.cap);
    if (!draft.cap.trim() || !Number.isInteger(value) || value < CAP_MIN || value > CAP_MAX) {
      errors.cap = `Enter a whole number from ${CAP_MIN} to ${CAP_MAX}.`;
    }
  }
  const labels = draft.categories.map((c) => c.trim());
  const seen = new Set<string>();
  for (const label of labels) {
    if (!label) {
      errors.categories = 'A category cannot be blank. Remove it or give it a name.';
      break;
    }
    if (label.length > MAX_CATEGORY_LENGTH) {
      errors.categories = `A category can be at most ${MAX_CATEGORY_LENGTH} characters.`;
      break;
    }
    // Case-insensitive, as the backend compares them.
    const key = label.toLowerCase();
    if (seen.has(key)) {
      errors.categories = `"${label}" is listed twice.`;
      break;
    }
    seen.add(key);
  }
  if (draft.categoryRequired && labels.length === 0) {
    errors.category_required = 'Add a category before requiring one.';
  }
  return errors;
};

/**
 * `knownPositionIds` is the department's position list when it loaded: a
 * chosen position missing from it no longer exists, and the backend refuses a
 * save naming it, so it is dropped. With no list, the choice is sent as is.
 */
const toPolicy = (draft: Draft, knownPositionIds: ReadonlySet<string> | null): AttendanceWaiverPolicy => ({
  enabled: draft.enabled,
  deadline: draft.deadline,
  cap: draft.capOn ? Number(draft.cap) : null,
  cap_period: draft.capPeriod,
  categories: draft.categories.map((c) => c.trim()),
  category_required: draft.categoryRequired && draft.categories.length > 0,
  reason_text: draft.reasonText,
  approver_position_ids: knownPositionIds
    ? draft.positionIds.filter((p) => knownPositionIds.has(p))
    : draft.positionIds,
});

export const SessionWaiverSettingsPanel: React.FC = () => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  /** null when the positions could not be loaded. */
  const [positions, setPositions] = useState<AvailablePosition[] | null>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const { errors, formError, setErrors, setFromApiError, summary, clear } = useFieldErrors(FIELDS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const policy = await attendanceWaiverService.getPolicy();
        if (cancelled) return;
        setDraft(toDraft(policy));
        setSaved(toDraft(policy));
      } catch (err: unknown) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'The waiver request settings could not be loaded.'));
      }
      try {
        const result = await complianceConfigService.getAvailablePositions();
        if (!cancelled) setPositions(result.positions);
      } catch {
        if (!cancelled) setPositions(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  if (loadError) {
    return (
      <div className="py-6">
        <div className="alert-danger rounded-lg p-4 text-sm" role="alert">
          {loadError}
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="py-6" role="status" aria-live="polite">
        <span className="sr-only">Loading waiver request settings…</span>
        <SkeletonCard />
      </div>
    );
  }

  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  const setCategory = (index: number, value: string) =>
    update({ categories: draft.categories.map((c, i) => (i === index ? value : c)) });

  const removeCategory = (index: number) => {
    const categories = draft.categories.filter((_, i) => i !== index);
    update({ categories, categoryRequired: categories.length > 0 && draft.categoryRequired });
  };

  const togglePosition = (positionId: string) =>
    update({
      positionIds: draft.positionIds.includes(positionId)
        ? draft.positionIds.filter((p) => p !== positionId)
        : [...draft.positionIds, positionId],
    });

  // A chosen position the loaded list does not contain was deleted; saving
  // drops it (see toPolicy), and the officer is told so before they save.
  const unknownPositionCount = positions
    ? draft.positionIds.filter((p) => !positions.some((option) => option.id === p)).length
    : 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validatePolicyDraft(draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setSummaryFocus((n) => n + 1);
      return;
    }
    clear();
    setSaving(true);
    try {
      const stored = await attendanceWaiverService.savePolicy(
        toPolicy(draft, positions ? new Set(positions.map((p) => p.id)) : null)
      );
      setDraft(toDraft(stored));
      setSaved(toDraft(stored));
      toast.success('Waiver request settings saved');
    } catch (err: unknown) {
      setFromApiError(err, 'The settings could not be saved. Try again.');
      setSummaryFocus((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-6 py-6" onSubmit={(e) => void handleSave(e)} noValidate>
      <div>
        <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <CalendarX className="h-5 w-5" aria-hidden="true" />
          Session waiver requests
        </h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Let members ask to be excused from a training session that counts toward their attendance requirement. An
          approved request removes the session from both what they attended and what was held. A member who checks in is
          counted as attending, and cannot ask.
        </p>
      </div>

      <ErrorSummary items={summary} formError={formError} focusKey={summaryFocus} title="Fix these before saving" />

      <div className="card space-y-6 p-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={draft.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            disabled={saving}
          />
          <span>
            <span className="text-theme-text-primary block text-sm font-medium">Members may ask to be excused</span>
            <span className="text-theme-text-muted block text-xs">
              Off, members see no button and nothing else changes.
            </span>
          </span>
        </label>

        <fieldset disabled={saving}>
          <legend className="form-label">Deadline to ask</legend>
          <div className="space-y-2">
            {DEADLINE_OPTIONS.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="waiver-policy-deadline"
                  value={value}
                  checked={draft.deadline === value}
                  onChange={() => update({ deadline: value })}
                />
                <span className="text-theme-text-primary text-sm">{ATTENDANCE_WAIVER_DEADLINE_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={saving} className="space-y-3">
          <legend className="form-label">Limit</legend>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={draft.capOn}
              onChange={(e) => update({ capOn: e.target.checked, cap: draft.cap || '3' })}
            />
            <span className="text-theme-text-primary text-sm">Limit how many waivers a member can have</span>
          </label>
          {draft.capOn && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id={FIELDS.cap.id}
                label={FIELDS.cap.label}
                required
                error={errors.cap}
                hint="Only approved requests count, including a denial the Chief overrode."
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    min={CAP_MIN}
                    max={CAP_MAX}
                    className="form-input"
                    value={draft.cap}
                    onChange={(e) => update({ cap: e.target.value })}
                  />
                )}
              </FormField>
              <FormField id="waiver-policy-cap-period" label="Counted over">
                {(field) => (
                  <select
                    {...field}
                    className="form-input"
                    value={draft.capPeriod}
                    onChange={(e) => update({ capPeriod: e.target.value as AttendanceWaiverCapPeriod })}
                  >
                    <option value={AttendanceWaiverCapPeriod.CALENDAR_YEAR}>Each calendar year</option>
                    <option value={AttendanceWaiverCapPeriod.ROLLING_12_MONTHS}>Any 12 months in a row</option>
                  </select>
                )}
              </FormField>
            </div>
          )}
        </fieldset>
      </div>

      <div className="card space-y-6 p-6">
        <div>
          <h3 className="text-theme-text-primary text-base font-semibold">What a request asks for</h3>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Only the member and the officers who decide see a request&apos;s category and explanation. They are never
            shown in the annual review.
          </p>
        </div>

        <fieldset disabled={saving} className="space-y-3">
          <legend className="form-label">Reason categories</legend>
          <p className="text-theme-text-muted text-xs">
            Choices such as Work, Illness or Family. Leave the list empty to ask for none.
          </p>
          {draft.categories.map((category, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                id={`waiver-policy-category-${index}`}
                aria-label={`Category ${index + 1}`}
                className="form-input flex-1"
                value={category}
                maxLength={MAX_CATEGORY_LENGTH}
                onChange={(e) => setCategory(index, e.target.value)}
                {...(errors.categories ? { 'aria-invalid': true as const } : {})}
              />
              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove category ${category.trim() || index + 1}`}
                onClick={() => removeCategory(index)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          {errors.categories && <p className={`text-sm ${FIELD_ERROR_CLASS}`}>{errors.categories}</p>}
          {draft.categories.length < MAX_CATEGORIES && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm font-medium"
              onClick={() => update({ categories: [...draft.categories, ''] })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a category
            </button>
          )}
          <label className="flex items-center gap-3">
            <input
              id={FIELDS.category_required.id}
              type="checkbox"
              className="form-checkbox"
              checked={draft.categoryRequired}
              disabled={draft.categories.length === 0}
              onChange={(e) => update({ categoryRequired: e.target.checked })}
            />
            <span className="text-theme-text-primary text-sm">A member must choose a category</span>
          </label>
          {errors.category_required && <p className={`text-sm ${FIELD_ERROR_CLASS}`}>{errors.category_required}</p>}
        </fieldset>

        <fieldset disabled={saving}>
          <legend className="form-label">Written explanation</legend>
          <div className="flex flex-wrap gap-3">
            {REASON_TEXT_OPTIONS.map((option) => (
              <label key={option.value} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="waiver-policy-reason-text"
                  value={option.value}
                  checked={draft.reasonText === option.value}
                  onChange={() => update({ reasonText: option.value })}
                />
                <span className="text-theme-text-primary text-sm">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <p className="form-label">Attachments</p>
          <p className="text-theme-text-muted text-sm">
            Letting members attach a document, such as a doctor&apos;s note, arrives in a later update.
          </p>
        </div>
      </div>

      <div className="card space-y-3 p-6">
        <div>
          <h3 id={FIELDS.approver_position_ids.id} className="text-theme-text-primary text-base font-semibold">
            Who decides
          </h3>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Everyone holding a chosen position is asked, and the first decision stands. With none chosen, or nobody
            holding them, requests go to the Chief, and failing a Chief to the training managers. The Chief can always
            approve a request that was denied.
          </p>
        </div>
        {positions === null ? (
          <p className={`text-sm ${FIELD_ERROR_CLASS}`} role="alert">
            Positions could not be loaded, so who decides cannot be changed right now. The current choice is kept when
            you save.
          </p>
        ) : positions.length === 0 ? (
          <p className="text-theme-text-muted text-sm">This department has no positions yet.</p>
        ) : (
          <fieldset disabled={saving} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <legend className="sr-only">Positions that decide waiver requests</legend>
            {positions.map((position) => (
              <label key={position.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={draft.positionIds.includes(position.id)}
                  onChange={() => togglePosition(position.id)}
                />
                <span className="text-theme-text-primary text-sm">{position.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {unknownPositionCount > 0 && (
          <p className="text-theme-text-muted text-xs">
            {unknownPositionCount === 1
              ? 'One chosen position no longer exists and is removed when you save.'
              : `${unknownPositionCount} chosen positions no longer exist and are removed when you save.`}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || (!dirty && unknownPositionCount === 0)}
          className="btn-primary inline-flex items-center gap-2 text-sm font-medium disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Saving...' : 'Save'}
        </button>
        {!dirty && unknownPositionCount === 0 && (
          <span className="text-theme-text-muted text-sm">No unsaved changes</span>
        )}
      </div>
    </form>
  );
};

export default SessionWaiverSettingsPanel;
