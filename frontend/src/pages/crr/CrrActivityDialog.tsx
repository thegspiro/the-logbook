/**
 * Record a CRR activity: a log entry, or one done at an outreach event.
 *
 * The ZIP code fills in city and state from the GeoNames data bundled with the
 * app when the department is in the US (owner decision, 2026-11-22), and
 * starts from the department's own city and state. Resident details are
 * optional, encrypted at rest, seen only by the Community Outreach Manager and
 * above, and cleared after the department's retention period; the form says
 * so beside them.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { crrService } from '../../services/crrServices';
import type { CrrActivity, CrrFormOptions } from '../../types/crr';
import { CrrTagKind } from '../../types/crr';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  buildCreatePayload,
  DEFAULT_MINUTES,
  initialValues,
  withType,
  type CrrActivityFormValues,
} from './crrActivityForm';

interface CrrActivityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (activity: CrrActivity) => void;
  options: CrrFormOptions;
  timezone: string;
  currentUserId: string | null;
  /** Recording at an outreach event: no members, its attendance credits them. */
  eventId?: string | undefined;
  eventTitle?: string | undefined;
}

const CrrActivityDialog: React.FC<CrrActivityDialogProps> = ({
  isOpen,
  onClose,
  onSaved,
  options,
  timezone,
  currentUserId,
  eventId,
  eventTitle,
}) => {
  const [values, setValues] = useState<CrrActivityFormValues>(() => initialValues(options, timezone, currentUserId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh form each time it opens, so one activity's details never carry
  // into the next.
  useEffect(() => {
    if (isOpen) {
      setValues(initialValues(options, timezone, currentUserId));
      setError(null);
    }
  }, [isOpen, options, timezone, currentUserId]);

  const activityType = useMemo(
    () => options.activity_types.find((t) => t.id === values.activityTypeId),
    [options.activity_types, values.activityTypeId]
  );

  const set = <K extends keyof CrrActivityFormValues>(key: K, value: CrrActivityFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const lookUpZip = async () => {
    const zip = values.zipCode.trim();
    if (!options.zip_lookup_enabled || !/^\d{5}(-\d{4})?$/.test(zip)) return;
    try {
      const place = await crrService.lookupZip(zip);
      // A city or state the recorder typed themselves is kept; only the
      // department's defaults (or nothing) are replaced.
      setValues((current) => ({
        ...current,
        city: !current.city || current.city === (options.default_city ?? '') ? place.city : current.city,
        state: !current.state || current.state === (options.default_state ?? '') ? place.state : current.state,
      }));
    } catch {
      // Not in the data: the recorder types the city.
    }
  };

  const submit = async () => {
    const { payload, error: invalid } = buildCreatePayload(values, timezone, eventId);
    if (!payload) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await crrService.createActivity(payload);
      toast.success(`Recorded ${saved.activity_type_name}.`);
      onSaved(saved);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'The activity could not be recorded.'));
    } finally {
      setSaving(false);
    }
  };

  const tagGroups = [
    { kind: CrrTagKind.RISK, title: 'Risks' },
    { kind: CrrTagKind.POPULATION, title: 'Priority populations' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={eventTitle ? `CRR activity at ${eventTitle}` : 'Log a CRR activity'}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Record activity'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <p className="alert-danger text-sm" role="alert">
            {error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="crr-type" className="form-label">
              Activity type <span aria-hidden="true">*</span>
            </label>
            <select
              id="crr-type"
              className="form-input"
              value={values.activityTypeId}
              required
              onChange={(e) =>
                setValues((current) =>
                  withType(
                    current,
                    options.activity_types.find((t) => t.id === e.target.value)
                  )
                )
              }
            >
              <option value="">Choose a type…</option>
              {options.activity_types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="crr-when" className="form-label">
              When <span aria-hidden="true">*</span>
            </label>
            <input
              id="crr-when"
              type="datetime-local"
              className="form-input"
              value={values.occurredAt}
              required
              onChange={(e) => set('occurredAt', e.target.value)}
            />
          </div>
        </div>

        {activityType && activityType.measures.length > 0 && (
          <fieldset>
            <legend className="form-label">Counts</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {activityType.measures.map((measure) => (
                <div key={measure.id}>
                  <label htmlFor={`crr-count-${measure.id}`} className="text-theme-text-secondary text-sm">
                    {measure.label}
                  </label>
                  <input
                    id={`crr-count-${measure.id}`}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="form-input"
                    value={values.counts[measure.id] ?? ''}
                    onChange={(e) => set('counts', { ...values.counts, [measure.id]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {activityType && (
          <div className="grid gap-3 sm:grid-cols-2">
            {tagGroups.map((group) => (
              <fieldset key={group.kind}>
                <legend className="form-label">{group.title}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {options.tags
                    .filter((tag) => tag.kind === group.kind)
                    .map((tag) => (
                      <label
                        key={tag.id}
                        className="text-theme-text-secondary touch:min-h-11 inline-flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="form-checkbox"
                          checked={values.tagIds.includes(tag.id)}
                          onChange={(e) =>
                            set(
                              'tagIds',
                              e.target.checked
                                ? [...values.tagIds, tag.id]
                                : values.tagIds.filter((id) => id !== tag.id)
                            )
                          }
                        />
                        {tag.label}
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        <fieldset>
          <legend className="form-label">Where</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="crr-zip" className="text-theme-text-secondary text-sm">
                ZIP code
              </label>
              <input
                id="crr-zip"
                className="form-input"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={values.zipCode}
                onChange={(e) => set('zipCode', e.target.value)}
                onBlur={() => void lookUpZip()}
                aria-describedby={options.zip_lookup_enabled ? 'crr-zip-credit' : undefined}
              />
            </div>
            <div>
              <label htmlFor="crr-city" className="text-theme-text-secondary text-sm">
                City
              </label>
              <input
                id="crr-city"
                className="form-input"
                maxLength={100}
                value={values.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="crr-state" className="text-theme-text-secondary text-sm">
                State
              </label>
              <input
                id="crr-state"
                className="form-input"
                maxLength={50}
                value={values.state}
                onChange={(e) => set('state', e.target.value)}
              />
            </div>
          </div>
          {options.zip_lookup_enabled && (
            <p id="crr-zip-credit" className="text-theme-text-muted mt-1 text-xs">
              City and state fill in from the ZIP code, using GeoNames ZIP code data.
            </p>
          )}
        </fieldset>

        <div>
          <label className="text-theme-text-primary touch:min-h-11 inline-flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={values.hasResidentDetails}
              onChange={(e) => set('hasResidentDetails', e.target.checked)}
            />
            Add resident details
          </label>
          <p id="crr-details-hint" className="text-theme-text-muted text-xs">
            Encrypted. Only the Community Outreach Manager and above can see them, and they are cleared after{' '}
            {options.retention_months} months. The ZIP code is kept.
          </p>
          {values.hasResidentDetails && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['streetAddress', 'Street address', 'street-address'],
                  ['residentName', 'Resident name', 'name'],
                  ['residentPhone', 'Phone', 'tel'],
                  ['residentEmail', 'Email', 'email'],
                ] as const
              ).map(([key, label, autoComplete]) => (
                <div key={key}>
                  <label htmlFor={`crr-${key}`} className="text-theme-text-secondary text-sm">
                    {label}
                  </label>
                  <input
                    id={`crr-${key}`}
                    className="form-input"
                    autoComplete={autoComplete}
                    maxLength={key === 'residentPhone' ? 40 : 255}
                    value={values[key]}
                    onChange={(e) => set(key, e.target.value)}
                    aria-describedby="crr-details-hint"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="crr-notes" className="form-label">
            Notes (optional)
          </label>
          <textarea
            id="crr-notes"
            className="form-input"
            rows={3}
            maxLength={2000}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            aria-describedby="crr-notes-hint"
          />
          <p id="crr-notes-hint" className="text-theme-text-muted mt-1 text-xs">
            Kept with the resident details: encrypted, seen by the same people, cleared at the same time.
          </p>
        </div>

        {eventId ? (
          <p className="text-theme-text-muted text-sm">
            Time spent here is credited by the event&apos;s attendance, so no members are listed.
          </p>
        ) : (
          <fieldset>
            <legend className="form-label">Who took part</legend>
            <p className="text-theme-text-muted mb-2 text-xs">Their time is credited to Admin Hours.</p>
            <ul className="space-y-2">
              {values.members.map((row, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`crr-member-${index}`} className="sr-only">
                      Member
                    </label>
                    <select
                      id={`crr-member-${index}`}
                      className="form-input"
                      value={row.userId}
                      onChange={(e) =>
                        set(
                          'members',
                          values.members.map((r, i) => (i === index ? { ...r, userId: e.target.value } : r))
                        )
                      }
                    >
                      <option value="">Choose a member…</option>
                      {options.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label htmlFor={`crr-minutes-${index}`} className="text-theme-text-secondary text-sm">
                      Minutes
                    </label>
                    <input
                      id={`crr-minutes-${index}`}
                      type="number"
                      min={0}
                      max={1440}
                      inputMode="numeric"
                      className="form-input"
                      value={row.minutes}
                      onChange={(e) =>
                        set(
                          'members',
                          values.members.map((r, i) => (i === index ? { ...r, minutes: e.target.value } : r))
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Remove member ${index + 1}`}
                    onClick={() =>
                      set(
                        'members',
                        values.members.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-secondary touch:min-h-11 mt-2 inline-flex items-center gap-1.5 text-sm"
              onClick={() => set('members', [...values.members, { userId: '', minutes: String(DEFAULT_MINUTES) }])}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a member
            </button>
          </fieldset>
        )}
      </div>
    </Modal>
  );
};

export default CrrActivityDialog;
