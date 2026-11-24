/**
 * Create or edit an apparatus event template: details on the left, each
 * apparatus with its seats on the right. Saving changes nights scheduled
 * afterwards only — a night already on the calendar keeps its own copy.
 */

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Truck, X } from 'lucide-react';
import { apparatusEventService } from '../../services/api';
import {
  ApparatusEventEvocMode,
  ApparatusEventSeatType,
  type ApparatusEventTemplate,
  type EditorOptions,
} from '../../types/apparatusEvent';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  APPARATUS_EVENT_TYPES,
  blankSeat,
  blankUnit,
  hoursWouldNotBeCredited,
  toPayload,
  totalSeats,
  validateDraft,
  type SeatDraft,
  type TemplateDraft,
  type UnitDraft,
} from './templateForm';
import { TONE } from './tones';
import DurationHoursInput from './DurationHoursInput';
import HoursNotCreditedNote from './HoursNotCreditedNote';

interface TemplateEditorProps {
  initial: TemplateDraft;
  /** The template being edited; absent when creating. */
  templateId?: string | undefined;
  options: EditorOptions;
  onSaved: (template: ApparatusEventTemplate) => void;
  onCancel: () => void;
}

const EVOC_CHOICES: { value: ApparatusEventEvocMode; label: string; help: string }[] = [
  {
    value: ApparatusEventEvocMode.ENFORCE,
    label: 'Enforce',
    help: 'Only members at the apparatus’s required EVOC level, or with an approved driver exception, can take a Driver seat. The same rule shifts use.',
  },
  {
    value: ApparatusEventEvocMode.WARN,
    label: 'Warn only',
    help: 'Anyone can take a Driver seat; a member below the level is flagged on the crew board.',
  },
  {
    value: ApparatusEventEvocMode.IGNORE,
    label: 'Don’t check',
    help: 'For a static display where nobody drives.',
  },
];

export const TemplateEditor: React.FC<TemplateEditorProps> = ({ initial, templateId, options, onSaved, onCancel }) => {
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const seats = totalSeats(draft);
  const apparatusById = useMemo(() => new Map(options.apparatus.map((a) => [a.id, a])), [options.apparatus]);

  const set = <K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const updateUnit = (unitKey: string, change: (unit: UnitDraft) => UnitDraft) =>
    setDraft((d) => ({ ...d, units: d.units.map((u) => (u.key === unitKey ? change(u) : u)) }));

  const updateSeat = (unitKey: string, seatKey: string, patch: Partial<SeatDraft>) =>
    updateUnit(unitKey, (u) => ({ ...u, seats: u.seats.map((s) => (s.key === seatKey ? { ...s, ...patch } : s)) }));

  const save = async () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(draft);
      const saved = templateId
        ? await apparatusEventService.updateTemplate(templateId, payload)
        : await apparatusEventService.createTemplate(payload);
      toast.success(templateId ? 'Template saved' : 'Template created');
      onSaved(saved);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save the template.'));
    } finally {
      setSaving(false);
    }
  };

  const evocHelp = EVOC_CHOICES.find((c) => c.value === draft.evoc_mode)?.help ?? '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
            <Truck className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
            {templateId
              ? `Edit template: ${initial.name}`
              : draft.duplicated_from_id
                ? 'Duplicate template'
                : 'New template'}
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            Saving changes nights you schedule from now on. Nights already on the calendar keep their own seats.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>

      {showErrors && errors.length > 0 && (
        <div className="alert-danger text-sm" role="alert">
          <p className="font-semibold">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="card space-y-4 p-5" aria-labelledby="ae-details">
          <h3 id="ae-details" className="text-theme-text-primary font-semibold">
            Details
          </h3>
          <div>
            <label className="form-label" htmlFor="ae-name">
              Template name <span className="text-red-700 dark:text-red-400">*</span>
            </label>
            <input
              id="ae-name"
              className="form-input"
              value={draft.name}
              maxLength={200}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="ae-type">
              Event type
            </label>
            <select
              id="ae-type"
              className="form-input"
              value={draft.event_type}
              onChange={(e) => set('event_type', e.target.value as TemplateDraft['event_type'])}
            >
              {APPARATUS_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {getEventTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="ae-start">
                Default start
              </label>
              <input
                id="ae-start"
                type="time"
                className="form-input"
                value={draft.default_start_time}
                onChange={(e) => set('default_start_time', e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="ae-duration">
                Length (hours)
              </label>
              <DurationHoursInput
                id="ae-duration"
                minutes={draft.duration_minutes}
                onChange={(minutes) => set('duration_minutes', minutes)}
              />
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="ae-location">
              Meeting point
            </label>
            <input
              id="ae-location"
              className="form-input"
              value={draft.location}
              maxLength={300}
              onChange={(e) => set('location', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="ae-description">
              Description
            </label>
            <textarea
              id="ae-description"
              className="form-input"
              rows={3}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="ae-category">
              Admin Hours category
            </label>
            <select
              id="ae-category"
              className="form-input"
              value={draft.admin_hours_category_id}
              onChange={(e) => set('admin_hours_category_id', e.target.value)}
            >
              <option value="">Use the event type’s mapping</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-1 text-xs">
              Confirmed crew hours post here instead of the event type’s usual category. They never count as shift
              hours.
            </p>
            {hoursWouldNotBeCredited(draft.admin_hours_category_id, draft.event_type, options) && (
              <HoursNotCreditedNote eventType={draft.event_type} hasCategories={options.categories.length > 0} />
            )}
          </div>

          <fieldset className="border-theme-surface-border space-y-2 border-t pt-4">
            <legend className="text-theme-text-primary font-semibold">Driver EVOC rule</legend>
            <div className="segmented-group inline-flex flex-wrap" role="radiogroup" aria-label="Driver EVOC rule">
              {EVOC_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.evoc_mode === choice.value}
                  onClick={() => set('evoc_mode', choice.value)}
                  className={`touch:min-h-[44px] rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    draft.evoc_mode === choice.value
                      ? 'bg-red-800 text-white shadow-sm'
                      : 'text-theme-text-secondary hover:text-theme-text-primary'
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <p className="text-theme-text-muted text-xs">{evocHelp}</p>
          </fieldset>

          <fieldset className="border-theme-surface-border space-y-2 border-t pt-4">
            <legend className="text-theme-text-primary font-semibold">Sign-up</legend>
            <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={draft.allow_self_signup}
                onChange={(e) => set('allow_self_signup', e.target.checked)}
              />
              Members can take open seats themselves
            </label>
            <label className="text-theme-text-secondary ml-6 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={draft.allow_self_signup && draft.require_signup_approval}
                disabled={!draft.allow_self_signup}
                onChange={(e) => set('require_signup_approval', e.target.checked)}
              />
              <span>
                Coordinator approves self sign-ups
                <span className="text-theme-text-muted block text-xs">
                  Sign myself up asks for the seat instead of taking it. The organizer is emailed, and a request nobody
                  answers is declined when the night starts.
                </span>
              </span>
            </label>
            <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={draft.show_on_schedule}
                onChange={(e) => set('show_on_schedule', e.target.checked)}
              />
              Show on Shift Scheduling as “Outreach · not a shift”
            </label>
          </fieldset>
        </section>

        <div className="space-y-4">
          {draft.units.map((unit) => {
            const apparatus = apparatusById.get(unit.apparatus_id);
            const others = new Set(draft.units.filter((u) => u.key !== unit.key).map((u) => u.apparatus_id));
            return (
              <section key={unit.key} className="card p-5" aria-label={apparatus?.unit_number ?? 'Apparatus'}>
                <div className="border-theme-surface-border mb-3 flex flex-wrap items-center gap-3 border-b pb-3">
                  <label className="sr-only" htmlFor={`ae-unit-${unit.key}`}>
                    Apparatus
                  </label>
                  <select
                    id={`ae-unit-${unit.key}`}
                    className="form-input min-w-0 flex-1 sm:max-w-xs"
                    value={unit.apparatus_id}
                    onChange={(e) => updateUnit(unit.key, (u) => ({ ...u, apparatus_id: e.target.value }))}
                  >
                    <option value="">Choose an apparatus…</option>
                    {options.apparatus.map((a) => (
                      <option key={a.id} value={a.id} disabled={others.has(a.id)}>
                        {a.unit_number}
                        {a.name ? ` · ${a.name}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="text-theme-text-muted text-xs">
                    {apparatus
                      ? apparatus.required_evoc_level_name
                        ? `Requires ${apparatus.required_evoc_level_name} to drive`
                        : 'No EVOC level set on this apparatus'
                      : ''}
                  </span>
                  {draft.units.length > 1 && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm ml-auto"
                      onClick={() => setDraft((d) => ({ ...d, units: d.units.filter((u) => u.key !== unit.key) }))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Remove apparatus
                    </button>
                  )}
                </div>

                <ul className="space-y-2">
                  {unit.seats.map((seat, seatIndex) => {
                    // Column names show once, above the first seat, as a
                    // table header would; later rows keep them for screen
                    // readers. Repeated on every row they crowded the card.
                    const labelClass = seatIndex === 0 ? 'form-label text-xs' : 'sr-only';
                    return (
                      <li
                        key={seat.key}
                        className="border-theme-surface-border grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-end gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,12rem)_4.5rem_auto]"
                      >
                        <div>
                          <label className={labelClass} htmlFor={`seat-name-${seat.key}`}>
                            Seat
                          </label>
                          <input
                            id={`seat-name-${seat.key}`}
                            className="form-input"
                            value={seat.name}
                            maxLength={100}
                            onChange={(e) => updateSeat(unit.key, seat.key, { name: e.target.value })}
                          />
                        </div>
                        <div className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto">
                          <label className={labelClass} htmlFor={`seat-type-${seat.key}`}>
                            Type
                          </label>
                          <select
                            id={`seat-type-${seat.key}`}
                            className="form-input"
                            value={seat.seat_type}
                            onChange={(e) =>
                              updateSeat(unit.key, seat.key, { seat_type: e.target.value as SeatDraft['seat_type'] })
                            }
                          >
                            <option value={ApparatusEventSeatType.DRIVER}>Driver · EVOC</option>
                            <option value={ApparatusEventSeatType.GENERAL}>General</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelClass} htmlFor={`seat-count-${seat.key}`}>
                            Count
                          </label>
                          <input
                            id={`seat-count-${seat.key}`}
                            type="number"
                            min={1}
                            max={20}
                            className="form-input"
                            value={seat.count}
                            onChange={(e) => updateSeat(unit.key, seat.key, { count: e.target.value })}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-secondary btn-icon col-start-3 row-start-1 self-end sm:col-start-auto sm:row-start-auto"
                          aria-label={`Remove the ${seat.name || 'seat'} seat`}
                          disabled={unit.seats.length === 1}
                          onClick={() =>
                            updateUnit(unit.key, (u) => ({ ...u, seats: u.seats.filter((s) => s.key !== seat.key) }))
                          }
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {/* Full width: beside three other fields it was too narrow to read. */}
                        <div className="col-span-full flex flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="text-theme-text-secondary flex shrink-0 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="form-checkbox"
                              checked={seat.is_essential}
                              onChange={(e) => updateSeat(unit.key, seat.key, { is_essential: e.target.checked })}
                              aria-describedby={`seat-essential-help-${unit.key}`}
                            />
                            Essential
                          </label>
                          <div className="min-w-0 flex-1">
                            <label className="sr-only" htmlFor={`seat-note-${seat.key}`}>
                              Note for members
                            </label>
                            <input
                              id={`seat-note-${seat.key}`}
                              className="form-input"
                              placeholder="Note for members (optional)"
                              value={seat.note}
                              maxLength={300}
                              onChange={(e) => updateSeat(unit.key, seat.key, { note: e.target.value })}
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => updateUnit(unit.key, (u) => ({ ...u, seats: [...u.seats, blankSeat()] }))}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add seat
                  </button>
                  <span className="text-theme-text-muted text-xs">
                    Seat names are free text. Only a <span className={`badge ${TONE.red}`}>Driver · EVOC</span> seat
                    checks EVOC.
                  </span>
                  <span id={`seat-essential-help-${unit.key}`} className="text-theme-text-muted basis-full text-xs">
                    Essential seats must be filled before a night counts as staffed. Untick a seat that is welcome but
                    optional.
                  </span>
                </div>
              </section>
            );
          })}

          <button
            type="button"
            className="btn-secondary inline-flex w-full items-center justify-center gap-2 border-dashed"
            onClick={() => setDraft((d) => ({ ...d, units: [...d.units, blankUnit()] }))}
            disabled={draft.units.length >= options.apparatus.length}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add another apparatus
          </button>

          <div className="alert-info text-sm">
            <span className="font-semibold">
              {seats} seat{seats === 1 ? '' : 's'} in total.
            </span>{' '}
            To make a smaller or larger version, save this one and use Duplicate on its card.
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateEditor;
